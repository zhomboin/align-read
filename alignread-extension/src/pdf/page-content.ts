import type { PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type PdfLine = { text: string; keep: boolean; bounds: [number, number, number, number]; };
const mathFont = /cmmi|cmsy|cmex|math|symbol|stix.*(?:italic|symbol)|mono|courier|cmtt/i;
const mathText = /[=∑∏∫√≤≥≠≈≃±∂∇∞∈∉∀∃∝⊗⊕→↦⇔∥α-ωΑ-Ω]|[\u{1d400}-\u{1d7ff}]/u;
const looksLikeCode = /[{}]|;\s*$|(?:=>|:=|\/\/|\/\*|\w+\([^)]*\)|\w+\s*[_^]\s*[\w{])|^\s*(?:#|def |class |import |return |const |let |function )/;

export async function pageLines(page: PDFPageProxy) {
  const { items, styles } = await page.getTextContent();
  const lines: PdfLine[] = [];
  let current: TextItem[] = [];
  function flush() {
    if (!current.length) return;
    let text = '';
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    let protectedFont = false;
    for (const item of current) {
      const [, , , , x, y] = item.transform;
      const size = Math.max(1, item.height || Math.hypot(item.transform[2], item.transform[3]));
      if (x - right > size * .15 && text && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      text += item.str;
      left = Math.min(left, x); right = Math.max(right, x + item.width);
      bottom = Math.min(bottom, y - size * .25); top = Math.max(top, y + size);
      const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : undefined;
      protectedFont ||= Boolean(item.str.trim() && (mathFont.test(font?.name ?? '') ||
        mathFont.test(styles[item.fontName]?.fontFamily ?? '') || Math.abs(item.transform[1]) > .01));
    }
    text = text.trim();
    const keep = protectedFont || mathText.test(text) || looksLikeCode.test(text) ||
      !/\p{L}{2}/u.test(text) || /^(?:[a-zA-Z]\s+){2,}[a-zA-Z]$/.test(text);
    if (text) lines.push({ text, keep, bounds: [left, bottom, right, top] });
    current = [];
  }
  for (const item of items) {
    if (!('str' in item)) continue;
    const last = current.at(-1);
    if (last && (Math.abs(item.transform[5] - last.transform[5]) > Math.max(last.height, item.height) * .72 ||
      item.transform[4] - last.transform[4] - last.width > Math.max(18, last.height * 2))) flush();
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
  const x = Math.max(0, Math.floor(Math.min(x1, x2)) - 2);
  const y = Math.max(0, Math.floor(Math.min(y1, y2)) - 2);
  const width = Math.min(canvas.width - x, Math.ceil(Math.max(x1, x2)) + 2 - x);
  const height = Math.min(canvas.height - y, Math.ceil(Math.max(y1, y2)) + 2 - y);
  if (width <= 0 || height <= 0) return document.createTextNode(line.text);
  const crop = document.createElement('canvas');
  crop.width = width;
  crop.height = height;
  crop.style.width = width / scale * 1.45 + 'px';
  crop.setAttribute('role', 'img');
  crop.setAttribute('aria-label', line.text);
  crop.getContext('2d')!.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return crop;
}
