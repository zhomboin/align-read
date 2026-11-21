import type { PDFPageProxy } from 'pdfjs-dist';
import { AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { originalLine, pageLines, type PdfBounds } from './page-content';
import { graphicRegions } from './graphics';
import { pageLayout, type PdfBand } from './page-layout';
import { mathPlaceholders, type PdfTranslationItem } from './math-placeholders';

export type PageContent = { bands: PdfBand[]; items: PdfTranslationItem[]; hasText: boolean };
export type TranslationRow = (value?: string) => void;

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
  const items: PdfTranslationItem[] = [];
  for (const band of bands) {
    for (const blocks of band.columns) {
      for (const block of blocks) {
        if (!block.keep) items.push({ id: 'block-' + items.length, text: block.text, inline: block.inline });
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

function translationRow(node: HTMLElement, item: PdfTranslationItem, page: PDFPageProxy,
  image?: { canvas: HTMLCanvasElement; scale: number }): TranslationRow {
  if (!item.inline?.length) return value => {
    const text = value ?? item.text;
    if (node.textContent !== text) node.textContent = text;
  };
  const markers = mathPlaceholders(item);
  const formulaNodes = markers.spans.map(({ position, scripts }, index) => {
    const math = markers.math[index]!;
    const span = document.createElement('span');
    span.className = 'pdf-inline-math';
    if (position && image) {
      const { bounds, baseline, size } = position;
      const crop = originalLine(image.canvas, { bounds, text: math, keep: true }, page, image.scale, true);
      if (crop instanceof HTMLCanvasElement) {
        crop.style.width = crop.width / (size * image.scale) + 'em';
        crop.style.verticalAlign = (bounds[1] - baseline - 2 / image.scale) / size + 'em';
      }
      span.append(crop);
    } else {
      let from = 0;
      for (const script of scripts ?? []) {
        const element = document.createElement(script.kind);
        element.textContent = math.slice(script.start, script.end);
        span.append(math.slice(from, script.start), element);
        from = script.end;
      }
      span.append(math.slice(from));
    }
    return span;
  });
  const source = markers.combine(markers.pieces);
  let rendered = '';
  return value => {
    const text = value ?? source;
    if (text === rendered) return;
    const pieces = markers.parse(text) ?? markers.parse(source)!;
    node.replaceChildren(...pieces.map(part => typeof part === 'number' ? formulaNodes[part]! : part));
    rendered = text;
  };
}

export async function displayPage(page: PDFPageProxy, model: PageContent, signal: AbortSignal, showOriginal: boolean) {
  signal.throwIfAborted();
  const preview = showOriginal ? await renderCanvas(page, signal) : undefined;
  const hasGraphics = model.bands.some(band => band.columns.some(column => column.some(block =>
    block.keep || block.inline?.some(span => span.position))));
  const image = preview ?? (hasGraphics ? await renderCanvas(page, signal) : undefined);
  signal.throwIfAborted();
  const content = document.createDocumentFragment();
  const rows = new Map<string, TranslationRow>();
  for (const band of model.bands) {
    const group = document.createElement('div');
    if (band.split) {
      group.className = 'pdf-columns';
      group.style.gridTemplateColumns = 'minmax(0,' + band.split + 'fr) minmax(0,' + (1 - band.split) + 'fr)';
    }
    for (const blocks of band.columns) {
      const column = document.createElement('div');
      for (const block of blocks) {
        const title = block.style === 'title' || block.style === 'heading' || block.style === 'section';
        const element = document.createElement(title ? 'h' + (2 + (block.level ?? 1)) : 'p');
        if (block.style) element.classList.add('pdf-' + block.style);
        if (block.level) element.dataset.level = String(block.level);
        if (block.alignment) element.style.textAlign = block.alignment;
        if (block.keep && image) {
          if (block.graphic) element.classList.add('pdf-figure');
          element.append(originalLine(image.canvas, block, page, image.scale));
        } else {
          const item = model.items[rows.size]!;
          const render = translationRow(element, item, page, image);
          render();
          rows.set(item.id, render);
        }
        column.append(element);
      }
      group.append(column);
    }
    content.append(group);
  }
  return { canvas: preview?.canvas, content, rows };
}
