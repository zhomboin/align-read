import { PDFDocument, rgb } from 'pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { ExportFont } from './export-font';
import { inplaceBlocks, placeBlock } from './inplace-layout';
import { noteContent, noteMargin, notePosition } from './inplace-view';
import { appendNotes, noteRuns, type Note } from './export-notes';
import { renderCanvas, type PageContent } from './show-page';

type ExportOptions = {
  total: number;
  signal: AbortSignal;
  read(page: number): Promise<{ page: PDFPageProxy; content: PageContent }>;
  translate(page: number): Promise<Map<string, string>>;
  progress(message: string): void;
};

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('无法生成原页图像。')), 'image/jpeg', .97));
}


export async function exportDocument(options: ExportOptions) {
  const { total, signal, progress } = options;
  const pdf = await PDFDocument.create();
  pdf.setCreator('AlignRead');
  const font = new ExportFont(pdf);
  const notes: Note[] = [];
  let hasTranslation = false;
  for (let number = 1; number <= total; number++) {
    signal.throwIfAborted();
    progress('正在准备译本：第 ' + number + ' / ' + total + ' 页');
    try {
      const values = await options.translate(number);
      const { page, content } = await options.read(number);
      signal.throwIfAborted();
      const source = await renderCanvas(page, signal);
      const { canvas } = source;
      try {
        const { blocks, width, height } = inplaceBlocks(page, content, canvas);
        const placements = blocks.map(block => {
          const placement = placeBlock(block, values);
          if (!placement) throw new Error('段落译文不完整。');
          return { block, placement };
        });
        const margin = placements.some(({ placement }) => placement.overflow) ? noteMargin : 0;
        const sheet = pdf.addPage([width + margin * 2, height]);
        const blob = await canvasBlob(canvas);
        const image = await pdf.embedJpg(await blob.arrayBuffer());
        sheet.drawImage(image, { x: margin, y: 0, width, height });
        await image.embed();
        for (const { block, placement } of placements) {
          hasTranslation = true;
          if (placement.overflow) {
            const paragraph = noteContent(block, values, page, source);
            notes.push({ page: number, index: block.index, runs: await noteRuns(pdf, paragraph) });
            const marker = notePosition(block, width, height);
            font.draw(sheet, '[' + block.index + ']', marker.x, marker.y + 8, 8);
          } else {
            for (const box of block.masks) sheet.drawRectangle({
              x: box.x + margin, y: height - box.y - box.height, width: box.width, height: box.height, color: rgb(1, 1, 1),
            });
            for (const line of placement.lines) font.draw(sheet, line.text, line.x + margin, line.baseline, line.size);
          }
        }
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    } catch (error) {
      signal.throwIfAborted();
      throw new Error('第 ' + number + ' 页：' + (error instanceof Error ? error.message : '无法生成译本。'));
    }
  }
  if (!hasTranslation) throw new Error('没有可导出的译文，扫描件需要先做 OCR。');
  progress('正在生成下载文件…');
  await appendNotes(pdf, font, notes, signal);
  font.finish();
  const bytes = await pdf.save();
  signal.throwIfAborted();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

export function downloadDocument(blob: Blob, filename: string, language: string) {
  const safeName = filename.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150) || '文档';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = safeName + '-' + (language === '简体中文' ? '中文' : language) + '译本.pdf';
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
