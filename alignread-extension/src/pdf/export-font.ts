import {
  beginText, endText, PDFHexString, PDFName, setFontAndSize, setTextMatrix, showText,
  type PDFDocument, type PDFPage, type PDFRef,
} from 'pdf-lib';
import { characters, fontFamily, textWidth } from './inplace-layout';

const em = 64;
const hex = (value: number, length: number) => value.toString(16).padStart(length, '0');
type Glyph = { text: string; width: number; stream: PDFRef; image?: PDFRef };
type Font = { ref: PDFRef; name: PDFName; glyphs: Glyph[] };

// 将实际用到的本机字形嵌入 Type 3 字体。Unicode 映射供离线阅读器搜索与复制。
export class ExportFont {
  private canvas = document.createElement('canvas');
  private lookup = new Map<string, { font: Font; code: number }>();
  private fonts: Font[] = [];

  constructor(private pdf: PDFDocument) { }

  private glyph(text: string) {
    const known = this.lookup.get(text);
    if (known) return known;
    const ctx = this.pdf.context;
    let font = this.fonts.at(-1);
    if (!font || font.glyphs.length === 255) {
      font = { ref: ctx.nextRef(), name: PDFName.of('AlignRead' + this.fonts.length), glyphs: [] };
      this.fonts.push(font);
    }
    const code = font.glyphs.length + 1;
    const canvas = this.canvas;
    const painter = canvas.getContext('2d', { willReadFrequently: true })!;
    painter.font = em + 'px ' + fontFamily;
    painter.textAlign = 'left';
    const metrics = painter.measureText(text);
    const width = Math.round(metrics.width * 1000 / em);
    const left = Math.ceil(metrics.actualBoundingBoxLeft) + 1;
    const top = Math.ceil(metrics.actualBoundingBoxAscent) + 1;
    const bottom = Math.ceil(metrics.actualBoundingBoxDescent) + 1;
    canvas.width = Math.max(1, left + Math.ceil(metrics.actualBoundingBoxRight) + 1);
    canvas.height = Math.max(1, top + bottom);
    painter.font = em + 'px ' + fontFamily;
    painter.textAlign = 'left';
    painter.fillText(text, left, top);
    const pixels = painter.getImageData(0, 0, canvas.width, canvas.height).data;
    const stride = Math.ceil(canvas.width / 8);
    const mask = new Uint8Array(stride * canvas.height).fill(255);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]! >= 96) {
        const pos = y * stride + (x >> 3);
        mask[pos] = mask[pos]! & ~(128 >> (x % 8));
      }
    }
    const unit = 1000 / em;
    const image = text.trim() ? ctx.register(ctx.flateStream(mask, {
      Type: 'XObject', Subtype: 'Image', Width: canvas.width, Height: canvas.height,
      ImageMask: true, BitsPerComponent: 1,
    })) : undefined;
    const paint = image ? [canvas.width * unit, 0, 0, canvas.height * unit, -left * unit,
    -bottom * unit, 'cm /i' + code, 'Do'].join(' ') : '';
    const stream = ctx.register(ctx.stream(width + ' 0 d0\n' + paint));
    font.glyphs.push({ text, width, image, stream });
    const entry = { font, code };
    this.lookup.set(text, entry);
    return entry;
  }

  draw(page: PDFPage, text: string, x: number, baseline: number, size: number) {
    if (!text) return;
    // 连写文字以短语塑形，汉字和普通字母保留逐字选取。
    const shaped = /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}]/u.test(text);
    const units = shaped ? text.match(/.{1,100}/gu)! : characters(text);
    const runs: { font: Font; codes: string[]; width: number }[] = [];
    for (const unit of units) {
      const { font, code } = this.glyph(unit);
      if (runs.at(-1)?.font !== font) runs.push({ font, codes: [], width: 0 });
      const run = runs.at(-1)!;
      run.codes.push(hex(code, 2));
      run.width += font.glyphs[code - 1]!.width * size / 1000;
    }
    let cursor = x;
    const width = runs.reduce((sum, run) => sum + run.width, 0);
    const scale = width > 0 ? textWidth(text, size) / width : 1;
    for (const run of runs) {
      page.node.setFontDictionary(run.font.name, run.font.ref);
      page.pushOperators(beginText(), setFontAndSize(run.font.name, size),
        setTextMatrix(scale, 0, 0, 1, cursor, page.getHeight() - baseline),
        showText(PDFHexString.of(run.codes.join(''))), endText());
      cursor += run.width * scale;
    }
  }

  finish() {
    const ctx = this.pdf.context;
    for (const font of this.fonts) {
      const charProcs = ctx.obj({});
      const images = ctx.obj({});
      const names: string[] = [];
      const mapping: string[] = [];
      font.glyphs.forEach((g, i) => {
        const name = 'g' + (i + 1);
        names.push(name);
        charProcs.set(PDFName.of(name), g.stream);
        if (g.image) images.set(PDFName.of('i' + (i + 1)), g.image);
        const utf16 = g.text.split('').map(unit => hex(unit.charCodeAt(0), 4)).join('');
        mapping.push('<' + hex(i + 1, 2) + '> <' + utf16 + '>');
      });
      const cmap = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /AlignReadUnicode def', '/CMapType 2 def', '1 begincodespacerange', '<00> <FF>', 'endcodespacerange'];
      for (let i = 0; i < mapping.length; i += 100) {
        const batch = mapping.slice(i, i + 100);
        cmap.push(batch.length + ' beginbfchar', ...batch, 'endbfchar');
      }
      cmap.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end end');
      ctx.assign(font.ref, ctx.obj({
        Type: 'Font', Subtype: 'Type3', Name: font.name, FontMatrix: [.001, 0, 0, .001, 0, 0],
        FontBBox: [-1000, -400, 150000, 1300], CharProcs: charProcs,
        Encoding: { Type: 'Encoding', Differences: [1, ...names] }, Resources: { XObject: images },
        FirstChar: 1, LastChar: names.length, Widths: font.glyphs.map(g => g.width),
        ToUnicode: ctx.register(ctx.flateStream(cmap.join('\n'))),
      }));
    }
  }
}
