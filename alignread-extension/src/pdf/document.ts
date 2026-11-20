import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

const assets = new URL('pdfjs/', location.href).href;
GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.mjs';
const maxBytes = 100 * 1024 * 1024;
export type PdfInput = File | URL;

async function readBytes(source: PdfInput, signal: AbortSignal) {
  if (source instanceof File) {
    if (source.size > maxBytes) throw new Error('请选择 100 MiB 以内的 PDF。');
    return new Uint8Array(await source.arrayBuffer());
  }
  const response = await fetch(source, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw new Error('无法读取此网址，请下载 PDF 后选择文件。');
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (; ;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('请选择 100 MiB 以内的 PDF。'); }
      parts.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

export async function openDocument(source: PdfInput, signal: AbortSignal) {
  const data = await readBytes(source, signal);
  signal.throwIfAborted();
  const task: PDFDocumentLoadingTask = getDocument({
    data, cMapUrl: assets + 'cmaps/', standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/',
    iccUrl: assets + 'iccs/', useWasm: false, useWorkerFetch: true, fontExtraProperties: true,
  });
  const destroy = () => { void task.destroy().catch(() => undefined); };
  signal.addEventListener('abort', destroy, { once: true });
  try { return await task.promise; }
  catch (error) {
    signal.removeEventListener('abort', destroy);
    destroy();
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('PDF 已加密，请先解锁文件后再打开。');
    throw error;
  }
}
