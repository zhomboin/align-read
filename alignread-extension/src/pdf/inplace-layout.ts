import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfBounds } from './page-content';
import { mathPlaceholders, type PdfTranslationItem } from './math-placeholders';
import type { PageContent } from './show-page';

export type Rect = { x: number; y: number; width: number; height: number };
export type InplaceBlock = { items: PdfTranslationItem[]; boxes: Rect[]; masks: Rect[]; size: number; safe: boolean; index: number };
export type PlacedText = { text: string; x: number; baseline: number; size: number };
export type Placement = { text: string; lines: PlacedText[]; overflow: boolean };
export const fontFamily = 'sans-serif';
const measure = document.createElement('canvas').getContext('2d')!;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function textWidth(text: string, size: number) {
  measure.font = size + 'px ' + fontFamily;
  return measure.measureText(text).width;
}

export function characters(text: string) {
  return Array.from(graphemes.segment(text), part => part.segment);
}

// 每次只测量本行候选文字，长段落可以分行续排。
export function takeLine(chars: string[], start: number, width: number, size: number) {
  let end = start;
  let lastSpace = start;
  let text = '';
  while (end < chars.length) {
    const next = chars[end]!;
    if (next === '\n') return { text, end: end + 1 };
    if (textWidth(text + next, size) > width) break;
    text += next;
    end++;
    if (/\s/u.test(next)) lastSpace = end;
  }
  if (end < chars.length && lastSpace > start && /[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(chars[end]!)) end = lastSpace;
  return { text: chars.slice(start, end).join('').trimEnd(), end };
}

export function inplaceBlocks(page: PDFPageProxy, model: PageContent, canvas: HTMLCanvasElement) {
  const viewport = page.getViewport({ scale: 1 });
  const rect = (bounds: PdfBounds): Rect => {
    const [a, b] = viewport.convertToViewportPoint(bounds[0], bounds[1]);
    const [c, d] = viewport.convertToViewportPoint(bounds[2], bounds[3]);
    return { x: Math.min(a!, c!), y: Math.min(b!, d!), width: Math.abs(c! - a!), height: Math.abs(d! - b!) };
  };
  const blocks = model.bands.flatMap(band => band.columns.flat());
  const groups = blocks.map(block => (block.sourceLines ?? [block.bounds]).map(rect));
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const sx = canvas.width / viewport.width, sy = canvas.height / viewport.height;
  const white = (x: number, y: number) => {
    const i = (Math.floor(y * sy) * canvas.width + Math.floor(x * sx)) * 4;
    return pixels[i]! >= 242 && pixels[i + 1]! >= 242 && pixels[i + 2]! >= 242;
  };
  const simple = (box: Rect) => {
    const { x, y, width, height } = box;
    if (x < 0 || y < 0 || x + width >= viewport.width || y + height >= viewport.height) return false;
    let edgeSamples = 0, whiteSamples = 0;
    for (let dx = .5; dx < width; dx += Math.max(2, width / 30)) {
      edgeSamples += 2;
      if (white(x + dx, y)) whiteSamples++;
      if (white(x + dx, y + height)) whiteSamples++;
    }
    if (whiteSamples < edgeSamples * .9) return false;
    // 彩色图像、底纹或水印上的文字保留原页。
    for (let dy = 1; dy < height; dy += Math.max(2, 2 / sy)) for (let dx = 1; dx < width; dx += Math.max(2, 2 / sx)) {
      const i = (Math.floor((y + dy) * sy) * canvas.width + Math.floor((x + dx) * sx)) * 4;
      // 亚像素抗锯齿会在黑色字形两侧产生相反的彩边，需检查相邻像素的平均颜色。
      let r = 0, g = 0, b = 0;
      const samples = Math.min(7, canvas.width - Math.floor((x + dx) * sx));
      for (let k = 0; k < samples; k++) {
        r += pixels[i + k * 4]!;
        g += pixels[i + k * 4 + 1]!;
        b += pixels[i + k * 4 + 2]!;
      }
      if (Math.max(r, g, b) - Math.min(r, g, b) > 52 * samples) return false;
    }
    return true;
  };
  let offset = 0;
  const result: InplaceBlock[] = [];
  blocks.forEach((block, i) => {
    if (block.keep) return;
    const count = block.labelEnd && !block.style ? 2 : 1;
    const items = model.items.slice(offset, offset + count);
    offset += count;
    const boxes = groups[i]!;
    // 字形边缘和斜体偶尔超出 PDF 文字项的逻辑宽度。
    const masks = boxes.map(box => ({ x: box.x - 1.5, y: box.y - .7, width: box.width + 3, height: box.height + 1.4 }));
    const collision = (a: Rect, b: Rect) =>
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
    const hasFormulaInk = block.inline?.some(span => span.position || span.scripts?.length);
    const safe = !viewport.rotation && !hasFormulaInk && boxes.every(simple) && masks.every(a =>
      !groups.some((other, j) => j !== i && other.some(b => collision(a, b))));
    result.push({
      items, boxes, masks, size: block.textLine?.size ?? block.fontSize ?? boxes[0]!.height * .8,
      safe, index: result.length + 1
    });
  });
  return { blocks: result, width: viewport.width, height: viewport.height };
}

export function placeBlock(block: InplaceBlock, values: Map<string, string>): Placement | undefined {
  const parts: string[] = [];
  for (const item of block.items) {
    const value = values.get(item.id);
    if (!value) return;
    const markers = mathPlaceholders(item);
    const parsed = markers.parse(value);
    if (!parsed) return;
    parts.push(parsed.map(part => typeof part === 'number' ? markers.math[part] : part).join(''));
  }
  const text = parts.join(' ').trim();
  if (block.safe) {
    const chars = characters(text);
    for (const scale of [1, .94, .88]) {
      let offset = 0;
      const lines: PlacedText[] = [];
      for (const box of block.boxes) {
        const size = Math.min(block.size * scale, box.height / 1.25);
        const line = takeLine(chars, offset, box.width, size);
        if (line.end === offset) break;
        lines.push({ text: line.text, x: box.x, baseline: box.y + (box.height - size) / 2 + size * .82, size });
        offset = line.end;
        while (chars[offset] === ' ') offset++;
        if (offset === chars.length) return { text, lines, overflow: false };
      }
    }
  }
  return { text, lines: [], overflow: true };
}
