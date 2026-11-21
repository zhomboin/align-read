import type { InlineMath, TextRun } from './inline-math';
import type { PdfBounds, PdfLine } from './page-content';

type Fragment = PdfLine & { runs: TextRun[] };
const words = /[A-Za-z]{2,}(?:['’\-][A-Za-z]+)*/g;
const shortWords = /^(?:am|an|as|at|be|by|do|go|if|in|is|it|no|of|on|or|so|to|up|us|we)$/i;
const operators = /^(?:sin|cos|tan|exp|log|lim|spline|min|max|silu|sup|inf|det|argmin|argmax)$/i;

function prose(line: Fragment) {
  if (line.keep) return [];
  const fullSize = Math.max(...line.runs.map(run => run.size));
  return [...line.text.matchAll(words)].filter(match =>
    (match[0].length > 2 || shortWords.test(match[0])) &&
    !operators.test(match[0]) && !(line.math && /^[A-Z]+$/.test(match[0])) && !line.inline?.some(span =>
      match.index >= span.start && match.index + match[0].length <= span.end) &&
    !line.runs.some(run => run.start <= match.index && run.end > match.index &&
      (run.math || run.size < fullSize * .86)));
}

function adjacent(bounds: PdfBounds, left: Fragment, right: Fragment) {
  if (left.code || right.code || !left.math && !right.math && !left.keep && !right.keep) return false;
  const [a, low, b, high] = bounds;
  const [c, bottom, d, top] = right.bounds;
  const em = Math.max(left.fontSize ?? 0, right.fontSize ?? 0,
    (left.bounds[3] - left.bounds[1]) * .8, (top - bottom) * .8);
  const overlap = Math.min(high, top) - Math.max(low, bottom);
  const script = right.keep && top - bottom <= em * 1.12 && d <= b + em * .3 && c >= b - em * 4;
  const neighboringGlyphs = left.keep && right.keep && c >= left.bounds[0] - em * .45 &&
    c <= left.bounds[2] + em * .55 && overlap >= (top - bottom) * .32;
  const touching = Math.abs(c - b) <= em * .1;
  return c >= a && (neighboringGlyphs || (script ? overlap >= -em * .1 :
    c - b >= -em * 1.25 && c - b <= em * .5 && d >= b - em * .45 &&
    overlap >= Math.min(high - low, top - bottom) * (touching ? .19 : .33)));
}

function sliceBounds(line: Fragment, start: number, end: number) {
  return line.runs.flatMap(run => {
    if (run.end <= start || run.start >= end) return [];
    const [left, bottom, right, top] = run.bounds;
    const advance = (right - left) / (run.end - run.start);
    return [[left + Math.max(0, start - run.start) * advance, bottom,
    right - Math.max(0, run.end - end) * advance, top] as PdfBounds];
  });
}

function enclosing(boxes: PdfBounds[]): PdfBounds {
  return [
    Math.min(...boxes.map(box => box[0])), Math.min(...boxes.map(box => box[1])),
    Math.max(...boxes.map(box => box[2])), Math.max(...boxes.map(box => box[3])),
  ];
}

function combine(parts: Fragment[], head: RegExpMatchArray | undefined, tail: RegExpMatchArray | undefined): PdfLine | undefined {
  const first = parts[0]!, last = parts.at(-1)!;
  const start = head ? head.index! + head[0].length : 0;
  const stop = tail?.index ?? last.text.length;
  const before = first.text.slice(0, start).trimEnd();
  const after = last.text.slice(stop);
  const equationParts = parts.map((part, index) => {
    const from = index === 0 ? start : 0;
    const to = index === parts.length - 1 ? stop : part.text.length;
    return { text: part.text.slice(from, to).trim(), boxes: sliceBounds(part, from, to) };
  });
  const formula = equationParts.map(part => part.text).filter(Boolean).join(' ');
  const reference = (head ? first : last).runs.find(run => /\p{L}{3}/u.test(run.text) && !run.math);
  const boxes = equationParts.flatMap(part => part.boxes);
  if (!formula || !reference || !boxes.length) return;

  const prefix = before ? before + ' ' : '';
  const suffix = after ? ' ' + after : '';
  const end = prefix.length + formula.length;
  const inline: InlineMath[] = [
    ...first.inline?.filter(span => span.end <= before.length) ?? [],
    { start: prefix.length, end, position: { bounds: enclosing(boxes), baseline: reference.baseline, size: reference.size } },
    ...last.inline?.filter(span => span.start >= stop).map(span =>
      ({ ...span, start: span.start + end + 1 - stop, end: span.end + end + 1 - stop })) ?? [],
  ];
  const body = head ? first : last;
  return {
    text: prefix + formula + suffix, bounds: enclosing(parts.map(part => part.bounds)), keep: false,
    math: true, inline, textWithoutMath: before + suffix, fontSize: body.fontSize,
    noteStart: body.noteStart, labelEnd: head ? body.labelEnd : undefined,
  };
}

// PDF text extraction can end a row at a fraction bar, fraction limit or subscript.
// Rejoin adjacent pieces only when ordinary prose borders the math on the same row.
export function mergeInlineFragments(lines: Fragment[]) {
  const result: PdfLine[] = [];
  const proseWords = lines.map(prose);
  for (let index = 0; index < lines.length;) {
    const head = proseWords[index]!.at(-1);
    let end = index;
    let bounds = lines[index]!.bounds;
    while (end + 1 < lines.length && adjacent(bounds, lines[end]!, lines[end + 1]!)) {
      end++;
      bounds = enclosing([bounds, lines[end]!.bounds]);
      if (proseWords[end]!.length) break;
    }
    const tail = end > index ? proseWords[end]![0] : undefined;
    const merged = end > index && (head || tail) && (end - index > 1 || !head || !tail)
      ? combine(lines.slice(index, end + 1), head, tail) : undefined;
    if (merged) {
      result.push(merged);
      index = end + 1;
    } else {
      const { runs, ...line } = lines[index++]!;
      result.push(line);
    }
  }
  return result;
}
