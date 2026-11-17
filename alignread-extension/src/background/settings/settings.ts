import { browser } from 'wxt/browser';
import { aiHostPermission, parseAiKey, parseAiSettings, type AiCredentials } from '../../shared/ai-settings';
import {
  MAX_YOUDAO_CREDENTIAL_LENGTH, TRANSLATION_PROVIDERS, clampRatio, defaults, errors, isProviderId, isReadingOptions, isRecord,
  type ErrorCode, type Preferences, type ProviderCheck, type ProviderId, type PublicSettings, type YoudaoCredentials,
} from '../../shared/reader-messages.ts';

const KEY = 'providerSettings';
const providerIds = Object.keys(TRANSLATION_PROVIDERS) as ProviderId[];
export type Settings = Preferences & {
  provider: ProviderId;
  key: string;
  revision: string;
  youdao: YoudaoCredentials | null;
  youdaoAuthorized: boolean;
  ai: AiCredentials | null;
  aiAuthorized: boolean;
  checks: Partial<Record<ProviderId, ProviderCheck | null>>;
};
let initialization: Promise<void> | undefined;
let writes: Promise<unknown> = Promise.resolve();

export async function getSettings(): Promise<Settings> {
  initialization ??= browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch((error: unknown) => { initialization = undefined; throw error; });
  await initialization;
  const { [KEY]: stored } = await browser.storage.local.get(KEY);
  const saved = isRecord(stored) ? stored : {};
  const checks = isRecord(saved.checks) ? saved.checks : {};
  const aiSettings = isRecord(saved.ai) ? parseAiSettings(saved.ai) : null;
  const aiKey = isRecord(saved.ai) ? parseAiKey(saved.ai.apiKey) : null;
  return { ...normalize(saved),
    provider: isProviderId(saved.provider) ? saved.provider : 'google',
    key: typeof saved.key === 'string' ? saved.key : '',
    revision: typeof saved.revision === 'string' ? saved.revision : '',
    youdao: parseYoudaoCredentials(saved.youdao),
    youdaoAuthorized: saved.youdaoAuthorized === true,
    ai: aiSettings && aiKey ? { ...aiSettings, apiKey: aiKey } : null,
    aiAuthorized: saved.aiAuthorized === true && Boolean(aiSettings && aiKey),
    checks: { google: parseCheck(checks.google), youdao: parseCheck(checks.youdao), ai: parseCheck(checks.ai) },
  };
}

export async function publicSettings(settings: Settings): Promise<PublicSettings> {
  const { key, revision: _, youdao, ai, checks, authorized, youdaoAuthorized, aiAuthorized, ...preferences } = settings;
  const [googlePermission, youdaoPermission, aiPermission] = await Promise.all([
    hasHostPermission(settings, 'google'), hasHostPermission(settings, 'youdao'), hasHostPermission(settings, 'ai'),
  ]);
  return { ...preferences, ai: ai ? { endpoint: ai.endpoint, model: ai.model } : null, providers: {
    google: { configured: Boolean(key), consent: authorized, hostPermission: googlePermission,
      lastCheck: key ? checks.google ?? null : null },
    youdao: { configured: youdao !== null, consent: youdaoAuthorized, hostPermission: youdaoPermission,
      lastCheck: youdao ? checks.youdao ?? null : null,
      appKeySuffix: youdao && youdao.appKey.length > 4 ? youdao.appKey.slice(-4) : undefined },
    ai: { configured: ai !== null, consent: aiAuthorized, hostPermission: aiPermission,
      lastCheck: ai ? checks.ai ?? null : null },
  } };
}

export async function hasProviderPermission(settings: Settings, provider: ProviderId) {
  return providerConsent(settings, provider) && await hasHostPermission(settings, provider);
}

export function providerConsent(settings: Settings, provider: ProviderId) {
  switch (provider) {
    case 'google': return settings.authorized;
    case 'youdao': return settings.youdaoAuthorized;
    case 'ai': return settings.aiAuthorized;
  }
}

