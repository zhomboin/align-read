export const AI_HOST_PERMISSION = 'https://*/*';
export const AI_FIELD_LIMITS = { endpoint: 2048, model: 200, apiKey: 1024 };
export const MINIMAX_ENDPOINTS = {
  cn: 'https://api.minimax.cn/v1/chat/completions',
  global: 'https://api.minimax.io/v1/chat/completions',
};
export const AI_PROVIDERS = {
  ai: { label: 'AI 翻译', endpoint: '', model: '' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  minimax: { label: 'MiniMax', endpoint: MINIMAX_ENDPOINTS.cn, model: 'MiniMax-M3.1-Flash' },
};
export type AiProviderId = keyof typeof AI_PROVIDERS;
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];
export const EMPTY_AI_SERVICES = { ai: null, deepseek: null, minimax: null };

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
    if (provider === 'deepseek' && url.href !== AI_PROVIDERS.deepseek.endpoint) return null;
    if (provider === 'minimax' && !Object.values(MINIMAX_ENDPOINTS).includes(url.href)) return null;
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
