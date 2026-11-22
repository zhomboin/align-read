import type { PDFPageProxy } from 'pdfjs-dist';
import { inplaceBlocks, placeBlock, type InplaceBlock, type Rect } from './inplace-layout';
import { renderCanvas, translationRow, type PageContent, type TranslationRow } from './show-page';

export const noteMargin = 25;
export function notePosition(block: InplaceBlock, width: number, height: number) {
  const first = block.boxes[0]!;
  return { x: first.x < width / 2 ? 2 : width + noteMargin + 2, y: Math.max(1, Math.min(height - 10, first.y)) };
}

export function noteContent(block: InplaceBlock, values: Map<string, string>, page: PDFPageProxy,
  image: { canvas: HTMLCanvasElement; scale: number }) {
  const paragraph = document.createElement('p');
  for (const item of block.items) {
    const span = document.createElement('span');
    translationRow(span, item, page, image)(values.get(item.id));
    if (paragraph.hasChildNodes()) paragraph.append(' ');
    paragraph.append(span);
  }
  return paragraph;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export async function displayInplace(page: PDFPageProxy, model: PageContent, signal: AbortSignal) {
  const image = await renderCanvas(page, signal);
  const { canvas } = image;
  signal.throwIfAborted();
  const { blocks, width, height } = inplaceBlocks(page, model, canvas);
  const fullWidth = width + noteMargin * 2;
  const frame = document.createElement('div');
  frame.className = 'pdf-inplace';
  frame.style.aspectRatio = fullWidth + ' / ' + height;
  canvas.style.left = (noteMargin / fullWidth * 100) + '%';
  canvas.style.width = (width / fullWidth * 100) + '%';
  const layer = svgElement('svg', { viewBox: '0 0 ' + fullWidth + ' ' + height, class: 'pdf-overlays' });
  frame.append(canvas, layer);
  const rows = new Map<string, TranslationRow>();
  const values = new Map<string, string>();
  for (const block of blocks) {
    const group = svgElement('g', {});
    layer.append(group);
    let last: string | undefined;
    const draw = () => {
      if (block.items.some(item => !values.has(item.id))) {
        last = undefined;
        group.replaceChildren();
        return;
      }
      const key = JSON.stringify(block.items.map(item => values.get(item.id)));
      if (key === last) return;
      last = key;
      group.replaceChildren();
      const placement = placeBlock(block, values);
      if (!placement) return;
      const boxRect = (box: Rect, fill: string) => svgElement('rect', {
        x: box.x + noteMargin, y: box.y, width: box.width, height: box.height, fill,
      });
      if (placement.overflow) {
        const button = svgElement('g', {
          role: 'button', tabindex: 0, 'aria-label': '查看第 ' + block.index + ' 段译文',
          class: 'pdf-note'
        });
        const show = () => {
          const dialog = document.querySelector<HTMLDialogElement>('#detail')!;
          dialog.querySelector('p')!.replaceWith(noteContent(block, values, page, image));
          dialog.showModal();
        };
        button.addEventListener('click', show);
        button.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); }
        });
        const marker = notePosition(block, width, height);
        const label = svgElement('text', { x: marker.x, y: marker.y + 8, 'font-size': 8, fill: '#205440' });
        label.textContent = '[' + block.index + ']';
        button.append(...block.boxes.map(box => boxRect(box, 'transparent')), label);
        group.append(button);
      } else {
        group.append(...block.masks.map(box => boxRect(box, 'white')));
        for (const line of placement.lines) {
          const text = svgElement('text', {
            x: line.x + noteMargin, y: line.baseline, 'font-size': line.size,
            'font-family': 'sans-serif', fill: '#161616'
          });
          text.textContent = line.text;
          group.append(text);
        }
      }
    };
    for (const item of block.items) rows.set(item.id, value => {
      if (value === values.get(item.id)) return;
      if (value === undefined) values.delete(item.id);
      else values.set(item.id, value);
      draw();
    });
  }
  const content = document.createDocumentFragment();
  content.append(frame);
  return { content, rows, canvas: undefined };
}
