import { isRecord, type ErrorCode } from '../../shared/reader-messages';
import { readChatStream } from './chat-stream';

export function readMiniMaxStream(response: Response, receivedBytes: () => void) {
  return readChatStream(response, receivedBytes, miniMaxError);
}

export function miniMaxError(data: unknown): ErrorCode | undefined {
  const status = isRecord(data) && isRecord(data.base_resp) ? data.base_resp.status_code : undefined;
  if (typeof status !== 'number' || status === 0) return;
  switch (status) {
    case 1001: case 2066: return 'timeout';
    case 1002: case 1039: case 2062: return 'rate-limit';
    case 1004: case 2049: return 'authentication';
    case 1008: case 2053: case 2067: return 'quota';
    case 2022: case 2069: return 'ai-endpoint';
    default: return 'provider-error';
  }
}
