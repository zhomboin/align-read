import type { TranslationItem } from '../shared/reader-messages';
import type { InlineMath } from './inline-math';

export type PdfTranslationItem = TranslationItem & { inline?: InlineMath[] };

export function mathPlaceholders(item: PdfTranslationItem) {
  let prefix = 'ARF';
  const original = item.text.toUpperCase();
  while (original.includes('[[' + prefix)) prefix += 'X';
  const pattern = new RegExp('\\[\\[\\s*' + prefix + '\\s*(\\d+)\\s*\\]\\]', 'gi');
  const token = (index: number) => '[[' + prefix + index + ']]';
  const spans = item.inline ?? [];
  const math = spans.map(span => item.text.slice(span.start, span.end));
  const pieces = spans.map((span, index) => item.text.slice(spans[index - 1]?.end ?? 0, span.start));
  pieces.push(item.text.slice(spans.at(-1)?.end ?? 0));

  return {
    spans, math, pieces,
    combine(text: string[]) {
      return text.map((part, index) => part + (index < spans.length ? token(index) : '')).join('');
    },
    parse(value: string) {
      if (!spans.length) return [value];
      const found = new Set<number>();
      const output: (string | number)[] = [];
      let end = 0;
      for (const match of value.matchAll(pattern)) {
        const index = Number(match[1]);
        if (index >= spans.length || found.has(index)) return;
        found.add(index);
        output.push(value.slice(end, match.index), index);
        end = match.index + match[0].length;
      }
      if (found.size !== spans.length) return;
      output.push(value.slice(end));
      return output;
    },
  };
}

export function alignMarkerBoundaries(text: string, parts: string[]) {
  if (parts.length < 2) return parts;
  const markers = [...text.matchAll(/\[\[ARFX*\d+\]\]/g)];
  if (!markers.length) return parts;
  let from = 0, boundary = 0;
  return parts.map(part => {
    boundary += part.length;
    const marker = markers.find(match => match.index < boundary && match.index + match[0].length > boundary);
    const to = marker?.index ?? boundary;
    const chunk = text.slice(from, to);
    from = to;
    return chunk;
  });
}
