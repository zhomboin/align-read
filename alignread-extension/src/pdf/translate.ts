import { splitText } from '../shared/split-text';
import { browser } from 'wxt/browser';
import { LIMITS, errors, type BatchResult, type ProviderId, type ReadingOptions, type Result, type TranslationItem } from '../shared/reader-messages';

export async function translatePage(items: TranslationItem[], provider: ProviderId, options: ReadingOptions, hostname: string,
  signal: AbortSignal, show: (values: TranslationItem[]) => void) {
  const groups = new Map<string, { row: string; parts: string[]; index: number; }>();
  const chunks = items.flatMap(item => {
    const texts = splitText(item.text).filter(text => text.trim());
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
      for (const item of result.value.items) {
        const group = groups.get(item.id)!;
        group.parts[group.index] = item.text;
        if (group.parts.every(Boolean)) complete.push({ id: group.row, text: group.parts.join('') });
      }
      show(complete);
    }
  } finally {
    signal.removeEventListener('abort', stop);
    port.disconnect();
  }
}
