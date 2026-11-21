import type { PDFPageProxy } from 'pdfjs-dist';
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { originalLine, pageLines, type PdfBounds } from './page-content';
import { graphicRegions } from './graphics';
import { pageLayout, type PdfBand } from './page-layout';
import type { TranslationItem } from '../shared/reader-messages';

export type PageContent = { bands: PdfBand[]; items: TranslationItem[]; hasText: boolean };

export async function readPage(page: PDFPageProxy): Promise<PageContent> {
  const operators = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  const lines = await pageLines(page);
  const pageBounds = page.view as PdfBounds;
  const pageArea = (pageBounds[2] - pageBounds[0]) * (pageBounds[3] - pageBounds[1]);
  // A scanned sheet can have an OCR text layer over a full-page raster image.
  const regions = graphicRegions(operators, pageBounds).filter(([x1, y1, x2, y2]) =>
    !lines.length || (x2 - x1) * (y2 - y1) < pageArea * .72);
  const bands = pageLayout([
    ...lines.filter(({ bounds: [x1, y1, x2, y2] }) => !regions.some(([left, bottom, right, top]) => {
      const x = (x1 + x2) / 2, y = (y1 + y2) / 2;
      return x >= left - 1 && x <= right + 1 && y >= bottom - 1 && y <= top + 1;
    })),
    ...regions.map(bounds => ({ text: '原页图表', keep: true, graphic: true, bounds })),
  ], page);
  const items: TranslationItem[] = [];
  for (const band of bands) {
    for (const blocks of band.columns) {
      for (const block of blocks) {
        if (!block.keep) items.push({ id: 'block-' + items.length, text: block.text });
      }
    }
  }
  return { bands, items, hasText: Boolean(lines.length) };
}

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

export async function displayPage(page: PDFPageProxy, model: PageContent, signal: AbortSignal, showOriginal: boolean) {
  signal.throwIfAborted();
  const preview = showOriginal ? await renderCanvas(page, signal) : undefined;
  const hasGraphics = model.bands.some(band => band.columns.some(column => column.some(block => block.keep)));
  const image = preview ?? (hasGraphics ? await renderCanvas(page, signal) : undefined);
  signal.throwIfAborted();
  const content = document.createDocumentFragment();
  const rows = new Map<string, HTMLElement>();
  for (const band of model.bands) {
    const group = document.createElement('div');
    if (band.split) {
      group.className = 'pdf-columns';
      group.style.gridTemplateColumns = 'minmax(0,' + band.split + 'fr) minmax(0,' + (1 - band.split) + 'fr)';
    }
    for (const blocks of band.columns) {
      const column = document.createElement('div');
      for (const block of blocks) {
        const p = document.createElement('p');
        if (block.style) p.classList.add('pdf-' + block.style);
        if (block.keep && image) {
          if (block.graphic) p.className = 'pdf-figure';
          p.append(originalLine(image.canvas, block, page, image.scale));
        } else {
          p.textContent = block.text;
          rows.set(model.items[rows.size]!.id, p);
        }
        column.append(p);
      }
      group.append(column);
    }
    content.append(group);
  }
  return { canvas: preview?.canvas, content, rows };
}
