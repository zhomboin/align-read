import { browser } from 'wxt/browser';
import {
  MAX_YOUDAO_CREDENTIAL_LENGTH, TRANSLATION_PROVIDERS, clampRatio, defaults, errors, isProviderId, isReadingOptions, isRecord,
  type ErrorCode, type Preferences, type ProviderCheck, type ProviderId, type PublicSettings, type YoudaoCredentials,
} from '../../shared/reader-messages.ts';

const KEY = 'providerSettings';
export type Settings = Preferences & {
  provider: ProviderId;
  key: string;
  revision: string;
  youdao: YoudaoCredentials | null;
  youdaoAuthorized: boolean;
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
  return { ...normalize(saved),
    provider: isProviderId(saved.provider) ? saved.provider : 'google',
    key: typeof saved.key === 'string' ? saved.key : '',
    revision: typeof saved.revision === 'string' ? saved.revision : '',
    youdao: parseYoudaoCredentials(saved.youdao),
    youdaoAuthorized: saved.youdaoAuthorized === true,
    checks: { google: parseCheck(checks.google), youdao: parseCheck(checks.youdao) },
  };
}

export async function publicSettings(settings: Settings): Promise<PublicSettings> {
  const { key, revision: _, youdao, checks, authorized, youdaoAuthorized, ...preferences } = settings;
  const [googlePermission, youdaoPermission] = await Promise.all([
    hasHostPermission('google'), hasHostPermission('youdao'),
  ]);
  return { ...preferences, providers: {
    google: { configured: isConfigured(settings, 'google'), consent: authorized, hostPermission: googlePermission,
      lastCheck: key ? checks.google ?? null : null },
    youdao: { configured: isConfigured(settings, 'youdao'), consent: youdaoAuthorized, hostPermission: youdaoPermission,
      lastCheck: youdao ? checks.youdao ?? null : null,
      appKeySuffix: youdao && youdao.appKey.length > 4 ? youdao.appKey.slice(-4) : undefined },
  } };
}

export function isConfigured(settings: Settings, provider: ProviderId) {
  const configured: Record<ProviderId, boolean> = { google: Boolean(settings.key), youdao: settings.youdao !== null };
  return configured[provider];
}

export async function hasProviderPermission(settings: Settings, provider: ProviderId) {
  const consent = provider === 'youdao' ? settings.youdaoAuthorized : settings.authorized;
  return consent && await hasHostPermission(provider);
}

function hasHostPermission(provider: ProviderId) {
  return browser.permissions.contains({ origins: [TRANSLATION_PROVIDERS[provider].origin] });
}

export function sameCredentials(provider: ProviderId, first: Settings, second: Settings) {
  return provider === 'google' ? first.key === second.key :
    first.youdao?.appKey === second.youdao?.appKey && first.youdao?.appSecret === second.youdao?.appSecret;
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
