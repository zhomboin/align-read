import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFOperatorList } from 'pdfjs-dist/types/src/display/api';
import type { PdfBounds } from './page-content';

const identity = [1, 0, 0, 1, 0, 0];
const imageBox = [0, 0, 1, 1];
const isImage = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject]);
const isPaint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);

const width = (box: PdfBounds) => box[2] - box[0];
const height = (box: PdfBounds) => box[3] - box[1];
const intersect = (a: PdfBounds, b: PdfBounds): PdfBounds =>
  [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const union = (a: PdfBounds, b: PdfBounds): PdfBounds =>
  [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

function ruledTables(horizontal: PdfBounds[], vertical: PdfBounds[]) {
  const tables: PdfBounds[] = [];
  // Join only intersecting rules. Isolated title rules, footnotes and equation bars are left alone.
  while (horizontal.length && vertical.length) {
    const rules = [horizontal.pop()!];
    let across = 1, down = 0;
    let bounds = rules[0]!;
    function join(pool: PdfBounds[], rule: PdfBounds) {
      let count = 0;
      for (let index = pool.length - 1; index >= 0; index--) {
        const other = pool[index]!;
        const overlap = intersect(rule, other);
        if (width(overlap) < -2 || height(overlap) < -2) continue;
        pool.splice(index, 1);
        rules.push(other);
        bounds = union(bounds, other);
        count++;
      }
      return count;
    }
    for (const rule of rules) {
      if (width(rule) >= height(rule)) down += join(vertical, rule);
      else across += join(horizontal, rule);
    }
    if (across >= 2 && down >= 2 && width(bounds) >= 50 && height(bounds) >= 20) tables.push(bounds);
  }
  return tables;
}

export function graphicRegions(list: PDFOperatorList, page: PdfBounds) {
  type Form = { region?: PdfBounds; start: number; paint: number };
  type State = { matrix: number[]; form?: Form };
  const figures: PdfBounds[] = [];
  const horizontal: PdfBounds[] = [], vertical: PdfBounds[] = [];
  const stack: State[] = [];
  let state: State = { matrix: identity };
  const transform = (bounds: ArrayLike<number>, matrix = state.matrix) => {
    const result: PdfBounds = [Infinity, Infinity, -Infinity, -Infinity];
    Util.axialAlignedBoundingBox(Array.from(bounds), matrix, result);
    return intersect(result, page);
  };
  const substantial = (box: PdfBounds) => width(box) >= 20 && height(box) >= 16;
  list.fnArray.forEach((op, index) => {
    const args = list.argsArray[index];
    switch (op) {
      case OPS.save:
        stack.push({ ...state });
        break;
      case OPS.restore:
        state = stack.pop() ?? state;
        break;
      case OPS.transform:
        state.matrix = Util.transform(state.matrix, args);
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push(state);
        const matrix = args[0] ? Util.transform(state.matrix, args[0]) : state.matrix;
        state = { matrix, form: { region: args[1] ? transform(args[1], matrix) : undefined, start: figures.length, paint: 0 } };
        break;
      }
      case OPS.paintFormXObjectEnd: {
        const form = state.form;
        if (form?.region && substantial(form.region) && width(form.region) * height(form.region) < width(page) * height(page) * .72 &&
          (figures.length > form.start || form.paint >= 3)) {
          figures.splice(form.start);
          figures.push(form.region);
        }
        state = stack.pop() ?? state;
        break;
      }
      case OPS.constructPath: {
        if (!args[2] || !isPaint.has(args[0])) break;
        const box = transform(args[2]);
        // Record drawing evidence on the form even when the path is inside a saved graphics state.
        if (state.form) state.form.paint++;
        if (horizontal.length + vertical.length >= 256) break;
        if (width(box) >= 30 && height(box) >= 0 && height(box) <= 2) horizontal.push(box);
        if (height(box) >= 12 && width(box) >= 0 && width(box) <= 2) vertical.push(box);
        break;
      }
      default: {
        if (!isImage.has(op)) break;
        const box = transform(imageBox);
        if (substantial(box)) figures.push(box);
      }
    }
  });
  // Prefer one complete drawing over individual images or rules inside it.
  const regions: PdfBounds[] = [];
  for (const box of [...figures, ...ruledTables(horizontal, vertical)].sort((a, b) => width(b) * height(b) - width(a) * height(a))) {
    if (!regions.some(other => {
      const overlap = intersect(other, box);
      return width(overlap) > width(box) * .95 && height(overlap) > height(box) * .95;
    })) regions.push(box);
  }
  return regions;
}
