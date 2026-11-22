import type { PdfBounds, PdfLine } from './page-content';

export function enclosingBounds(boxes: PdfBounds[]): PdfBounds {
  return [
    Math.min(...boxes.map(box => box[0])), Math.min(...boxes.map(box => box[1])),
    Math.max(...boxes.map(box => box[2])), Math.max(...boxes.map(box => box[3])),
  ];
}

// Join the vertical extent only where glyphs share horizontal space. This keeps
// fraction bars and radicals between their own glyphs without copying the row
// above or below across the full width of the expression.
export function inlineInk(boxes: PdfBounds[]): PdfBounds[] {
  const edges = [...new Set(boxes.flatMap(box => [box[0], box[2]]))].sort((a, b) => a - b);
  const result: PdfBounds[] = [];
  for (let index = 1; index < edges.length; index++) {
    const left = edges[index - 1]!, right = edges[index]!;
    const present = boxes.filter(box => box[0] <= left && box[2] >= right);
    if (!present.length) continue;
    const [, bottom, , top] = enclosingBounds(present);
    const previous = result.at(-1);
    if (previous && previous[2] === left && previous[1] === bottom && previous[3] === top) previous[2] = right;
    else result.push([left, bottom, right, top]);
  }
  return result;
}

// Fraction and radical bars can be paths rather than text glyphs.
export function includeInlineRules(lines: PdfLine[], rules: PdfBounds[]) {
  for (const line of lines) {
    for (const span of line.inline ?? []) {
      const position = span.position;
      if (!position?.ink?.length) continue;
      const { bounds: [left, bottom, right, top], size } = position;
      const margin = size * .3;
      for (const [x1, y1, x2, y2] of rules) {
        if (x1 < left - margin || x2 > right + margin || x2 <= left || x1 >= right ||
          y1 < bottom - size * .1 || y2 > top + size * .1) continue;
        const supported = position.ink.some(box => Math.min(x2, box[2]) - Math.max(x1, box[0]) > 0 &&
          y1 >= box[1] - size * .45 && y2 <= box[3] + size * .45);
        if (!supported) continue;
        const stroke: PdfBounds = [x1 - .35, y1 - .45, x2 + .35, y2 + .45];
        position.ink.push(stroke);
        position.bounds = enclosingBounds([position.bounds, stroke]);
      }
    }
  }
}
