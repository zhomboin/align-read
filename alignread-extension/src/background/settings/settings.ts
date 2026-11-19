import { browser } from 'wxt/browser';
import {
  AI_PROVIDER_IDS, EMPTY_AI_SERVICES, aiHostPermission, isAiProviderId, parseAiKey, parseAiSettings,
  type AiCredentials, type AiProviderId, type AiSettings,
} from '../../shared/ai-settings';
import {
  MAX_YOUDAO_CREDENTIAL_LENGTH, PROVIDER_IDS, TRANSLATION_PROVIDERS, clampRatio, defaults, errors, isProviderId, isReadingOptions, isRecord,
  type ErrorCode, type Preferences, type ProviderCheck, type ProviderId, type PublicSettings, type YoudaoCredentials,
} from '../../shared/reader-messages.ts';

const KEY = 'providerSettings';
type SavedAiService = AiCredentials & { authorized: boolean };
export type Settings = Preferences & {
  provider: ProviderId;
  key: string;
  revision: string;
  youdao: YoudaoCredentials | null;
  youdaoAuthorized: boolean;
  aiServices: Record<AiProviderId, SavedAiService | null>;
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
  const storedChecks = isRecord(saved.checks) ? saved.checks : {};
  const checks: Settings['checks'] = {};
  for (const provider of PROVIDER_IDS) checks[provider] = parseCheck(storedChecks[provider]);
  const storedAi: Record<string, unknown> = isRecord(saved.aiServices) ? saved.aiServices : {
    ai: isRecord(saved.ai) ? { ...saved.ai, authorized: saved.aiAuthorized } : null,
  };
  const aiServices: Settings['aiServices'] = { ...EMPTY_AI_SERVICES };
  for (const provider of AI_PROVIDER_IDS) aiServices[provider] = readAiService(provider, storedAi[provider]);
  return { ...normalize(saved),
    provider: isProviderId(saved.provider) ? saved.provider : 'google',
    key: typeof saved.key === 'string' ? saved.key : '',
    revision: typeof saved.revision === 'string' ? saved.revision : '',
    youdao: parseYoudaoCredentials(saved.youdao),
    youdaoAuthorized: saved.youdaoAuthorized === true,
    aiServices, checks,
  };
}

export async function publicSettings(settings: Settings): Promise<PublicSettings> {
  const { key: _key, revision: _revision, youdao, checks, authorized: _authorized,
    youdaoAuthorized: _youdaoAuthorized, aiServices, ...preferences } = settings;
  const publicAi: Record<AiProviderId, AiSettings | null> = { ...EMPTY_AI_SERVICES };
  for (const provider of AI_PROVIDER_IDS) {
    const service = aiServices[provider];
    if (service) publicAi[provider] = { endpoint: service.endpoint, model: service.model };
  }
  const statuses = await Promise.all(PROVIDER_IDS.map(async (provider) => {
    const configured = isConfigured(settings, provider);
    return [provider, {
      configured, consent: providerConsent(settings, provider), hostPermission: await hasHostPermission(settings, provider),
      lastCheck: configured ? checks[provider] ?? null : null,
      ...(provider === 'youdao' && youdao && youdao.appKey.length > 4 && { appKeySuffix: youdao.appKey.slice(-4) }),
    }] as const;
  }));
  return { ...preferences, aiServices: publicAi, providers: Object.fromEntries(statuses) as PublicSettings['providers'] };
}

export async function hasProviderPermission(settings: Settings, provider: ProviderId) {
  return providerConsent(settings, provider) && await hasHostPermission(settings, provider);
}

export function providerConsent(settings: Settings, provider: ProviderId) {
  switch (provider) {
    case 'google': return settings.authorized;
    case 'youdao': return settings.youdaoAuthorized;
    default: return settings.aiServices[provider]?.authorized === true;
  }
}

export function providerOrigin(settings: Settings, provider: ProviderId) {
  if (!isAiProviderId(provider)) return TRANSLATION_PROVIDERS[provider].origin;
  const service = settings.aiServices[provider];
  return service ? aiHostPermission(service.endpoint) : undefined;
}

async function hasHostPermission(settings: Settings, provider: ProviderId) {
  const origin = providerOrigin(settings, provider);
  return Boolean(origin && await browser.permissions.contains({ origins: [origin] }));
}

export async function removeUnusedProviderPermissions(origins: (string | undefined)[]) {
  const settings = await getSettings();
  const inUse = new Set(PROVIDER_IDS.filter((provider) => providerConsent(settings, provider))
    .map((provider) => providerOrigin(settings, provider)));
  const unused = [...new Set(origins)].filter((origin): origin is string => Boolean(origin && !inUse.has(origin)));
  if (unused.length) await browser.permissions.remove({ origins: unused });
}

export function isConfigured(settings: Settings, provider: ProviderId) {
  switch (provider) {
    case 'google': return Boolean(settings.key);
    case 'youdao': return Boolean(settings.youdao);
    default: return Boolean(settings.aiServices[provider]);
  }
}

export function sameCredentials(provider: ProviderId, first: Settings, second: Settings) {
  switch (provider) {
    case 'google': return first.key === second.key;
    case 'youdao': return first.youdao?.appKey === second.youdao?.appKey && first.youdao?.appSecret === second.youdao?.appSecret;
    default: {
      const previous = first.aiServices[provider];
      const next = second.aiServices[provider];
      return previous?.endpoint === next?.endpoint && previous?.model === next?.model && previous?.apiKey === next?.apiKey;
    }
  }
}

function readAiService(provider: AiProviderId, value: unknown): SavedAiService | null {
  if (!isRecord(value)) return null;
  const fields = parseAiSettings(provider, value);
  const apiKey = parseAiKey(value.apiKey);
  return fields && apiKey ? { ...fields, apiKey, authorized: value.authorized === true } : null;
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
    dualComments: input.dualComments === true, replaceComments: input.replaceComments === true,
    ratio: typeof input.ratio === 'number' && Number.isFinite(input.ratio) ? clampRatio(input.ratio) : defaults.ratio,
    syncScroll: input.syncScroll !== false, highlight: input.highlight !== false,
    cache: input.cache !== false, authorized: input.authorized === true,
    disabledSites: [...new Set(sites.filter((site): site is string => typeof site === 'string')
      .map((site) => site.trim().toLowerCase().replace(/\.$/, ''))
      .filter((site) => /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(site)))].slice(0, 200),
  };
}

export function isDisabled(hostname: string, settings: Pick<Preferences, 'disabledSites'>) {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return settings.disabledSites.some((site) => name === site || name.endsWith('.' + site));
}
