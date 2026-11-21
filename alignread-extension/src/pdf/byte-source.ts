import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { localSource } from './local-source';

export const chunkSize = 128 * 1024;
const maxBytes = 100 * 1024 * 1024;
const sizeError = '请选择 100 MiB 以内的 PDF。';
const readError = '无法读取 PDF。请检查文件访问权限，或点击「选择 PDF」。';
const changedError = 'PDF 分段读取失败，请重新打开文件。';

async function boundedBytes(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new Error(readError);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (Number(response.headers.get('Content-Length')) > limit) throw new Error(sizeError);
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error(sizeError);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  if (chunks.length === 1) return chunks[0]!;
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

export async function documentBytes(source: URL | File, signal: AbortSignal, fail: (error: Error) => void) {
  function ranges(length: number, initial: Uint8Array | null, read: (start: number, end: number) => Promise<Uint8Array>) {
    const range = new PDFDataRangeTransport(length, initial, true);
    range.requestDataRange = (start, end) => {
      void read(start, end).then(bytes => {
        if (signal.aborted) return;
        if (bytes.length !== end - start) throw new Error(changedError);
        range.onDataRange(start, bytes);
      }).catch(() => { if (!signal.aborted) fail(new Error(changedError)); });
    };
    return { range, rangeChunkSize: chunkSize, disableAutoFetch: true, disableStream: true };
  }

  if (source instanceof File) {
    if (source.size > maxBytes) throw new Error(sizeError);
    const read = async (start: number, end: number) => new Uint8Array(await source.slice(start, end).arrayBuffer());
    const first = await read(0, chunkSize);
    return first.length === source.size ? { data: first } : ranges(source.size, first, read);
  }

  const request = (headers: HeadersInit) => fetch(source, {
    signal, headers, credentials: 'omit', referrerPolicy: 'no-referrer',
  });
  if (source.protocol === 'file:') {
    const local = await localSource(source, signal, chunkSize, maxBytes);
    if (local instanceof Blob) {
      if (local.size > maxBytes) throw new Error(sizeError);
      return { data: new Uint8Array(await local.arrayBuffer()) };
    }
    return ranges(local.size, null, async (start, end) => {
      const response = await request({ Range: 'bytes=' + start + '-' + (end - 1) });
      if (local.modified && response.headers.get('Last-Modified') !== local.modified) {
        await response.body?.cancel();
        throw new Error(changedError);
      }
      return boundedBytes(response, end - start);
    });
  }
  const first = await request({ Range: 'bytes=0-' + (chunkSize - 1) });
  if (first.status !== 206) return { data: await boundedBytes(first, maxBytes) };
  const match = /^bytes 0-(\d+)\/(\d+)$/i.exec(first.headers.get('Content-Range') ?? '');
  if (!match) {
    // Some cross-origin servers allow Range but do not expose Content-Range.
    await first.body?.cancel();
    return { data: await boundedBytes(await request({}), maxBytes) };
  }
  const length = Number(match[2]);
  if (length > maxBytes || Number(match[1]) !== Math.min(length, chunkSize) - 1) {
    await first.body?.cancel();
    throw new Error(length > maxBytes ? sizeError : changedError);
  }
  const initial = await boundedBytes(first, Math.min(length, chunkSize));
  if (initial.length !== Math.min(length, chunkSize)) throw new Error(changedError);
  if (initial.length === length) return { data: initial };
  const version = first.headers.get('ETag') ?? first.headers.get('Last-Modified');
  return ranges(length, initial, async (start, end) => {
    const response = await request({ Range: 'bytes=' + start + '-' + (end - 1) });
    if (response.status !== 206 || response.headers.get('Content-Range') !== 'bytes ' + start + '-' + (end - 1) + '/' + length ||
      response.url !== first.url || version !== (response.headers.get('ETag') ?? response.headers.get('Last-Modified'))) {
      await response.body?.cancel();
      throw new Error(changedError);
    }
    return boundedBytes(response, end - start);
  });
}
