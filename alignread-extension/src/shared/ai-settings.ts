export const AI_HOST_PERMISSION = 'https://*/*';
export const AI_FIELD_LIMITS = { endpoint: 2048, model: 200, apiKey: 1024 };

export type AiSettings = { endpoint: string; model: string };
export type AiCredentials = AiSettings & { apiKey: string };

export function parseAiSettings(value: { endpoint?: unknown; model?: unknown }): AiSettings | null {
  if (typeof value.endpoint !== 'string' || typeof value.model !== 'string') return null;
  const endpoint = value.endpoint.trim();
  const model = value.model.trim();
  if (endpoint.length > AI_FIELD_LIMITS.endpoint || !model || model.length > AI_FIELD_LIMITS.model ||
      !endpoint.startsWith('https://') || /[\s\\?#]/.test(endpoint)) return null;
  try {
    const url = new URL(endpoint);
    if (url.hostname.includes('*') || url.username || url.password ||
        !url.pathname.endsWith('/chat/completions')) return null;
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
