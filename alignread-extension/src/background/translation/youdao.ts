import {
  failure, isRecord, success, type ErrorCode, type SourceLanguage, type TranslationItem, type YoudaoCredentials,
} from '../../shared/reader-messages.ts';
import type { TranslationBatch, TranslationProvider } from './provider';

const endpoint = 'https://openapi.youdao.com/v2/api';

export const youdao: TranslationProvider<YoudaoCredentials> = {
  async translateSegments(request, credentials, signal) {
    const timeout = AbortSignal.timeout(16000);
    try {
      const body = await signedForm(request, credentials);
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        body, signal: AbortSignal.any([signal, timeout]),
      });
      if (response.status === 429) return failure('rate-limit');
      if (response.status === 401 || response.status === 403) return failure('authentication');
      if (!response.ok) return failure('provider-error');
      const data: unknown = JSON.parse(await response.text());
      return readBatch(request, data);
    } catch (error) {
      if (signal.aborted) return failure('stale');
      if (timeout.aborted) return failure('timeout');
      return failure(error instanceof SyntaxError ? 'invalid-response' : 'network');
    }
  },
};

async function signedForm(request: TranslationBatch, { appKey, appSecret }: YoudaoCredentials) {
  const salt = crypto.randomUUID();
  const curtime = Math.floor(Date.now() / 1000).toString();
  const text = request.items.map((item) => item.text).join('');
  const input = text.length <= 20 ? text : text.slice(0, 10) + text.length + text.slice(-10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(appKey + input + salt + curtime + appSecret));
  const sign = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const body = new URLSearchParams({
    from: languageCode(request.source), to: languageCode(request.target), appKey, salt, sign, curtime, signType: 'v3',
  });
  if (request.source === 'auto') body.set('detectLevel', '1');
  for (const item of request.items) body.append('q', item.text);
  return body;
}

function languageCode(language: SourceLanguage) {
  if (language === 'zh-CN') return 'zh-CHS';
  if (language === 'zh-TW') return 'zh-CHT';
  return language;
}

function readBatch(request: TranslationBatch, data: unknown) {
  if (!isRecord(data) || (typeof data.errorCode !== 'string' && typeof data.errorCode !== 'number')) {
    return failure('invalid-response');
  }
  const code = String(data.errorCode);
  const rows = data.translateResults;
  if (!Array.isArray(rows) || !rows.length) return failure(code === '0' ? 'invalid-response' : errorFor(code));

  const errorIndex = data.errorIndex ?? [];
  if (!Array.isArray(errorIndex) || errorIndex.some((index) =>
    !Number.isInteger(index) || index < 0 || index >= request.items.length)) return failure('invalid-response');
  if (code !== '0' && !errorIndex.length) return failure(errorFor(code));

  const failed = new Set<number>(errorIndex);
  const indexed = request.items.map((item, index) => ({ item, index }));
  const originals = rows.length === indexed.length ? indexed : indexed.filter(({ index }) => !failed.has(index));
  if (rows.length !== originals.length) return failure('invalid-response');

  const items: TranslationItem[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    const original = originals[rowIndex];
    if (!original || failed.has(original.index) || !isRecord(row) || row.query !== original.item.text ||
        typeof row.translation !== 'string' || !row.translation.trim()) continue;
    items.push({ id: original.item.id, text: row.translation });
  }
  return items.length ? success({ id: request.id, items }) : failure('invalid-response');
}

function errorFor(code: string): ErrorCode {
  switch (code) {
    case '102': return 'unsupported-language';
    case '108': case '110': case '111': case '202': case '203': case '205': case '206': return 'authentication';
    case '401': return 'quota';
    case '411': case '412': return 'rate-limit';
    default: return 'provider-error';
  }
}
