import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import { characters, takeLine, textWidth } from './inplace-layout';
import type { ExportFont } from './export-font';

type TextRun = { text: string; size: number; rise: number };
type ImageRun = { image: PDFImage; width: number; height: number; below: number };
type Run = TextRun | ImageRun;
export type Note = { page: number; index: number; runs: Run[] };
const size = 12, width = 507;

// 与查看页共用同一份公式裁图和上下标，附录中仍能区分指数、分子和分母。
export async function noteRuns(pdf: PDFDocument, paragraph: HTMLElement): Promise<Run[]> {
  const runs: Run[] = [];
  async function visit(node: Node, fontSize: number, rise: number) {
    if (node instanceof Text) {
      if (node.data) runs.push({ text: node.data, size: fontSize, rise });
    } else if (node instanceof HTMLCanvasElement) {
      const blob = await new Promise<Blob>((resolve, reject) => node.toBlob(value =>
        value ? resolve(value) : reject(new Error('无法保存行内公式。')), 'image/png'));
      const image = await pdf.embedPng(await blob.arrayBuffer());
      await image.embed();
      const naturalWidth = parseFloat(node.style.width) * size;
      const imageWidth = Math.min(width, naturalWidth, 640 * node.width / node.height);
      runs.push({
        image, width: imageWidth, height: imageWidth * node.height / node.width,
        below: Math.max(0, -parseFloat(node.style.verticalAlign) * size * imageWidth / naturalWidth)
      });
    } else {
      const script = node instanceof HTMLElement && (node.tagName === 'SUP' || node.tagName === 'SUB');
      for (const child of node.childNodes) await visit(child, script ? size * .72 : fontSize,
        script ? node.tagName === 'SUP' ? size * .38 : -size * .2 : rise);
    }
  }
  await visit(paragraph, size, 0);
  return runs;
}

function* wrap(runs: Run[]) {
  let line: Run[] = [], x = 0;
  for (const run of runs) {
    if ('image' in run) {
      if (x + run.width > width && line.length) { yield line; line = []; x = 0; }
      line.push(run);
      x += run.width;
      continue;
    }
    const chars = characters(run.text);
    for (let start = 0; start < chars.length;) {
      const slice = takeLine(chars, start, width - x, run.size);
      if (slice.end === start && !line.length) throw new Error('附录中的文字超出页宽。');
      if (slice.end > start) {
        const text = chars.slice(start, slice.end).join('').replace(/\n$/, '');
        line.push({ ...run, text });
        x += textWidth(text, run.size);
        start = slice.end;
      }
      if (start < chars.length || chars[start - 1] === '\n') { yield line; line = []; x = 0; }
    }
  }
  if (line.length) yield line;
}

export async function appendNotes(pdf: PDFDocument, font: ExportFont, notes: Note[], signal: AbortSignal) {
  let page: PDFPage;
  let y = Infinity;
  const nextPage = () => {
    page = pdf.addPage([595, 842]);
    font.draw(page, '段落译文', 44, 54, 18);
    y = 78;
  };
  for (const note of notes) {
    signal.throwIfAborted();
    if (y > 745) nextPage();
    font.draw(page!, '原第 ' + note.page + ' 页 [' + note.index + ']', 44, y + 8, 10);
    y += 18;
    for (const line of wrap(note.runs)) {
      const above = Math.max(12, ...line.map(run => 'image' in run ? run.height - run.below : run.size + run.rise));
      const below = Math.max(4, ...line.map(run => 'image' in run ? run.below : -run.rise + 3));
      if (y + above + below > 803) {
        nextPage();
        await new Promise(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      const baseline = y + above;
      let x = 44;
      for (const run of line) {
        if ('image' in run) {
          page!.drawImage(run.image, { x, y: page!.getHeight() - baseline - run.below, width: run.width, height: run.height });
          x += run.width;
        } else {
          font.draw(page!, run.text, x, baseline - run.rise, run.size);
          x += textWidth(run.text, run.size);
        }
      }
      y += above + below + 3;
    }
    y += 10;
  }
}
