import type { PDFPageProxy } from 'pdfjs-dist';
import { originalLine, pageLines } from './page-content';
import { pageLayout } from './page-layout';
import type { TranslationItem } from '../shared/reader-messages';

export type TranslationRow = { p: HTMLElement; item: TranslationItem; done: boolean };

async function renderCanvas(page: PDFPageProxy, signal: AbortSignal) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.setAttribute('aria-label', 'PDF 原页 ' + page.pageNumber);
  const render = page.render({ canvas, viewport });
  const cancel = () => render.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try { await render.promise; }
  finally { signal.removeEventListener('abort', cancel); }
  return { canvas, scale };
}

export async function displayPage(page: PDFPageProxy, signal: AbortSignal, showOriginal: boolean) {
  // Font information for protected mathematical and code lines is resolved by the operator list.
  const preview = showOriginal ? await renderCanvas(page, signal) : undefined;
  if (!showOriginal) await page.getOperatorList();
  signal.throwIfAborted();
  const lines = await pageLines(page);
  signal.throwIfAborted();
  const image = preview ?? (lines.some(line => line.keep) ? await renderCanvas(page, signal) : undefined);
  signal.throwIfAborted();
  const content = document.createDocumentFragment();
  const rows: TranslationRow[] = [];
  const viewport = page.getViewport({ scale: 1 });
  for (const band of pageLayout(lines, page)) {
    const group = document.createElement('div');
    if (band.split) {
      group.className = 'pdf-columns';
      group.style.gridTemplateColumns = 'minmax(0,' + band.split + 'fr) minmax(0,' + (1 - band.split) + 'fr)';
    }
    for (const blocks of band.columns) {
      const column = document.createElement('div');
      for (const block of blocks) {
        const p = document.createElement('p');
        if (band.columns.length === 1 && blocks.length === 1) {
          const [left, bottom, right, top] = block.bounds;
          const [start] = viewport.convertToViewportPoint(left, bottom);
          const [end] = viewport.convertToViewportPoint(right, top);
          if (Math.abs(start + end - viewport.width) < viewport.width * .1 &&
            Math.abs(end - start) < viewport.width * .8) p.style.textAlign = 'center';
        }
        if (block.keep && image) p.append(originalLine(image.canvas, block, page, image.scale));
        else {
          p.textContent = block.text;
          rows.push({ p, item: { id: 'block-' + rows.length, text: block.text }, done: false });
        }
        column.append(p);
      }
      group.append(column);
    }
    content.append(group);
  }
  return { canvas: preview?.canvas, content, rows, hasText: Boolean(lines.length) };
}