export function providerOrigin(settings: Settings, provider: ProviderId) {
  if (provider !== 'ai') return TRANSLATION_PROVIDERS[provider].origin;
  return settings.ai ? aiHostPermission(settings.ai.endpoint) : undefined;
}

async function hasHostPermission(settings: Settings, provider: ProviderId) {
  const origin = providerOrigin(settings, provider);
  return Boolean(origin && await browser.permissions.contains({ origins: [origin] }));
}

export async function removeUnusedProviderPermissions(origins: (string | undefined)[]) {
  const settings = await getSettings();
  const inUse = new Set(providerIds.filter((provider) => providerConsent(settings, provider))
    .map((provider) => providerOrigin(settings, provider)));
  const unused = [...new Set(origins)].filter((origin): origin is string => Boolean(origin && !inUse.has(origin)));
  if (unused.length) await browser.permissions.remove({ origins: unused });
}

export function isConfigured(settings: Settings, provider: ProviderId) {
  switch (provider) {
    case 'google': return Boolean(settings.key);
    case 'youdao': return Boolean(settings.youdao);
    case 'ai': return Boolean(settings.ai);
  }
}

export function sameCredentials(provider: ProviderId, first: Settings, second: Settings) {
  switch (provider) {
    case 'google': return first.key === second.key;
    case 'youdao': return first.youdao?.appKey === second.youdao?.appKey && first.youdao?.appSecret === second.youdao?.appSecret;
    case 'ai': return first.ai?.endpoint === second.ai?.endpoint && first.ai?.model === second.ai?.model &&
      first.ai?.apiKey === second.ai?.apiKey;
  }
}

function parseCheck(value: unknown): ProviderCheck | null {
  if (!isRecord(value) || typeof value.checkedAt !== 'number' || !Number.isFinite(value.checkedAt) ||
      value.checkedAt <= 0 || value.checkedAt > 8.64e15) return null;
  if (value.error === undefined) return { checkedAt: value.checkedAt };
  if (typeof value.error !== 'string' || !Object.hasOwn(errors, value.error)) return null;
  return { checkedAt: value.checkedAt, error: value.error as ErrorCode };
}

export function parseYoudaoCredentials(value: unknown): YoudaoCredentials | null {
  if (!isRecord(value) || typeof value.appKey !== 'string' || typeof value.appSecret !== 'string') return null;
  const appKey = value.appKey.trim();
  const appSecret = value.appSecret.trim();
  if (!appKey || !appSecret || appKey.length > MAX_YOUDAO_CREDENTIAL_LENGTH ||
      appSecret.length > MAX_YOUDAO_CREDENTIAL_LENGTH) return null;
  return { appKey, appSecret };
}

export function updateSettings(update: (current: Settings) => Settings | Promise<Settings>) {
  const result = writes.then(async () => {
    const current = await getSettings();
    const next = await update(current);
    if (next !== current) await browser.storage.local.set({ [KEY]: next });
    return next;
  });
  writes = result.catch(() => undefined);
  return result;
}

export function normalize(value: unknown): Preferences {
  if (!isReadingOptions(value)) return defaults;
  const input = value as unknown as Record<string, unknown>;
  const sites = Array.isArray(input.disabledSites) ? input.disabledSites : [];
  return {
    source: value.source, target: value.target, range: value.range,
    ratio: typeof input.ratio === 'number' && Number.isFinite(input.ratio) ? clampRatio(input.ratio) : defaults.ratio,
    syncScroll: input.syncScroll !== false, highlight: input.highlight !== false,
    cache: input.cache !== false, authorized: input.authorized === true,
    disabledSites: [...new Set(sites.filter((site): site is string => typeof site === 'string')
      .map((site) => site.trim().toLowerCase().replace(/\.$/, ''))
      .filter((site) => /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(site)))].slice(0, 200),
  };
}

export function isDisabled(hostname: string, settings: Preferences) {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return settings.disabledSites.some((site) => name === site || name.endsWith('.' + site));
}
