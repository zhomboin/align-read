import type { PdfBounds, PlacedLine } from './page-content';
import { withoutMath } from './inline-math';

const equationTag = /^\(\s*(?:[A-Z]\.)?\d+(?:\.\d+)*[a-z]?\s*\)$/i;
const mathWords = /^(?:arcsin|arccos|arctan|sin|cos|tan|sinh|cosh|tanh|exp|log|ln|lim|sup|inf|min|max|det|mod|gcd|arg)$/i;
const words = /\p{L}{2,}/gu;

export function hasProse(text: string, minimum = 3) {
  return (text.match(words) ?? []).filter(word => !mathWords.test(word)).length >= minimum ||
    /[\u3400-\u9fff]{4,}/u.test(text);
}

export function supportsEquation(line: PlacedLine) {
  if (line.style || line.graphic || !(line.math || line.keep || mathWords.test(line.text))) return false;
  const text = line.inline ? withoutMath(line.text, line.inline) : line.text;
  // Short variable names and roman operators can coexist with math-font glyphs in a display equation.
  const narrative = text.replace(/\b[A-Z][A-Z0-9]+\s*(?=\()/g, '');
  return !/\p{Script=Han}/u.test(narrative) &&
    !(narrative.match(/\p{L}{3,}/gu) ?? []).some(word => !mathWords.test(word) &&
      !/\p{Script=Greek}.*\p{Script=Latin}|\p{Script=Latin}.*\p{Script=Greek}/u.test(word));
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

function isolateInk(block: PlacedLine, neighbors: PlacedLine[], em: number) {
  const upper = block.y - block.height / 2, lower = block.y + block.height / 2;
  let top = 0, bottom = Infinity;
  for (const line of neighbors) {
    if (line.keep || line.x >= block.end || line.end <= block.x) continue;
    const first = line.y - line.height / 2, last = line.y + line.height / 2;
    // Text-item boxes include the full font em. Trim only small overlaps with adjacent prose.
    if (line.y < block.y && last <= upper + em * .4) top = Math.max(top, last);
    if (line.y > block.y && first >= lower - em * .4) bottom = Math.min(bottom, first);
  }
  block.equationClip = [top, bottom];
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
    const matches = formulas.filter(({ tag: taken, region }) => {
      if (taken || side(tag, cut) * side(region, cut) === -1 || verticalGap(tag, region) > em * .35) return false;
      if (tag.x >= region.end || tag.end <= region.x) return true;
      // A formula which takes the full width can place its number below its last baseline.
      const nearOuterEdge = tag.x >= region.end - em * 3 || tag.end <= region.x + em * 3;
      return nearOuterEdge && tag.y - tag.height / 2 >= region.y + region.height / 2 - em * .35;
    });
    matches.sort((a, b) => {
      const distance = ({ region }: typeof a) => Math.abs(tag.y - region.y) * 2 +
        Math.max(0, tag.x - region.end, region.x - tag.end);
      return distance(a) - distance(b);
    });
    if (matches[0]) matches[0].tag = tag;
  }

  const replaced = new Set<PlacedLine>();
  const blocks: PlacedLine[] = [];
  for (const { parts, tag } of formulas) {
    const constituents = tag ? [...parts, tag] : parts;
    for (const line of constituents) replaced.add(line);
    blocks.push(enclosingLine(constituents, tag ? '公式 ' + tag.text : parts.length === 1 ? parts[0]!.text : '公式'));
  }
  const remaining = lines.filter(line => !replaced.has(line));
  for (const block of blocks) isolateInk(block, remaining, em);
  return [...remaining, ...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}
