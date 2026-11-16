import { failure, isRecord, success, type ErrorCode, type TranslationItem } from '../../shared/reader-messages.ts';
import type { TranslationProvider } from './provider';

export const google: TranslationProvider<string> = {
  async translateSegments(request, key, signal) {
    const body = {
      q: request.items.map(({ text }) => text),
      target: request.target,
      source: request.source === 'auto' ? undefined : request.source,
      format: 'text',
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const timeout = AbortSignal.timeout(16000);
      try {
        const response = await fetch('https://translation.googleapis.com/language/translate/v2', {
          method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
          body: JSON.stringify(body), signal: AbortSignal.any([signal, timeout]),
        });

        if (response.status === 429 && attempt < 2) {
          const retryAfter = response.headers.get('Retry-After');
          const seconds = retryAfter === null ? NaN : (
            Number.isNaN(Number(retryAfter)) ? (Date.parse(retryAfter) - Date.now()) / 1000 : Number(retryAfter)
          );
          if (Number.isFinite(seconds) && seconds > 8) return failure('rate-limit');
          const delay = Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : 500 * 2 ** attempt;
          await wait(delay, signal);
          continue;
        }

        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) return failure(classify(response.status, data));
        if (!isRecord(data) || !isRecord(data.data) || !Array.isArray(data.data.translations) ||
            data.data.translations.length !== request.items.length) return failure('invalid-response');

        const items: TranslationItem[] = [];
        for (const [index, entry] of data.data.translations.entries()) {
          if (!isRecord(entry) || typeof entry.translatedText !== 'string' || !entry.translatedText.trim()) {
            continue;
          }
          const original = request.items[index];
          if (original) items.push({ id: original.id, text: entry.translatedText });
        }
        return success({ id: request.id, items });
      } catch {
        if (signal.aborted) return failure('stale');
        return failure(timeout.aborted ? 'timeout' : 'network');
      }
    }
    return failure('rate-limit');
  },
};

function classify(status: number, data: unknown): ErrorCode {
  const details = isRecord(data) && isRecord(data.error) ? JSON.stringify(data.error) : '';
  if (/BILLING|QUOTA|DAILYLIMIT|DAILY LIMIT|BILLINGNOTENABLED/i.test(details)) return 'quota';
  if (status === 401 || status === 403 || /API_KEY_INVALID|API KEY NOT VALID/i.test(details)) return 'authentication';
  if (status === 429) return 'rate-limit';
  if (status === 400 && /language/i.test(details)) return 'unsupported-language';
  return 'provider-error';
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timeout);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
