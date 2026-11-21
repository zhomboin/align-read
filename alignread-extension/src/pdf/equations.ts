import type { PdfBounds, PlacedLine } from './page-content';

const equationTag = /^\(\s*(?:[A-Z]\.)?\d+(?:\.\d+)*[a-z]?\s*\)$/i;
const mathWords = /^(?:arcsin|arccos|arctan|sin|cos|tan|sinh|cosh|tanh|exp|log|ln|lim|sup|inf|min|max|det|mod|gcd|arg)$/i;
const words = /\p{L}{2,}/gu;

export function hasProse(text: string) {
  return (text.match(words) ?? []).filter(word => !mathWords.test(word)).length >= 3 ||
    /[\u3400-\u9fff]{4,}/u.test(text);
}

function supportsEquation(line: PlacedLine) {
  return !line.style && !line.graphic && !hasProse(line.text) &&
    (line.math || line.keep || mathWords.test(line.text));
}

function side(line: PlacedLine, cut: number) {
  if (!cut || (line.x < cut && line.end > cut)) return 0;
  return line.end <= cut ? -1 : 1;
}

function verticalGap(a: PlacedLine, b: PlacedLine) {
  return Math.abs(a.y - b.y) - (a.height + b.height) / 2;
}

function sameEquation(a: PlacedLine, b: PlacedLine, em: number, cut: number) {
  const gap = Math.max(a.x, b.x) - Math.min(a.end, b.end);
  // Extensible delimiters are often emitted as narrow glyphs above their contents.
  const delimiter = gap <= em * .35 && Math.min(a.end - a.x, b.end - b.x) <= em;
  if (verticalGap(a, b) > em * (delimiter ? .42 : .20)) return false;
  const acrossGutter = side(a, cut) * side(b, cut) === -1;
  return gap <= em * (acrossGutter ? .35 : 2.25);
}

function enclosingLine(lines: PlacedLine[], text: string): PlacedLine {
  const bounds: PdfBounds = [Infinity, Infinity, -Infinity, -Infinity];
  let x = Infinity, end = -Infinity, top = Infinity, bottom = -Infinity;
  for (const line of lines) {
    const [left, low, right, high] = line.bounds;
    bounds[0] = Math.min(bounds[0], left);
    bounds[1] = Math.min(bounds[1], low);
    bounds[2] = Math.max(bounds[2], right);
    bounds[3] = Math.max(bounds[3], high);
    x = Math.min(x, line.x);
    end = Math.max(end, line.end);
    top = Math.min(top, line.y - line.height / 2);
    bottom = Math.max(bottom, line.y + line.height / 2);
  }
  return { text, keep: true, style: 'equation', bounds, x, end, y: (top + bottom) / 2, height: bottom - top };
}

export function groupEquations(lines: PlacedLine[], cut: number) {
  const candidates = lines.filter(line => supportsEquation(line) && !equationTag.test(line.text));
  if (!candidates.length) return lines;
  const heights = lines.filter(line => !line.keep || hasProse(line.text)).map(line => line.height).sort((a, b) => a - b);
  const em = heights[Math.floor(heights.length / 2)] ?? 12;
  const tallest = candidates.reduce((height, line) => Math.max(height, line.height), 0);

  // Join adjacent ink bounds before sorting reading order. The text layer emits
  // fractions, limits and delimiters at different baselines and in arbitrary order.
  const parent = candidates.map((_, index) => index);
  function root(index: number) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  }
  for (const [index, line] of candidates.entries()) {
    const limit = line.y + (line.height + tallest) / 2 + em * .42;
    for (let next = index + 1; next < candidates.length && candidates[next]!.y <= limit; next++) {
      if (sameEquation(line, candidates[next]!, em, cut)) parent[root(next)] = root(index);
    }
  }
  const components = new Map<number, PlacedLine[]>();
  for (const [index, line] of candidates.entries()) {
    const key = root(index);
    const group = components.get(key) ?? [];
    group.push(line);
    components.set(key, group);
  }

  const formulas = [...components.values()].filter(group => group.some(line => line.math)).map(parts => ({
    parts, region: enclosingLine(parts, ''), tag: undefined as PlacedLine | undefined,
  }));
  for (const tag of lines.filter(line => !line.style && equationTag.test(line.text))) {
    const matches = formulas.filter(({ tag: taken, region }) => !taken && side(tag, cut) * side(region, cut) !== -1 &&
      verticalGap(tag, region) <= 0 && (tag.x >= region.end || tag.end <= region.x));
    matches.sort((a, b) => {
      const distance = ({ region }: typeof a) => Math.abs(tag.y - region.y) * 2 +
        Math.max(tag.x - region.end, region.x - tag.end);
      return distance(a) - distance(b);
    });
    if (matches[0]) matches[0].tag = tag;
  }

  const replaced = new Set<PlacedLine>();
  const blocks: PlacedLine[] = [];
  for (const { parts, tag, region } of formulas) {
    if (parts.length < 2 && !tag) continue;
    const constituents = tag ? [...parts, tag] : parts;
    for (const line of constituents) replaced.add(line);
    const block = enclosingLine(constituents, tag ? '公式 ' + tag.text : '公式');
    if (tag) {
      // Leave the expression centered while preserving the original offset of its number.
      block.blankBefore = Math.max(0, tag.end - region.end);
      block.blankAfter = Math.max(0, region.x - tag.x);
    }
    blocks.push(block);
  }
  return [...lines.filter(line => !replaced.has(line)), ...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}
