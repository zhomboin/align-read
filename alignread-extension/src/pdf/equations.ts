import type { PdfBounds, PlacedLine } from './page-content';

const equationTag = /^\(\s*(?:[A-Z]\.)?\d+(?:\.\d+)*[a-z]?\s*\)$/i;
const mathWords = /^(?:arcsin|arccos|arctan|sin|cos|tan|sinh|cosh|tanh|exp|log|ln|lim|sup|inf|min|max|det|mod|gcd|arg)$/i;
const words = /\p{L}{2,}/gu;
const codeCall = /^([\p{L}_][\p{L}\p{N}_.]*)\([^]*\)[.,;]?$/u;
const mathAssignment = /^[\p{L}_][\p{L}\p{N}_]*\s*=\s*[^=]*?:=\s*\p{L}/u;

function codeName(line: PlacedLine) {
  return line.code ? codeCall.exec(line.text)?.[1] : undefined;
}

export function hasProse(text: string, minimum = 3) {
  return (text.match(words) ?? []).filter(word => !mathWords.test(word)).length >= minimum ||
    /[\u3400-\u9fff]{4,}/u.test(text);
}

export function supportsEquation(line: PlacedLine) {
  if (line.style || line.graphic) return false;
  if (codeName(line)) return true;
  if (!(line.math || line.keep || mathWords.test(line.text))) return false;
  // Named quantities can be ordinary-font prefixes of a symbolic definition.
  if (line.keep && line.math && !line.code && mathAssignment.test(line.text) && !/\p{L}{2,}\s+\p{L}{2,}/u.test(line.text)) return true;
  const text = line.textWithoutMath ?? line.text;
  // Short variable names and roman operators can coexist with math-font glyphs in a display equation.
  const narrative = text.replace(/\b(?:[A-Z][A-Z0-9]+\s*|[A-Za-z][A-Za-z0-9_]*)(?=\()/g, '')
    .replace(/\b[A-Z]{2,}(?=[a-z]?\b|[\d_])/g, '');
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
  const call = codeName(a);
  if (call && codeName(b) === call && Math.abs(a.x - b.x) <= em * .35 &&
    Math.abs(a.y - b.y) <= em * 1.7) return true;
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

function insideCrop(line: PlacedLine, crop: PlacedLine, tolerance = .25) {
  return line.x >= crop.x && line.end <= crop.end &&
    Math.abs(line.y - crop.y) + line.height / 2 <= crop.height / 2 + tolerance;
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
    const limit = line.y + Math.max((line.height + tallest) / 2 + em * .42, codeName(line) ? em * 1.7 : 0);
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

  const formulas = [...components.values()].filter(group => group.some(line => line.math || codeName(line))).map(parts => ({
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
    const first = matches[0];
    if (!first) continue;
    const other = matches.find(({ region }) => region !== first.region &&
      (region.y - tag.y) * (first.region.y - tag.y) < 0 &&
      Math.abs(region.y - first.region.y) < em * 1.6 &&
      Math.abs(first.region.y + region.y - 2 * tag.y) < em * .5 &&
      Math.min(region.end, first.region.end) > Math.max(region.x, first.region.x) &&
      side(tag, cut) * side(region, cut) !== -1);
    if (other) {
      first.parts.push(...other.parts);
      first.region = enclosingLine(first.parts, '');
      formulas.splice(formulas.indexOf(other), 1);
    }
    first.tag = tag;
  }

  const replaced = new Set<PlacedLine>();
  const numbered: PlacedLine[] = [];
  const unnumbered: PlacedLine[] = [];
  for (const { parts, tag } of formulas) {
    const constituents = tag ? [...parts, tag] : parts;
    for (const line of constituents) replaced.add(line);
    const label = tag ? '公式 ' + tag.text : parts.length === 1 ? parts[0]!.text : '公式';
    (tag ? numbered : unnumbered).push(enclosingLine(constituents, label));
  }
  // The numbered crop renders ink across the gaps between fragments.
  const covered = (line: PlacedLine) => numbered.some(crop => insideCrop(line, crop, em * .18));
  const remaining = lines.filter(line => !replaced.has(line) &&
    !(!line.style && !line.graphic && !hasProse(line.text, 4) && covered(line)));
  const blocks = [...numbered, ...unnumbered.filter(line => !covered(line))];
  for (const block of blocks) isolateInk(block, remaining, em);
  return [...remaining, ...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}
