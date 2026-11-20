import './prism-environment';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-bash';

export type CommentRange = { start: number; end: number; };
type Run = { node: Text; text: string; comments?: CommentRange[]; };
const highlighted = '.token.comment,.hljs-comment,.pl-c,.c1,.cm,.c,.cs';
const aliases: Record<string, string> = {
  js: 'javascript', jsx: '', ts: 'typescript', py: 'python', sh: 'bash',
  shell: 'bash', rs: 'rust', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', html: 'markup', xml: 'markup'
};

function language(root: Element) {
  const selector = '[data-language],[class*="language-"],[class*="lang-"],[class*="highlight-source-"]';
  for (const el of [root, root.querySelector(selector), root.closest(selector)]) {
    if (!el) continue;
    const name = (el.getAttribute('data-language') || (el.getAttribute('class') ?? '').match(/(?:^|\s)(?:language-|lang-|highlight-source-)([\w+#-]+)/i)?.[1])?.toLowerCase();
    if (name) return Object.hasOwn(aliases, name) ? aliases[name] : name;
  }
}

function bodies(text: string, start: number, ranges: CommentRange[]) {
  // Preserve comment delimiters, directives, indentation and line endings.
  if (/^(?:#!|\/\/[/!]\s*<|\/[/*]\s*[@#]|#\s*(?:type:|noqa\b|coding[:=]|pragma\b))/.test(text)) return;
  if (/^(?:\/\/\s*(?:go:|nolint\b|eslint\b|prettier-|@ts-)|#\s*(?:shellcheck\b|pylint:|fmt:|ruff:))/.test(text)) return;
  const opening = /^(?:<!--|\/\*+|\/\/[/!]*|#+|--)/.exec(text);
  if (!opening) return;
  const end = text.endsWith('-->') ? text.length - 3 : text.endsWith('*/') ? text.length - 2 : text.length;
  const body = text.slice(opening[0].length, end);
  for (const match of body.matchAll(/[^\r\n]+/g)) {
    const prefix = /^\s*(?:\*\s*)?/.exec(match[0])![0].length;
    const content = match[0].slice(prefix).trimEnd();
    if (!/\p{L}/u.test(content) || /^[@\\]\w+/.test(content)) continue;
    const pos = start + opening[0].length + match.index! + prefix;
    ranges.push({ start: pos, end: pos + content.length });
  }
}

export function markComments(root: HTMLElement, runs: readonly (Run | symbol)[]) {
  let source = '';
  const entries: { run: Run; start: number; }[] = [];
  for (const run of runs) {
    if (typeof run === 'symbol') { source += '\n'; continue; }
    entries.push({ run, start: source.length });
    source += run.text;
  }
  if (source.length > 100_000) return;
  const name = language(root);
  const grammar = name && Object.hasOwn(Prism.languages, name) ? Prism.languages[name] : undefined;
  const ranges: CommentRange[] = [];
  if (grammar && typeof grammar === 'object') {
    let offset = 0;
    for (const token of Prism.tokenize(source, grammar)) {
      const length = token.length;
      if (typeof token !== 'string' && token.type === 'comment') bodies(source.slice(offset, offset + length), offset, ranges);
      offset += length;
    }
  } else {
    let current: Element | null = null;
    let start = 0;
    let end = 0;
    for (const entry of entries) {
      const token = entry.run.node.parentElement?.closest(highlighted) ?? null;
      if (token !== current) {
        if (current) bodies(source.slice(start, end), start, ranges);
        current = token;
        start = entry.start;
      }
      end = entry.start + entry.run.text.length;
    }
    if (current) bodies(source.slice(start, end), start, ranges);
  }
  let i = 0;
  for (const { run, start } of entries) {
    const end = start + run.text.length;
    while (i < ranges.length && ranges[i]!.end <= start) i++;
    for (let j = i; j < ranges.length && ranges[j]!.start < end; j++) {
      const span = ranges[j]!;
      (run.comments ??= []).push({ start: Math.max(0, span.start - start), end: Math.min(end, span.end) - start });
    }
  }
}

export function commentParts(text: string, ranges: CommentRange[]) {
  const parts: { text: string; comment: boolean; }[] = [];
  let offset = 0;
  for (const { start, end } of ranges) {
    if (start > offset) parts.push({ text: text.slice(offset, start), comment: false });
    parts.push({ text: text.slice(start, end), comment: true });
    offset = end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), comment: false });
  return parts;
}

export function displayComment(original: string, translation: string) {
  // A translated comment must stay inside its original line and delimiters.
  return /[\r\n\u2028\u2029]|\*\/|-->|\\\s*$/.test(translation) ? original : translation;
}
