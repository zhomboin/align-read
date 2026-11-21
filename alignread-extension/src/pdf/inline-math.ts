import type { PdfBounds } from './page-content';

type Range = { start: number; end: number };
type Position = { bounds: PdfBounds; baseline: number; size: number };
export type TextRun = Range & Position & { text: string; math: boolean; code: boolean };
type Script = Range & { kind: 'sup' | 'sub' };
export type InlineMath = Range & { position?: Position; scripts?: Script[]; leading?: boolean };

const atom = String.raw`(?:\d+(?:\.\d+)?[\p{L}]?|(?:\p{Script=Greek}[A-Za-z]|[\p{L}\u{1d400}-\u{1d7ff}])[\p{N}\u2070-\u209f]*)(?:_[\p{L}\p{N}]+)?`;
const expression = new RegExp(String.raw`(?<![\p{L}\p{N}_])${atom}(?:\s*(?:[=≠≤≥<>≈∼≡∈∉∝+×÷−±*/^]|-(?=\s|\d))\s*${atom})+(?![\p{L}\p{N}_])`, 'gu');
const functionCall = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:[A-Za-z\p{Script=Greek}]|[A-Z][A-Z0-9]{1,12}|sin|cos|tan|exp|log|ln|spline|silu)\s*\(\s*${atom}(?:\s*[,;+×−±*/^]\s*${atom})*\s*\)`, 'gu');
const mathSymbol = /(?<!\p{L})\p{Script=Greek}[\p{N}\u2070-\u209f]*(?!\p{L})|[∼≈≡∈∉∝∞]/gu;
const url = /https?:\/\/[^\s<>"{}]+[^\s<>"{}.,;:!?)\]]/giu;
const numberList = /\[\s*\d+(?:\s*,\s*\d+)+\s*\]/gu;
const notation = /^(?:[\p{N}\p{Sm}\s.,()[\]{}′]|exp|silu|spline|cos|sin|tan|log)*$/u;
const superscripts = /(?<![\p{L}\p{N}])[\p{L}\d]+[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀-₉]+/gu;
const mathRun = /^(?:[\p{N}\p{Sm}\p{P}\s]+|[\p{L}]{1,2}|sin|cos|exp|log|lim)$/u;

export function mainTextRun(runs: TextRun[]) {
  return runs.reduce<TextRun | undefined>((widest, run) =>
    /\p{L}{3}/u.test(run.text) && !run.math && !run.code && (!widest || run.size > widest.size ||
      (run.size === widest.size && run.end - run.start > widest.end - widest.start)) ? run : widest, undefined);
}

export function inlineMath(text: string, runs: TextRun[], proseRun = mainTextRun(runs)) {
  const ranges: Range[] = [expression, functionCall, mathSymbol, superscripts, numberList, url].flatMap(pattern =>
    Array.from(text.matchAll(pattern), match => ({ start: match.index, end: match.index + match[0].length })));
  const scripts: Script[] = [];

  for (const [index, run] of runs.entries()) {
    const value = run.text.trim();
    if (!value) continue;
    const start = run.start + run.text.indexOf(value);
    const end = start + value.length;
    if (run.code || run.math && mathRun.test(value)) ranges.push({ start, end });
    const previous = runs[index - 1];
    const base = previous?.text.match(/(?:^|[^\p{L}\p{N}_])([\p{L}]|\d+(?:\.\d+)?)$/u)?.[1];
    // The base provides a baseline even in a fragment wholly made of math glyphs.
    const attached = previous && base && Math.abs(previous.bounds[2] - run.bounds[0]) <= previous.size * .3;
    const reference = attached ? previous : proseRun;
    if (!reference || run.size > reference.size * .85 || Math.abs(run.baseline - reference.baseline) < reference.size * .12 ||
      !/^[\p{L}\p{N}\p{Sm}()+-]{1,5}$/u.test(value)) continue;
    ranges.push({ start: attached ? previous.end - base.length : start, end });
    scripts.push({ start, end, kind: run.baseline > reference.baseline ? 'sup' : 'sub' });
  }

  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    const gap = last ? text.slice(last.end, range.start) : '';
    if (last && gap.length <= 12 && notation.test(gap)) {
      last.end = Math.max(last.end, range.end);
    }
    else merged.push(range);
  }
  return merged.map(({ start, end }): InlineMath => {
    const spanScripts = scripts.filter(script => script.start >= start && script.end <= end)
      .map(script => ({ ...script, start: script.start - start, end: script.end - start }));
    const glyphs = runs.filter(run => run.end > start && run.start < end && run.text.trim());
    if (!proseRun || !glyphs.length || glyphs.some(run => /\S/.test(run.text.slice(0, Math.max(0, start - run.start))) ||
      (run.end > end && /\S/.test(run.text.slice(end - run.start))))) return { start, end, scripts: spanScripts };

    const bounds: PdfBounds = [
      Math.min(...glyphs.map(run => run.bounds[0])), Math.min(...glyphs.map(run => run.bounds[1])),
      Math.max(...glyphs.map(run => run.bounds[2])), Math.max(...glyphs.map(run => run.bounds[3])),
    ];
    return { start, end, scripts: spanScripts, position: { bounds, baseline: proseRun.baseline, size: proseRun.size } };
  });
}

export function withoutMath(text: string, spans: InlineMath[]) {
  let start = 0;
  const words = spans.map(span => {
    const before = text.slice(start, span.start);
    start = span.end;
    return before;
  });
  return [...words, text.slice(start)].join(' ');
}
