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
    if (last && previous && !previous.keep && !line.keep && (!last.style || last.style === 'caption') && !line.style &&
      line.y > previous.y &&
      line.y - previous.y < previous.height * 1.48 &&
      Math.abs(line.height - previous.height) < previous.height * .15 &&
      line.x <= previous.x + line.height * .55 && Math.abs(previous.x - line.x) < line.height * 2 &&
      edge - previous.end < previous.height * 2) {
      const join = last.text.endsWith('\u00ad') || (/[-\u2010]$/.test(last.text) && /^\p{L}/u.test(line.text)) ||
        (/[\u3400-\u9fff]$/.test(last.text) && /^[\u3400-\u9fff]/.test(line.text)) ? '' : ' ';
      last.text = last.text.replace(/\u00ad$/, '') + join + line.text;
    } else {
      result.push({ ...line });
    }
    previous = line;
  }
  return result;
}

function markStyles(lines: PlacedLine[], width: number, height: number) {
  for (const line of lines) {
    if (/^(?:figure|fig\.?|table)\s+\d+(?:\.\d+)*\s*[:：.](?:\s|$)|^[图表]\s*\d+.*[:：]/i.test(line.text)) {
      line.style = 'caption';
    }
  }

  const abstract = lines.find(line => line.y < height * .44 && /^abstract$|^摘要$/i.test(line.text));
  if (!abstract) return lines;
  abstract.style = 'heading';
  const before = lines.filter(line => line.y < abstract.y);
  const title = before.reduce<PlacedLine | undefined>((largest, line) => {
    if (line.keep || Math.abs(line.x + line.end - width) > width * .16) return largest;
    return !largest || line.height > largest.height ? line : largest;
  }, undefined);
  if (!title || title.height < abstract.height * 1.3) return lines;
  title.style = 'title';
  const byline = before.filter(line => line.y > title.y + title.height * .75);
  if (!byline.length || byline.length > 30 || abstract.y - title.y > height * .23 ||
    byline.some(line => line.graphic)) return lines;
  const bounds = [...byline[0]!.bounds] as PdfLine['bounds'];
  for (const line of byline) {
    bounds[0] = Math.min(bounds[0], line.bounds[0]);
    bounds[1] = Math.min(bounds[1], line.bounds[1]);
    bounds[2] = Math.max(bounds[2], line.bounds[2]);
    bounds[3] = Math.max(bounds[3], line.bounds[3]);
  }
  const metadata: PlacedLine = {
    ...byline[0]!, bounds, text: '作者与单位', keep: true, style: 'byline',
    x: Math.min(...byline.map(line => line.x)), end: Math.max(...byline.map(line => line.end)),
  };
  return [...before.filter(line => !byline.includes(line)), metadata, ...lines.filter(line => line.y >= abstract.y)];
}

export function pageLayout(lines: PdfLine[], page: PDFPageProxy): PdfBand[] {
  const viewport = page.getViewport({ scale: 1 });
  const positions = lines.map(line => {
    const [left, bottom, right, top] = line.bounds;
    const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
    const [x2, y2] = viewport.convertToViewportPoint(right, top);
    return {
      ...line, x: Math.min(x1, x2), end: Math.max(x1, x2),
      y: (y1 + y2) / 2, height: Math.max(1, Math.abs(y1 - y2))
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = markStyles(positions, viewport.width, viewport.height);

  const rows: PlacedLine[][] = [];
  for (const line of placed) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (row && first && line.y - first.y <= Math.min(line.height, first.height) * .55) row.push(line);
    else rows.push([line]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  const split = gutter(placed.filter(line => !line.graphic && !line.style), viewport.width);
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
