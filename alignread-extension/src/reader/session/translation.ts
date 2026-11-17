import { browser } from 'wxt/browser';
import { LIMITS, failure, type BatchResult, type ErrorCode, type ReaderRequest, type ReaderState,
  type Result, type Session } from '../../shared/reader-messages';
import type { Block } from '../extraction/document';

type Part = { id: string; text: string; translated?: string; error?: ErrorCode };
type Work = { block: Block; parts: Part[] };
export type BlockStatus = 'pending' | 'failed' | 'done';
const pauseOn = new Set<ErrorCode>(['authentication', 'quota', 'unsupported-language', 'rate-limit', 'ai-endpoint',
  'consent-required', 'not-configured', 'stale', 'unavailable', 'network', 'timeout', 'ai-connect-timeout']);

export function createTranslation(blocks: Block[], session: Session, signal: AbortSignal, update: () => void) {
  const work = new Map<string, Work>();
  const texts = new Map<string, Part[]>();
  const cache = new Map<string, string>();
  let cacheEnabled = session.cache;
  let cacheBytes = 0;
  let cacheEpoch = 0;
  let paused = false;
  let running = false;
  let batchNumber = 0;
  let error: ErrorCode | undefined;

  for (const block of blocks) {
    const parts: Part[] = [];
    if (session.source !== session.target) {
      for (const piece of block.pieces) {
        if (!piece.translate || !piece.text.trim()) continue;
        const chunks = splitText(piece.text.trim()).map((text, index) => ({ id: piece.id + '-' + index, text }));
        parts.push(...chunks);
        texts.set(piece.id, chunks);
      }
    }
    work.set(block.id, { block, parts });
  }
  const total = [...work.values()].filter(({ parts }) => parts.length).length;

  function status(id: string): BlockStatus {
    const parts = work.get(id)?.parts ?? [];
    if (parts.some((part) => part.error)) return 'failed';
    return parts.every((part) => part.translated !== undefined) ? 'done' : 'pending';
  }

  function state(): ReaderState {
    let done = 0;
    let failed = 0;
    for (const entry of work.values()) {
      if (!entry.parts.length) continue;
      const result = status(entry.block.id);
      if (result === 'done') done++;
      else if (result === 'failed') failed++;
    }
    const phase = error ? 'error' : paused ? 'paused' : done + failed === total
      ? failed ? 'partial' : 'ready' : done || failed ? 'partial' : 'translating';
    return { status: phase, total, done, failed, error, cacheBytes };
  }

  function show(pieceId: string, original: string) {
    const parts = texts.get(pieceId);
    if (!parts || parts.some((part) => part.translated === undefined)) return original;
    return (original.match(/^\s*/)?.[0] ?? '') + parts.map((part) => part.translated).join('') +
      (original.match(/\s*$/)?.[0] ?? '');
  }

  function next() {
    const pending = [...work.values()].filter(({ parts }) => parts.some((part) => !part.error && part.translated === undefined));
    if (!pending.length) return new Map<string, Part[]>();
    const rects = pending.map((entry, index) => {
      const bounds = entry.block.range.getBoundingClientRect();
      const priority = bounds.bottom < 0 ? -bounds.bottom : Math.max(0, bounds.top - innerHeight);
      return { entry, priority, index };
    });
    rects.sort((a, b) => a.priority - b.priority || a.index - b.index);
    const batch = new Map<string, Part[]>();
    let length = 0;
    for (const { entry } of rects) {
      for (const part of entry.parts) {
        if (part.error || part.translated !== undefined) continue;
        const cached = cache.get(part.text);
        if (cached !== undefined) {
          part.translated = cached;
          continue;
        }
        const same = batch.get(part.text);
        if (same) {
          same.push(part);
        } else if (batch.size < LIMITS.batchItems && length + part.text.length <= LIMITS.batchChars) {
          batch.set(part.text, [part]);
          length += part.text.length;
        }
      }
      if (batch.size >= LIMITS.batchItems || length >= LIMITS.batchChars - 100) break;
    }
    return batch;
  }

  function remember(key: string, value: string) {
    const bytes = (key.length + value.length) * 2;
    if (bytes > 256_000 || cache.has(key)) return;
    while (cache.size >= 750 || cacheBytes + bytes > 256_000) {
      const first = cache.keys().next().value!;
      cacheBytes -= (first.length + cache.get(first)!.length) * 2;
      cache.delete(first);
    }
    cache.set(key, value);
    cacheBytes += bytes;
  }

  async function run() {
    if (running || paused || signal.aborted) return;
    running = true;
    try {
      while (!paused && !signal.aborted) {
        const batch = next();
        if (!batch.size) break;
        const epoch = cacheEpoch;
        const id = String(++batchNumber);
        const items = [...batch].map(([text, [part]]) => ({ id: part!.id, text }));
        const result: Result<BatchResult> = await browser.runtime.sendMessage({
          type: 'batch', sessionId: session.id, batchId: id, items,
        } satisfies ReaderRequest).catch(() => failure('unavailable'));
        if (signal.aborted) return;
        const translated = result?.ok && result.value.id === id
          ? new Map(result.value.items.map((item) => [item.id, item.text])) : null;
        const reason = result && !result.ok ? result.error : 'invalid-response';
        for (const [text, parts] of batch) {
          const value = translated?.get(parts[0]!.id);
          for (const part of parts) {
            if (value === undefined) part.error = reason;
            else part.translated = value;
          }
          if (value !== undefined && cacheEnabled && epoch === cacheEpoch) remember(text, value);
        }
        if (!translated && pauseOn.has(reason)) {
          paused = true;
          error = reason;
        }
        update();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      running = false;
      if (!signal.aborted) update();
    }
  }

  function retry(blockId?: string) {
    if (error) blockId = undefined;
    for (const entry of work.values()) {
      if (blockId && entry.block.id !== blockId) continue;
      for (const part of entry.parts) part.error = undefined;
    }
    error = undefined;
    paused = false;
    update();
    void run();
  }

  return {
    state, status, show, run, retry,
    pause() { paused = true; update(); },
    resume() { if (error) retry(); else { paused = false; update(); void run(); } },
    clearCache(disable = false) {
      cacheEpoch++;
      cache.clear();
      cacheBytes = 0;
      if (disable) cacheEnabled = false;
      update();
    },
  };
}

function splitText(text: string): string[] {
  if (text.length <= 1500) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 1500) {
    const preferred = remaining.lastIndexOf(' ', 1499) + 1;
    let split = preferred > 800 ? preferred : 1500;
    if (/[\uD800-\uDBFF]/.test(remaining.charAt(split - 1))) split--;
    parts.push(remaining.slice(0, split));
    remaining = remaining.slice(split);
  }
  return [...parts, remaining];
}
