import type { PdfAlignment, PlacedLine } from './page-content';

const sectionNumber = /^(?:\d{1,3}(?:\.\d{1,3}){0,3}|[A-Z](?:\.\d{1,3}){1,3})[.)]?$/;
const sectionPrefix = /^(\S+)[\s\u00a0]+(?=\p{L})/u;
const printedPage = /^(?:(?:page\s*)?(?:\d{1,5}|[ivxlcdm]{1,8})(?:\s*(?:of|\/)\s*\d{1,5})?|第\s*\d{1,5}\s*页)$/i;

function bodySize(lines: PlacedLine[]) {
  const text = lines.filter(line => !line.style && !line.graphic && !line.keep && line.fontSize && line.text.length >= 3);
  const body = text.filter(line => line.text.length >= 24);
  const proseSizes = (body.length ? body : text).map(line => line.fontSize!).sort((a, b) => a - b);
  return proseSizes[Math.floor(proseSizes.length / 2)] ?? 10;
}

function pageNumber(lines: PlacedLine[], top: boolean, width: number, height: number, size: number, number: number) {
  const options = lines.filter(line => !line.graphic && !line.style && printedPage.test(line.text) &&
    line.end - line.x < width * .20 && line.height <= size * 1.8 &&
    (top ? line.y < height * .12 : line.y > height * .88) &&
    !lines.some(other => !other.keep && /\p{L}/u.test(other.text) &&
      Math.abs(line.y - other.y) <= size * .22 &&
      Math.max(line.x, other.x) - Math.min(line.end, other.end) < size * 2.5 && line !== other));
  const exact = options.find(line => line.text === String(number));
  const line = exact ?? (options.length === 1 ? options[0] : undefined);
  if (!line) return;
  const center = (line.x + line.end) / (2 * width);
  const alignment: PdfAlignment = center < .40 ? 'left' : center > .60 ? 'right' : 'center';
  return { ...line, keep: true, style: 'page-number' as const, alignment };
}

function sectionHeading(line: PlacedLine, lines: PlacedLine[], typical: number) {
  if (line.style || line.keep || !line.fontSize || line.text.length > 160 || !/\p{L}{2,}/u.test(line.text)) return;
  const sizeRatio = line.fontSize / typical;
  if (sizeRatio < .92 || (!line.bold && sizeRatio < 1.12)) return;

  const prefix = sectionPrefix.exec(line.text)?.[1];
  if (prefix && sectionNumber.test(prefix)) return Math.min(prefix.split('.').filter(Boolean).length, 4);
  if (/^(?:第[\d一二三四五六七八九十]+[章节篇节]|appendix\s+[A-Z]\b)/i.test(line.text)) return 1;

  const end = line.y + line.height / 2;
  const start = line.y - line.height / 2;
  let above = Infinity, below = Infinity;
  for (const other of lines) {
    if (other === line || other.end <= line.x || other.x >= line.end) continue;
    const gap = Math.abs(other.y - line.y);
    if (gap < typical * .5) continue;
    if (other.y < line.y) above = Math.min(above, start - other.y - other.height / 2);
    else below = Math.min(below, other.y - other.height / 2 - end);
  }
  // Short unnumbered headings have visual separation from adjacent prose.
  if (line.text.length <= 90 && above >= typical * .45 && below >= typical * .20) return 1;
}

export function pageTypography(lines: PlacedLine[], width: number, height: number, page: number) {
  const size = bodySize(lines);
  const header = pageNumber(lines, true, width, height, size, page);
  const footer = pageNumber(lines, false, width, height, size, page);
  const content = lines.filter(line => line.bounds !== header?.bounds && line.bounds !== footer?.bounds);
  const result: PlacedLine[] = [];
  for (let index = 0; index < content.length; index++) {
    const line = content[index]!;
    const next = content[index + 1];
    // Wide spacing between a section number and its heading can produce two text runs.
    if (!line.style && sectionNumber.test(line.text) && next && !next.style && next.x >= line.end &&
      next.x - line.end < size * 2.5 && Math.abs(line.y - next.y) <= size * .22) {
      const text = line.text + ' ' + next.text;
      const combined = {
        ...next, text, x: line.x,
        inline: next.inline?.map(span => ({ ...span, start: span.start + line.text.length + 1, end: span.end + line.text.length + 1 })),
      };
      const level = sectionHeading(combined, content, size);
      if (level) {
        result.push({ ...combined, style: 'section', level });
        index++;
        continue;
      }
    }
    const level = sectionHeading(line, content, size);
    result.push(level ? { ...line, style: 'section', level } : line);
  }
  return { content: result, header, footer };
}
