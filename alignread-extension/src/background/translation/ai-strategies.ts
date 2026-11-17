import { AI_PROVIDERS, type AiProviderId } from '../../shared/ai-settings';
import type { ErrorCode } from '../../shared/reader-messages';
import { CHAT_STREAM_IDLE_TIMEOUT_MS, CHAT_STREAM_TIMEOUT_MS, readChatStream } from './chat-stream';
import { miniMaxError, readMiniMaxStream } from './minimax-stream';

type AiStrategy = {
  timeout: number;
  options?: (model: string) => Record<string, unknown>;
  stream?: {
    idleTimeout: number;
    read: (response: Response, onData: () => void) => Promise<unknown>;
    error?: (data: unknown) => ErrorCode | undefined;
  };
};

const jsonMode = { type: 'json_object' };
const noThinking = { type: 'disabled' };
const chat: AiStrategy = { timeout: 25_000 };

const streamedChat: AiStrategy = {
  timeout: CHAT_STREAM_TIMEOUT_MS,
  stream: { idleTimeout: CHAT_STREAM_IDLE_TIMEOUT_MS, read: readChatStream },
};

function tuneDefault(provider: AiProviderId, parameters: Record<string, unknown>, transport = chat): AiStrategy {
  return {
    ...transport,
    options: (model) => model === AI_PROVIDERS[provider].model ? parameters : {},
  };
}

const strategies: Partial<Record<AiProviderId, AiStrategy>> = {
  deepseek: { ...chat, options: () => ({ response_format: jsonMode, thinking: noThinking }) },
  minimax: {
    ...streamedChat,
    stream: { idleTimeout: CHAT_STREAM_IDLE_TIMEOUT_MS, read: readMiniMaxStream, error: miniMaxError },
    options: (model) => ({
      reasoning_split: true,
      ...(model === AI_PROVIDERS.minimax.model ? { reasoning_effort: 'low' }
        : model === 'MiniMax-M3' ? { thinking: noThinking } : {}),
    }),
  },
  openai: tuneDefault('openai', { response_format: jsonMode, reasoning_effort: 'none' }),
  gemini: tuneDefault('gemini', { reasoning_effort: 'minimal' }),
  grok: tuneDefault('grok', { reasoning_effort: 'none' }),
  glm: tuneDefault('glm', { thinking: { type: 'enabled' }, reasoning_effort: 'low' }, streamedChat),
  kimi: tuneDefault('kimi', { reasoning_effort: 'low' }, streamedChat),
  doubao: tuneDefault('doubao', { thinking: noThinking }),
  hunyuan: tuneDefault('hunyuan', { thinking: noThinking }),
};

export function aiStrategy(provider: AiProviderId): AiStrategy {
  return strategies[provider] ?? chat;
}
