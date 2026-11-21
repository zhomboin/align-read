import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type PdfBounds = [number, number, number, number];
export type PdfLine = {
  text: string; keep: boolean; bounds: PdfBounds;
  graphic?: boolean;
  math?: boolean;
  blankBefore?: number;
  blankAfter?: number;
  style?: 'title' | 'heading' | 'byline' | 'caption' | 'equation';
};
export type PlacedLine = PdfLine & { x: number; y: number; end: number; height: number };
const mathFont = /cmmi|cmsy|cmex|math|symbol|stix.*(?:italic|symbol)/i;
const codeFont = /mono|courier|cmtt/i;
const mathText = /[\p{Sm}α-ωΑ-Ω\u2070-\u209f\u{1d400}-\u{1d7ff}]/u;
const looksLikeCode = /[{}]|;\s*$|(?:=>|:=|\/\/|\/\*|\w+\([^)]*\)|\w+\s*[_^]\s*[\w{])|^\s*(?:#|def |class |import |return |const |let |function )/;

export async function pageLines(page: PDFPageProxy) {
  const { items, styles } = await page.getTextContent();
  const [leftEdge, , rightEdge] = page.view as PdfBounds;
  const margin = (rightEdge - leftEdge) * .10;
  const lines: PdfLine[] = [];
  let current: TextItem[] = [];
  function flush() {
    if (!current.length) return;
    let text = '';
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    let protectedFont = false;
    let math = false;
    for (const item of current) {
      const [, , , , x, y] = item.transform;
      const size = Math.max(1, item.height || Math.hypot(item.transform[2], item.transform[3]));
      if (x - right > size * .15 && text && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      text += item.str;
      left = Math.min(left, x); right = Math.max(right, x + item.width);
      bottom = Math.min(bottom, y - size * .25); top = Math.max(top, y + size);
      const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : undefined;
      if (item.str.trim()) {
        const names = (font?.name ?? '') + ' ' + (styles[item.fontName]?.fontFamily ?? '');
        math ||= mathFont.test(names);
        protectedFont ||= math || codeFont.test(names) || Math.abs(item.transform[1]) > .01;
      }
    }
    text = text.trim();
    const keep = protectedFont || mathText.test(text) || looksLikeCode.test(text) ||
      !/\p{L}{2}/u.test(text) || /^(?:[a-zA-Z]\s+){2,}[a-zA-Z]$/.test(text);
    if (text) lines.push({ text, keep, math: math || mathText.test(text) || /[=+·…]/.test(text), bounds: [left, bottom, right, top] });
    current = [];
  }
  for (const item of items) {
    if (!('str' in item)) continue;
    // Rotated publishing marks at the sheet edge belong to the original page.
    const x = item.transform[4];
    if (Math.abs(item.transform[1]) > Math.abs(item.transform[0]) &&
      (x < leftEdge + margin || x > rightEdge - margin)) {
      flush();
      continue;
    }
    const last = current.at(-1);
    if (!item.str.trim() && item.width > Math.max(10, (last?.height ?? item.height) * 1.2)) {
      flush();
      continue;
    }
    if (last && (Math.abs(item.transform[5] - last.transform[5]) > Math.max(last.height, item.height) * .72 ||
      item.transform[4] - last.transform[4] - last.width > Math.max(10, last.height * 1.2) ||
      (item.dir !== 'rtl' && item.transform[4] < last.transform[4] - last.height))) flush();
    current.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

export function originalLine(canvas: HTMLCanvasElement, line: PdfLine, page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const [left, bottom, right, top] = line.bounds;
  const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
  const [x2, y2] = viewport.convertToViewportPoint(right, top);
  const padding = line.style === 'equation' ? Math.ceil(2 * scale) : 2;
  const x = Math.max(0, Math.floor(Math.min(x1, x2)) - padding);
  const y = Math.max(0, Math.floor(Math.min(y1, y2)) - padding);
  const width = Math.min(canvas.width - x, Math.ceil(Math.max(x1, x2)) + padding - x);
  const height = Math.min(canvas.height - y, Math.ceil(Math.max(y1, y2)) + padding - y);
  if (width <= 0 || height <= 0) return document.createTextNode(line.text);
  const before = Math.round((line.blankBefore ?? 0) * scale);
  const after = Math.round((line.blankAfter ?? 0) * scale);
  const crop = document.createElement('canvas');
  crop.width = before + width + after;
  crop.height = height;
  crop.style.width = crop.width / scale * (line.graphic ? 1.7 : 1.45) + 'px';
  if (line.graphic) crop.className = 'pdf-graphic';
  crop.setAttribute('role', 'img');
  crop.setAttribute('aria-label', line.text);
  crop.getContext('2d')!.drawImage(canvas, x, y, width, height, before, 0, width, height);
  return crop;
}
