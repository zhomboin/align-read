import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { documentBytes } from './byte-source';

const assets = new URL('pdfjs/', location.href).href;
GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.mjs';
export type PdfInput = File | URL;

export async function openDocument(source: PdfInput, signal: AbortSignal, fail: (error: Error) => void) {
  const input = await documentBytes(source, signal, fail);
  signal.throwIfAborted();
  const task: PDFDocumentLoadingTask = getDocument({
    ...input, cMapUrl: assets + 'cmaps/', standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/',
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
