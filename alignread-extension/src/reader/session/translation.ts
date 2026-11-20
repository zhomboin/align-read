import { readReaderPage } from '../../shared/reader-page';
import { splitText } from '../../shared/split-text';
import { browser } from 'wxt/browser';
import { LIMITS, failure, type BatchResult, type ErrorCode, type ReaderRequest, type ReaderState,
  type Result, type Session } from '../../shared/reader-messages';
import type { Block } from '../extraction/document';

type Part = { id: string; text: string; translated?: string; reuseEpoch?: number; error?: ErrorCode };
type Work = { block: Block; parts: Part[] };
type Batch = {
  id: string; parts: Map<string, Part[]>; cacheEpoch: number; result?: Result<BatchResult> | null;
};
export type ModeTranslations = {
  completed: Map<string, string>;
  previous?: Map<string, string>;
};
export type BlockStatus = 'pending' | 'failed' | 'done';
const pauseOn = new Set<ErrorCode>(['authentication', 'quota', 'unsupported-language', 'rate-limit', 'ai-endpoint',
  'consent-required', 'not-configured', 'sensitive-site', 'stale', 'unavailable', 'network', 'timeout', 'ai-connect-timeout']);
let batchNumber = 0;

export function createTranslation(session: Session, signal: AbortSignal, update: () => void,
  inherited?: ModeTranslations) {
  let otherMode = inherited?.completed;
  let lastVisit = inherited?.previous;
  const work = new Map<string, Work>();
  const cache = new Map<string, string>();
  const activeParts = new Set<Part>();
  let texts = new Map<string, Part[]>();
  let cacheEnabled = session.cache;
  let cacheBytes = 0;
  let cacheEpoch = 0;
  let paused = false;
  let held = true;
  let canceling = false;
  let timer = 0;
  let pageUrl = session.pageUrl ?? '';
  let error: ErrorCode | undefined;
  let inFlight: Batch | undefined;

  // A round trip can change fragment boundaries twice. Keep the last view of each
  // mode so returning to a long article does not depend on the bounded recent cache.
  function translationsForMode(next: Session) {
    const page = readReaderPage(next.pageUrl);
    if (!cacheEnabled || !next.cache || !page || page.sensitive || page.viewKey !== readReaderPage(pageUrl)?.viewKey ||
        session.source !== next.source || session.target !== next.target) return;
    const completed = new Map(lastVisit ?? cache);
    for (const parts of texts.values()) {
      for (const part of parts) {
        if (part.reuseEpoch === cacheEpoch && part.translated !== undefined) completed.set(part.text, part.translated);
      }
    }
    return { completed, previous: otherMode };
  }

  function replace(blocks: Block[], url: string) {
    const previousTexts = texts;
    texts = new Map();
    activeParts.clear();
    work.clear();
    pageUrl = url;

    for (const block of blocks) {
      const parts: Part[] = [];
      if (session.source !== session.target) {
        for (const piece of block.pieces) {
          if (!piece.translate || !piece.text.trim()) continue;
          const chunks = previousTexts.get(piece.id) ?? splitText(piece.text.trim()).map((text, index): Part => {
            const translated = lastVisit?.get(text) ?? otherMode?.get(text) ?? cache.get(text);
            if (translated !== undefined) remember(text, translated);
            return { id: piece.id + '-' + index, text, translated, reuseEpoch: translated === undefined ? undefined : cacheEpoch };
          });
          for (const part of chunks) {
            parts.push(part);
            activeParts.add(part);
          }
          texts.set(piece.id, chunks);
        }
      }
      work.set(block.id, { block, parts });
    }

    if (blocks.length) lastVisit = undefined;
    if (error && ![...activeParts].some((part) => part.error === error)) error = undefined;
    // A batch that still references retired text cannot hold up the newly visible view.
    if (inFlight && [...inFlight.parts.values()].some((parts) => parts.some((part) => !activeParts.has(part)))) {
      cancelInFlight();
    }
    held = false;
  }

  function status(id: string): BlockStatus {
    const parts = work.get(id)?.parts ?? [];
    if (parts.some((part) => part.error)) return 'failed';
    return parts.every((part) => part.translated !== undefined) ? 'done' : 'pending';
  }

  function state(): ReaderState {
    let total = 0;
    let done = 0;
    let failed = 0;
    let pendingInFailedBlock = false;
    for (const entry of work.values()) {
      if (!entry.parts.length) continue;
      total++;
      const result = status(entry.block.id);
      if (result === 'done') done++;
      else if (result === 'failed') {
        failed++;
        pendingInFailedBlock ||= entry.parts.some((part) => !part.error && part.translated === undefined);
      }
    }
    let phase: ReaderState['status'] = 'translating';
    if (error) phase = 'error';
    else if (paused) phase = 'paused';
    else if (held && !work.size) phase = 'preparing';
    else if (done === total) phase = 'ready';
    else if ((done || failed) && !(done + failed === total && pendingInFailedBlock)) phase = 'partial';
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
          part.reuseEpoch = cacheEpoch;
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

  function run() {
    if (signal.aborted || held || canceling) return;
    if (inFlight) {
      if (inFlight.result !== undefined) settle(inFlight, inFlight.result);
      return;
    }
    if (paused || error) return;

    const parts = next();
    if (!parts.size) {
      update();
      return;
    }
    const id = String(++batchNumber);
    const items = [...parts].map(([text, [part]]) => ({ id: part!.id, text }));
    inFlight = { id, parts, cacheEpoch };
    void sendBatch({ type: 'batch', sessionId: session.id, batchId: id, pageUrl, items });
  }

  async function sendBatch(message: Extract<ReaderRequest, { type: 'batch' }>) {
    let result: Result<BatchResult> | null;
    try {
      result = await browser.runtime.sendMessage(message) ?? null;
    } catch {
      result = failure('unavailable');
    }
    if (signal.aborted || inFlight?.id !== message.batchId) return;
    inFlight.result = result;
    run();
  }

  function settle(batch: Batch, result: Result<BatchResult> | null) {
    inFlight = undefined;
    const translated = result?.ok && result.value.id === batch.id
      ? new Map(result.value.items.map((item) => [item.id, item.text])) : null;
    const reason = result && !result.ok ? result.error : 'invalid-response';
    for (const [text, parts] of batch.parts) {
      const current = parts.filter((part) => activeParts.has(part));
      if (!current.length) continue;
      const value = translated?.get(parts[0]!.id);
      for (const part of current) {
        if (value === undefined) part.error = reason;
        else {
          part.translated = value;
          if (cacheEnabled) part.reuseEpoch = batch.cacheEpoch;
        }
      }
      if (value !== undefined && cacheEnabled && batch.cacheEpoch === cacheEpoch) remember(text, value);
    }
    if (!translated && pauseOn.has(reason)) error = reason;
    update();
    if (!timer && !paused && !error && !signal.aborted) {
      timer = window.setTimeout(() => {
        timer = 0;
        run();
      }, 0);
    }
  }

  function hold() {
    held = true;
    clearTimeout(timer);
    timer = 0;
  }

  function cancelInFlight() {
    const batch = inFlight;
    inFlight = undefined;
    if (!batch || batch.result !== undefined) return;
    canceling = true;
    void cancel(batch.id);
  }

  async function cancel(batchId: string) {
    try {
      await browser.runtime.sendMessage({ type: 'cancel', sessionId: session.id, batchId } satisfies ReaderRequest);
    } catch {
      // A torn-down Worker may no longer have the job.
    } finally {
      canceling = false;
      run();
    }
  }

  function clearCache(disable = false) {
    otherMode = undefined;
    lastVisit = undefined;
    cacheEpoch++;
    cache.clear();
    cacheBytes = 0;
    if (disable) cacheEnabled = false;
  }

  function refreshAddress() {
    hold();
    cancelInFlight();
  }

  function resetPage() {
    refreshAddress();
    activeParts.clear();
    work.clear();
    texts.clear();
    clearCache();
    error = undefined;
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
    run();
  }

  signal.addEventListener('abort', () => {
    hold();
    inFlight = undefined;
    activeParts.clear();
    work.clear();
    texts.clear();
    clearCache();
  }, { once: true });

  return {
    state, status, show, run, retry, hold, replace, refreshAddress, resetPage, translationsForMode,
    pause() { paused = true; update(); },
    resume() { if (error) retry(); else { paused = false; update(); run(); } },
    clearCache(disable = false) {
      clearCache(disable);
      update();
    },
  };
}
