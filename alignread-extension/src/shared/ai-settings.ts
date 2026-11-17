export const AI_HOST_PERMISSION = 'https://*/*';
export const AI_FIELD_LIMITS = { endpoint: 2048, model: 200, apiKey: 1024 };
type ProviderDefinition = {
  label: string;
  endpoint: string;
  model: string;
  regions?: ReadonlyArray<{ label: string; endpoint: string }>;
  modelLabel?: string;
};

const miniMaxChina = 'https://api.minimax.cn/v1/chat/completions';

export const AI_PROVIDERS = {
  ai: { label: 'AI 翻译', endpoint: '', model: '' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  minimax: {
    label: 'MiniMax', endpoint: miniMaxChina, model: 'MiniMax-M3.1-Flash',
    regions: [
      { label: '中国站', endpoint: miniMaxChina },
      { label: '国际站', endpoint: 'https://api.minimax.io/v1/chat/completions' },
    ],
  },
  openai: { label: 'ChatGPT（OpenAI）', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.4-mini' },
  gemini: {
    label: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-3.1-flash-lite',
  },
  grok: { label: 'Grok', endpoint: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.3' },
  glm: { label: 'GLM（智谱）', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3-flash' },
  kimi: { label: 'Kimi', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'kimi-k3' },
  doubao: {
    label: '豆包（火山方舟）', endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-seed-2-0-lite-260215', modelLabel: '模型 ID 或推理接入点 ID',
  },
  hunyuan: { label: '腾讯混元', endpoint: 'https://tokenhub.tencentmaas.com/v1/chat/completions', model: 'hy3' },
} satisfies Record<string, ProviderDefinition>;
export type AiProviderId = keyof typeof AI_PROVIDERS;
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];
export const EMPTY_AI_SERVICES = Object.fromEntries(
  AI_PROVIDER_IDS.map((provider) => [provider, null]),
) as Record<AiProviderId, null>;

export function aiProviderDefinition(provider: AiProviderId): ProviderDefinition {
  return AI_PROVIDERS[provider];
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && Object.hasOwn(AI_PROVIDERS, value);
}

export type AiSettings = { endpoint: string; model: string };
export type AiCredentials = AiSettings & { apiKey: string };

export function parseAiSettings(provider: AiProviderId, value: { endpoint?: unknown; model?: unknown }): AiSettings | null {
  if (typeof value.endpoint !== 'string' || typeof value.model !== 'string') return null;
  const endpoint = value.endpoint.trim();
  const model = value.model.trim();
  if (endpoint.length > AI_FIELD_LIMITS.endpoint || !model || model.length > AI_FIELD_LIMITS.model ||
      !endpoint.startsWith('https://') || /[\s\\?#]/.test(endpoint)) return null;
  try {
    const url = new URL(endpoint);
    if (url.hostname.includes('*') || url.username || url.password ||
        !url.pathname.endsWith('/chat/completions')) return null;
    const definition = aiProviderDefinition(provider);
    if (definition.endpoint && url.href !== definition.endpoint &&
        !definition.regions?.some((region) => region.endpoint === url.href)) return null;
    return { endpoint: url.href, model };
  } catch {
    return null;
  }
}

export function aiHostPermission(endpoint: string) {
  return `https://${new URL(endpoint).hostname}/*`;
}

export function parseAiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key && key.length <= AI_FIELD_LIMITS.apiKey && /^[\x21-\x7e]+$/.test(key) ? key : null;
}
