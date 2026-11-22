import { splitText } from '../shared/split-text';
import { browser } from 'wxt/browser';
import { LIMITS, errors, type BatchResult, type ProviderId, type ReadingOptions, type Result, type TranslationItem } from '../shared/reader-messages';
import { alignMarkerBoundaries, mathPlaceholders, type PdfTranslationItem } from './math-placeholders';

function returnedEnglish(source: string, result: string, options: ReadingOptions) {
  if (options.target !== 'zh-CN' && options.target !== 'zh-TW') return false;
  const normalize = (text: string) => text.replace(/\[\[ARFX*\s*\d+\s*\]\]/gi, '').replace(/\s+/g, ' ').trim();
  const text = normalize(source);
  return !/\p{Script=Han}/u.test(text) && (text.match(/[a-z]{3,}/gi) ?? []).length >= 5 &&
    text === normalize(result);
}

function abnormalRepetition(source: string, result: string) {
  const repeated = /(.{1,24}?)\1{7}/u.exec(result.replace(/\s/g, ''));
  return repeated && !source.replace(/\s/g, '').includes(repeated[0]);
}

export async function translatePage(items: PdfTranslationItem[], provider: ProviderId, options: ReadingOptions, hostname: string,
  signal: AbortSignal, show: (values: TranslationItem[]) => void) {
  const protectedRows = new Map(items.filter(item => item.inline?.length).map(item => [item.id, mathPlaceholders(item)]));
  const needsFallback = new Set<string>();
  const encoded = items.map(({ id, text }) => {
    const math = protectedRows.get(id);
    return { id, text: math ? math.combine(math.pieces) : text };
  });
  await sendItems(encoded, provider, options, hostname, signal, values => {
    show(values.filter(item => {
      const math = protectedRows.get(item.id);
      if (!math || math.parse(item.text)) return true;
      needsFallback.add(item.id);
      return false;
    }));
  });
  if (!needsFallback.size) return;

  // Some services change or remove placeholders. Translate only the surrounding
  // text in that case and reinsert the original formula nodes in source order.
  const fragments: TranslationItem[] = [];
  const rows = new Map<string, { id: string; pieces: string[]; waiting: number; join: (pieces: string[]) => string }>();
  const byFragment = new Map<string, { rowId: string; index: number; source: string }>();
  for (const id of needsFallback) {
    const math = protectedRows.get(id)!;
    const row = { id, pieces: [...math.pieces], waiting: 0, join: math.combine };
    rows.set(id, row);
    for (const [index, text] of row.pieces.entries()) {
      if (!/\p{L}/u.test(text)) continue;
      const fragment = id + '-text-' + index;
      byFragment.set(fragment, { rowId: id, index, source: text });
      fragments.push({ id: fragment, text });
      row.waiting++;
    }
    if (!row.waiting) show([{ id, text: row.join(row.pieces) }]);
  }
  if (!fragments.length) return;
  await sendItems(fragments, provider, options, hostname, signal, values => {
    const done: TranslationItem[] = [];
    for (const { id, text } of values) {
      const { rowId, index, source } = byFragment.get(id)!;
      const row = rows.get(rowId)!;
      row.pieces[index] = (source.match(/^\s*/)?.[0] ?? '') + text.trim() + (source.match(/\s*$/)?.[0] ?? '');
      if (--row.waiting === 0) done.push({ id: row.id, text: row.join(row.pieces) });
    }
    show(done);
  });
}

async function sendItems(items: TranslationItem[], provider: ProviderId, options: ReadingOptions, hostname: string,
  signal: AbortSignal, show: (values: TranslationItem[]) => void) {
  const groups = new Map<string, { row: string; parts: string[]; index: number; }>();
  const chunks = items.flatMap(item => {
    const texts = alignMarkerBoundaries(item.text, splitText(item.text)).filter(text => text.trim());
    const parts = Array<string>(texts.length).fill('');
    return texts.map((text, index) => {
      const id = item.id + '-' + index;
      groups.set(id, { row: item.id, parts, index });
      return { id, text };
    });
  });
  const port = browser.runtime.connect({ name: 'pdf-translation' });
  let pending: { resolve: (result: Result<BatchResult>) => void; reject: (error: Error) => void; } | undefined;
  const stop = () => {
    pending?.reject(new Error(errors.stale));
    port.disconnect();
  };
  port.onDisconnect.addListener(() => pending?.reject(new Error(errors.unavailable)));
  port.onMessage.addListener((result) => pending?.resolve(result));
  signal.addEventListener('abort', stop, { once: true });
  try {
    for (let offset = 0; offset < chunks.length;) {
      signal.throwIfAborted();
      const batch: TranslationItem[] = [];
      let size = 0;
      while (offset < chunks.length && batch.length < LIMITS.batchItems) {
        const item = chunks[offset]!;
        if (size + item.text.length > LIMITS.batchChars) break;
        batch.push(item); size += item.text.length; offset++;
      }
      const id = crypto.randomUUID();
      const result = await new Promise<Result<BatchResult>>((resolve, reject) => {
        pending = { resolve, reject };
        port.postMessage({ id, provider, options, hostname, items: batch });
      });
      pending = undefined;
      signal.throwIfAborted();
      if (!result.ok) throw new Error(errors[result.error]);
      const remaining = new Set(batch.map((item) => item.id));
      if (result.value.id !== id || result.value.items.some((item) => !remaining.delete(item.id) || !item.text.trim()) || remaining.size) {
        throw new Error(errors['invalid-response']);
      }
      const complete: TranslationItem[] = [];
      const sources = new Map(batch.map(item => [item.id, item.text]));
      let failure: string | undefined;
      for (const item of result.value.items) {
        const source = sources.get(item.id)!;
        if (returnedEnglish(source, item.text, options)) {
          failure = '翻译服务返回了未翻译的原文。请重试或切换翻译服务。';
          continue;
        }
        if (abnormalRepetition(source, item.text)) {
          failure = '翻译服务返回了异常重复的译文。请重试或切换翻译服务。';
          continue;
        }
        const group = groups.get(item.id)!;
        group.parts[group.index] = item.text;
        if (group.parts.every(Boolean)) complete.push({ id: group.row, text: group.parts.join('') });
      }
      show(complete);
      if (failure) throw new Error(failure);
    }
  } finally {
    signal.removeEventListener('abort', stop);
    port.disconnect();
  }
}
