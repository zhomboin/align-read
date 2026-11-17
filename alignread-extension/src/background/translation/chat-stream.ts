import { isRecord } from '../../shared/reader-messages';

export const CHAT_STREAM_TIMEOUT_MS = 90_000;
export const CHAT_STREAM_IDLE_TIMEOUT_MS = 27_000;
const MAX_BUFFER_LENGTH = 256_000;

export async function readChatStream(response: Response, receivedBytes: () => void, isError?: (data: unknown) => unknown): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return null;
      if (!value.byteLength) continue;
      receivedBytes();
      pending += decoder.decode(value, { stream: true });
      if (pending.length > MAX_BUFFER_LENGTH) return null;

      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? '';
      for (const event of events) {
        const payload = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n').trim();
        if (!payload) continue;
        if (payload === '[DONE]') return completion(content, 'stop');

        const frame: unknown = JSON.parse(payload);
        if (isError?.(frame)) return frame;
        const choice: unknown = isRecord(frame) && Array.isArray(frame.choices) ? frame.choices[0] : undefined;
        if (!isRecord(choice)) continue;
        if (isRecord(choice.delta) && typeof choice.delta.content === 'string') {
          content += choice.delta.content;
          if (content.length > MAX_BUFFER_LENGTH) return null;
        }
        if (typeof choice.finish_reason === 'string' && choice.finish_reason) return completion(content, choice.finish_reason);
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function completion(content: string, finishReason: string) {
  return { choices: [{ finish_reason: finishReason, message: { content } }] };
}
