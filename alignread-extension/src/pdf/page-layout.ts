import type { PDFPageProxy } from 'pdfjs-dist';
import type { PdfLine } from './page-content';

type PlacedLine = PdfLine & { x: number; y: number; end: number; height: number };
export type PdfBand = { columns: PdfLine[][]; split?: number };

function gutter(placed: PlacedLine[], width: number) {
  // Pair nearby baselines across a clear strip. The two columns can have different leading.
  let best = 0, split = .5;
  for (let percent = 23; percent <= 77; percent++) {
    const cut = width * percent / 100;
    let left: PlacedLine | undefined, right: PlacedLine | undefined;
    let pairs = 0;
    for (const line of placed) {
      const clearance = Math.max(line.height * .35, width * .007);
      if (line.end <= cut - clearance) left = line;
      else if (line.x >= cut + clearance) right = line;
      else { left = right = undefined; continue; }
      if (left && right && Math.abs(left.y - right.y) <= Math.min(left.height, right.height)) {
        pairs++;
        left = right = undefined;
      }
    }
    if (pairs > best || (pairs === best && Math.abs(percent - 50) < Math.abs(split * 100 - 50))) {
      best = pairs;
      split = percent / 100;
    }
  }
  return best >= 2 ? split : undefined;
}

function paragraphs(lines: PlacedLine[]) {
  const result: PdfLine[] = [];
  let previous: PlacedLine | undefined;
  let edge = 0;
  for (const line of lines) edge = Math.max(edge, line.end);
  for (const line of lines) {
    const last = result.at(-1);
    if (last && previous && !previous.keep && !line.keep && line.y > previous.y &&
      line.y - previous.y < previous.height * 1.48 &&
      Math.abs(line.height - previous.height) < previous.height * .15 &&
      line.x <= previous.x + line.height * .55 && Math.abs(previous.x - line.x) < line.height * 2 &&
      edge - previous.end < previous.height * 2) {
      const join = /[\u3400-\u9fff]$/.test(last.text) && /^[\u3400-\u9fff]/.test(line.text) ? '' : ' ';
      last.text += join + line.text;
    } else {
      result.push({ ...line });
    }
    previous = line;
  }
  return result;
}

export function pageLayout(lines: PdfLine[], page: PDFPageProxy): PdfBand[] {
  const viewport = page.getViewport({ scale: 1 });
  const placed = lines.map(line => {
    const [left, bottom, right, top] = line.bounds;
    const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
    const [x2, y2] = viewport.convertToViewportPoint(right, top);
    return {
      ...line, x: Math.min(x1, x2), end: Math.max(x1, x2),
      y: (y1 + y2) / 2, height: Math.max(1, Math.abs(y1 - y2))
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: PlacedLine[][] = [];
  for (const line of placed) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (row && first && line.y - first.y <= Math.min(line.height, first.height) * .55) row.push(line);
    else rows.push([line]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  const split = gutter(placed, viewport.width);
  if (!split) return [{ columns: [paragraphs(rows.flat())] }];

  const cut = split * viewport.width;
  const bands: PdfBand[] = [];
  let left: PlacedLine[] = [], right: PlacedLine[] = [];
  function flush() {
    if (left.length && right.length) bands.push({ columns: [paragraphs(left), paragraphs(right)], split });
    else if (left.length || right.length) bands.push({ columns: [paragraphs(left.length ? left : right)] });
    left = []; right = [];
  }
  let previous: PlacedLine | undefined;
  for (const row of rows) {
    const first = row[0]!;
    if (previous && first.y - previous.y > Math.max(previous.height, first.height) * 2.3) flush();
    previous = first;
    if (row.some(line => line.x < cut && line.end > cut)) {
      flush();
      bands.push({ columns: [row] });
    } else {
      for (const line of row) (line.x < cut ? left : right).push(line);
    }
  }
  flush();
  return bands;
}
