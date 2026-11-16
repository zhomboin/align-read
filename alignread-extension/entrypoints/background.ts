import { browser } from 'wxt/browser';
import {
  getSettings, hasProviderPermission, isDisabled, normalize, parseYoudaoCredentials, publicSettings, sameCredentials,
  updateSettings, type Settings,
} from '../src/background/settings/settings';
import { google } from '../src/background/translation/google';
import type { TranslationBatch } from '../src/background/translation/provider';
import { youdao } from '../src/background/translation/youdao';
import {
  LIMITS, TRANSLATION_PROVIDERS, clampRatio, defaults, failure, isProviderId, isReadingOptions, isRecord,
  isSensitive, isTabId, selectedProviderAccess, success,
  type OptionsMessage, type PageState, type PopupMessage, type ProviderCheck, type ProviderId, type ReaderCommand, type ReaderRequest,
  type ReaderState, type Session, type TranslationItem,
} from '../src/shared/reader-messages';
import { MAX_SELECTION_LENGTH, type SelectionCommand, type SelectionRequest } from '../src/shared/selection-messages';

type Grant = { session: Session; documentId: string; hostname: string; revision: string; provider: ProviderId; pageUrl?: string };
type SessionKind = 'reader' | 'selection';
type Batch = Extract<ReaderRequest, { type: 'batch' }>;
type Job = { sessionId: string; batchId: string; controller: AbortController; promise: ReturnType<typeof translate> };
const jobs = new Map<string, Job>();
const tabCommands = new Map<number, Promise<unknown>>();
const limiter: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let slot = 0;
const grantKey = (tabId: number, kind: SessionKind) => kind + ':' + tabId;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (!isRecord(message) || sender.id !== browser.runtime.id) return;
    let response: Promise<unknown> | undefined;
    if (sender.url === browser.runtime.getURL('/popup.html') && isTabId(message.tabId)) {
      const command = message as unknown as PopupMessage;
      response = command.type === 'page' ? popup(command) : onTab(command.tabId, () => popup(command));
    } else if (sender.url === browser.runtime.getURL('/options.html')) {
      response = options(message as unknown as OptionsMessage);
    } else if (sender.tab?.id !== undefined && sender.frameId === 0 && sender.documentId) {
      response = typeof message.type === 'string' && message.type.startsWith('selection:')
        ? selection(sender.tab.id, sender.documentId, sender.url, message as unknown as SelectionRequest)
        : reader(sender.tab.id, sender.documentId, message as unknown as ReaderRequest);
    }
    if (!response) return;
    void response.then(reply, () => reply(failure('unavailable')));
    return true;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void onTab(tabId, () => Promise.all([clearGrant(tabId, 'reader'), clearGrant(tabId, 'selection')]))
      .catch(() => undefined);
  });
  browser.permissions.onRemoved.addListener(({ origins }) => {
    if (origins?.length) {
      void stopSessions(({ provider }) => origins.includes(TRANSLATION_PROVIDERS[provider ?? 'google'].origin))
        .catch(() => undefined);
    }
  });
});

function onTab<T>(tabId: number, action: () => Promise<T>): Promise<T> {
  const result = (tabCommands.get(tabId) ?? Promise.resolve()).then(action);
  tabCommands.set(tabId, result);
  const clear = () => { if (tabCommands.get(tabId) === result) tabCommands.delete(tabId); };
  void result.then(clear, clear);
  return result;
}

async function getGrant(tabId: number, kind: SessionKind): Promise<Grant | undefined> {
  const key = grantKey(tabId, kind);
  return (await browser.storage.session.get(key))[key] as Grant | undefined;
}

async function clearGrant(tabId: number, kind: SessionKind, sessionId?: string) {
  const grant = await getGrant(tabId, kind);
  if (!grant || (sessionId && sessionId !== grant.session.id)) return;
  const key = grantKey(tabId, kind);
  const job = jobs.get(key);
  if (job?.sessionId === grant.session.id) {
    job.controller.abort();
    jobs.delete(key);
  }
  await browser.storage.session.remove(key);
}

async function stopSessions(matches: (grant: Grant) => boolean) {
  const stored = await browser.storage.session.get(null);
  await Promise.all(Object.entries(stored).map(async ([key, value]) => {
    const parts = /^(reader|selection):(\d+)$/.exec(key);
    if (!parts) return;
    const kind = parts[1] as SessionKind;
    const tabId = Number(parts[2]);
    const grant = value as Grant;
    if (!matches(grant)) return;
    await onTab(tabId, async () => {
      if ((await getGrant(tabId, kind))?.session.id !== grant.session.id) return;
      await clearGrant(tabId, kind, grant.session.id);
      await send(tabId, grant.documentId, { type: `${kind}:stop` }).catch(() => undefined);
    });
  }));
}

async function updateProviderSettings(update: (current: Settings) => Settings) {
  let previousRevision: string | undefined;
  const saved = await updateSettings((current) => {
    const next = update(current);
    const sameGoogleKey = sameCredentials('google', current, next);
    const sameYoudaoKey = sameCredentials('youdao', current, next);
    next.checks = {
      google: sameGoogleKey ? current.checks.google : null,
      youdao: sameYoudaoKey ? current.checks.youdao : null,
    };
    const accessChanged = current.provider === 'google'
      ? !sameGoogleKey || next.authorized !== current.authorized
      : !sameYoudaoKey || next.youdaoAuthorized !== current.youdaoAuthorized;
    if (next.provider === current.provider && !accessChanged) return next;
    previousRevision = current.revision;
    return { ...next, revision: crypto.randomUUID() };
  });
  if (previousRevision !== undefined) await stopSessions(({ revision }) => revision === previousRevision);
  return saved;
}

async function options(message: OptionsMessage) {
  switch (message.type) {
    case 'settings':
      return success(await publicSettings(await getSettings()));
    case 'save': {
      if (!isReadingOptions(message.preferences)) return failure('unavailable');
      const settings = await updateSettings((current) => ({
        ...current, ...normalize(message.preferences), authorized: current.authorized,
      }));
      await stopSessions(({ hostname }) => isDisabled(hostname, settings));
      if (!settings.cache) await clearCaches(true);
      return success(await publicSettings(settings));
    }
    case 'save-google': {
      if (typeof message.authorized !== 'boolean' ||
        (message.key !== undefined && (typeof message.key !== 'string' || message.key.length > 250))) {
        return failure('unavailable');
      }
      const settings = await updateProviderSettings((current) => {
        const key = message.key?.trim() ?? current.key;
        return { ...current, key, authorized: Boolean(key) && message.authorized };
      });
      if (!settings.authorized) await browser.permissions.remove({ origins: [TRANSLATION_PROVIDERS.google.origin] });
      return success(await publicSettings(settings));
    }
    case 'save-youdao': {
      const credentials = parseYoudaoCredentials(message.credentials);
      if (typeof message.authorized !== 'boolean' || (message.credentials != null && !credentials)) {
        return failure('unavailable');
      }
      const settings = await updateProviderSettings((current) => {
        const youdao = message.credentials === undefined ? current.youdao : credentials;
        return { ...current, youdao, youdaoAuthorized: Boolean(youdao) && message.authorized };
      });
      if (!settings.youdaoAuthorized) await browser.permissions.remove({ origins: [TRANSLATION_PROVIDERS.youdao.origin] });
      return success(await publicSettings(settings));
    }
    case 'select-provider': {
      const { provider } = message;
      if (!isProviderId(provider)) return failure('unavailable');
      const settings = await updateProviderSettings((current) => ({ ...current, provider }));
      return success(await publicSettings(settings));
    }
    case 'test-provider':
      return isProviderId(message.provider) ? testProvider(message.provider) : failure('unavailable');
    case 'cache-usage': {
      const tabs = await browser.tabs.query({});
      const states = await Promise.all(tabs.map(({ id }) => id === undefined ? null :
        browser.tabs.sendMessage(id, { type: 'reader:state' } satisfies ReaderCommand, { frameId: 0 })
          .catch(() => null) as Promise<ReaderState | null>));
      return success(states.reduce((sum, state) => sum + (state?.cacheBytes ?? 0), 0));
    }
    case 'clear-cache':
      await clearCaches();
      return success(null);
    case 'reset': {
      const settings = await updateSettings(() => ({
        ...defaults, provider: 'google', key: '', revision: crypto.randomUUID(), youdao: null, youdaoAuthorized: false,
        checks: {},
      }));
      await stopSessions(() => true);
      await browser.permissions.remove({ origins: Object.values(TRANSLATION_PROVIDERS).map(({ origin }) => origin) });
      return success(await publicSettings(settings));
    }
    default:
      return failure('unavailable');
  }
}

async function testProvider(provider: ProviderId) {
  const settings = await getSettings();
  if (provider === 'google' ? !settings.key : !settings.youdao) return failure('not-configured');
  if (!(await hasProviderPermission(settings, provider))) return failure('consent-required');

  const item = { id: 'connection-test', text: 'Hello, world!' };
  const signal = AbortSignal.timeout(22_000);
  const result = await translateWithProvider(provider, settings, {
    id: item.id, items: [item], source: 'en', target: 'zh-CN', range: 'visible',
  }, signal);
  const check: ProviderCheck = { checkedAt: Date.now() };
  if (signal.aborted) check.error = 'timeout';
  else if (!result.ok) check.error = result.error;
  else if (result.value.items[0]?.id !== item.id || !result.value.items[0].text.trim()) check.error = 'invalid-response';

  let changed = false;
  const saved = await updateSettings(async (current) => {
    changed = !sameCredentials(provider, settings, current) || !(await hasProviderPermission(current, provider));
    if (changed || (current.checks[provider]?.checkedAt ?? 0) > check.checkedAt) return current;
    return { ...current, checks: { ...current.checks, [provider]: check } };
  });
  return changed ? failure('config-changed') : success(await publicSettings(saved));
}

async function clearCaches(disable = false) {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map(({ id }) => id === undefined ? undefined :
    browser.tabs.sendMessage(id, { type: 'reader:clear-cache', disable } satisfies ReaderCommand, { frameId: 0 })
      .catch(() => undefined)));
}

async function popup(message: PopupMessage) {
  const { tabId } = message;
  const tab = await browser.tabs.get(tabId);
  const settings = await getSettings();
  const view = await publicSettings(settings);
  const url = tab.url ? new URL(tab.url) : undefined;
  const available = url && /^https?:$/.test(url.protocol) && !/\.pdf$/i.test(url.pathname);
  const disabled = available && isDisabled(url.hostname, settings);
  const sensitive = Boolean(available && isSensitive(url.hostname, url.pathname));

  if (message.type === 'page') {
    const grant = available && !disabled ? await getGrant(tabId, 'selection') : undefined;
    const [reader, selectionId] = await Promise.all([
      available ? browser.tabs.sendMessage(tabId, { type: 'reader:state' } satisfies ReaderCommand, { frameId: 0 })
        .catch(() => null) as Promise<ReaderState | null> : null,
      grant && grant.pageUrl === tab.url ? send(tabId, grant.documentId, { type: 'selection:state' }).catch(() => null) : null,
    ]);
    return success<PageState>({
      settings: view, reader, selectionEnabled: Boolean(grant && selectionId === grant.session.id),
      hostname: url?.hostname, sensitive,
      error: !available ? 'unsupported-page' : disabled ? 'site-disabled' : undefined,
    });
  }

  if (message.type === 'selection-stop') {
    const grant = await getGrant(tabId, 'selection');
    if (grant) {
      await clearGrant(tabId, 'selection', grant.session.id);
      await send(tabId, grant.documentId, { type: 'selection:stop' }).catch(() => undefined);
    }
    return success(null);
  }

  if (message.type === 'control') {
    if (!['stop', 'pause', 'resume'].includes(message.command)) return failure('unavailable');
    const grant = await getGrant(tabId, 'reader');
    if (!grant) return success(null);
    if (message.command === 'stop') await clearGrant(tabId, 'reader', grant.session.id);
    return success(await send(tabId, grant.documentId, {
      type: 'reader:' + message.command,
    } as ReaderCommand).catch(() => null));
  }

  if ((message.type !== 'start' && message.type !== 'selection-start') || !isReadingOptions(message.options)) {
    return failure('unavailable');
  }
  const kind = message.type === 'start' ? 'reader' : 'selection';
  if (!available) return failure('unsupported-page');
  if (disabled) return failure('site-disabled');
  if (message.provider !== settings.provider) return failure('provider-changed');
  const access = selectedProviderAccess(view);
  if (!access.configured) return failure('not-configured');
  if (!access.authorized) return failure('consent-required');
  if (sensitive && message.confirmSensitive !== true) return failure('sensitive-site');

  let documentId: string | undefined;
  try {
    const [document] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] }, func: () => location.href,
    });
    if (!document || document.result !== tab.url) return failure('unavailable');
    documentId = document.documentId;
  } catch {
    return failure('unsupported-page');
  }
  if (!documentId) return failure('unsupported-page');

  try {
    await send(tabId, documentId, { type: `${kind}:state` });
  } catch {
    await browser.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, files: [`/${kind}.js`] });
  }

  const current = await getSettings();
  if (current.revision !== settings.revision) return failure('stale');
  if (isDisabled(url.hostname, current)) return failure('site-disabled');
  const session: Session = {
    source: message.options.source, target: message.options.target, range: message.options.range,
    id: crypto.randomUUID(), ratio: view.ratio,
    highlight: view.highlight, syncScroll: view.syncScroll, cache: view.cache && !sensitive,
  };
  await clearGrant(tabId, kind);
  await browser.storage.session.set({
    [grantKey(tabId, kind)]: { session, documentId, hostname: url.hostname, revision: settings.revision,
      provider: settings.provider, ...(kind === 'selection' && { pageUrl: tab.url }) } satisfies Grant,
  });
  try {
    const result = await send(tabId, documentId, { type: `${kind}:start`, session });
    if (!result?.ok) await clearGrant(tabId, kind, session.id);
    return result;
  } catch {
    await clearGrant(tabId, kind, session.id);
    return failure('unavailable');
  }
}

function send(tabId: number, documentId: string, message: ReaderCommand | SelectionCommand) {
  return browser.tabs.sendMessage(tabId, message, { documentId });
}

async function reader(tabId: number, documentId: string, message: ReaderRequest) {
  const grant = await getGrant(tabId, 'reader');
  if (!grant || grant.documentId !== documentId || grant.session.id !== message.sessionId) return failure('stale');
  if (message.type === 'closed') {
    await onTab(tabId, () => clearGrant(tabId, 'reader', message.sessionId));
    return success(null);
  }
  if (message.type === 'resize' && Number.isFinite(message.ratio)) {
    await updateSettings((settings) => ({ ...settings, ratio: clampRatio(message.ratio) }));
    return success(null);
  }
  if (message.type !== 'batch' || typeof message.batchId !== 'string' || !validItems(message.items)) {
    return failure('invalid-response');
  }
  return queueBatch(tabId, 'reader', grant, message);
}

async function selection(tabId: number, documentId: string, url: string | undefined, message: SelectionRequest) {
  const grant = await getGrant(tabId, 'selection');
  if (!grant || grant.documentId !== documentId || grant.session.id !== message.sessionId) return failure('stale');
  if (message.type === 'selection:closed') {
    await onTab(tabId, () => clearGrant(tabId, 'selection', message.sessionId));
    return success(null);
  }
  if (message.type === 'selection:cancel') {
    const job = jobs.get(grantKey(tabId, 'selection'));
    if (job?.sessionId === grant.session.id && job.batchId === message.requestId) job.controller.abort();
    return success(null);
  }
  if (message.type !== 'selection:translate' || !url || url !== grant.pageUrl) return failure('stale');
  if (typeof message.requestId !== 'string' || typeof message.text !== 'string' ||
      message.text.length > MAX_SELECTION_LENGTH) return failure('invalid-response');
  const batch: Batch = {
    type: 'batch', sessionId: message.sessionId, batchId: message.requestId,
    items: [{ id: message.requestId, text: message.text.trim() }],
  };
  if (!validItems(batch.items)) return failure('invalid-response');
  const result = await queueBatch(tabId, 'selection', grant, batch);
  if (!result.ok) return result;
  const item = result.value.items[0];
  if (result.value.id !== message.requestId || item?.id !== message.requestId || !item.text.trim()) {
    return failure('invalid-response');
  }
  return success(item.text);
}

async function queueBatch(tabId: number, kind: SessionKind, grant: Grant, message: Batch) {
  const key = grantKey(tabId, kind);
  const current = jobs.get(key);
  if (current && current.sessionId !== grant.session.id) return failure('stale');
  if (current && kind === 'reader') return failure('rate-limit');
  current?.controller.abort();
  const controller = new AbortController();
  const lane = slot++ % limiter.length;
  const promise = limiter[lane]!.then(() => translate(tabId, kind, grant, message, controller.signal));
  limiter[lane] = promise.catch(() => undefined);
  jobs.set(key, { sessionId: grant.session.id, batchId: message.batchId, controller, promise });
  try {
    return await promise;
  } finally {
    if (jobs.get(key)?.promise === promise) jobs.delete(key);
  }
}

async function translate(tabId: number, kind: SessionKind, grant: Grant, message: Batch, signal: AbortSignal) {
  const settings = await getSettings();
  const provider = grant.provider ?? 'google';
  if (signal.aborted || (await getGrant(tabId, kind))?.session.id !== grant.session.id ||
      settings.revision !== grant.revision || settings.provider !== provider || isDisabled(grant.hostname, settings)) {
    return failure('stale');
  }
  if (!(await hasProviderPermission(settings, provider))) return failure('consent-required');
  if (kind === 'selection' && (await browser.tabs.get(tabId)).url !== grant.pageUrl) return failure('stale');
  if (signal.aborted || (await getSettings()).revision !== grant.revision) return failure('stale');
  const request = {
    source: grant.session.source, target: grant.session.target, range: grant.session.range,
    id: message.batchId, items: message.items,
  };
  const result = await translateWithProvider(provider, settings, request, signal);
  return signal.aborted ? failure('stale') : result;
}

function translateWithProvider(provider: ProviderId, settings: Settings, request: TranslationBatch, signal: AbortSignal) {
  if (provider === 'youdao') {
    return settings.youdao ? youdao.translateSegments(request, settings.youdao, signal) : failure('not-configured');
  }
  return settings.key ? google.translateSegments(request, settings.key, signal) : failure('not-configured');
}

function validItems(items: unknown): items is TranslationItem[] {
  if (!Array.isArray(items) || !items.length || items.length > LIMITS.batchItems) return false;
  const ids = new Set<string>();
  let length = 0;
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || item.id.length > 80 ||
        ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim()) return false;
    ids.add(item.id);
    length += item.text.length;
  }
  return length <= LIMITS.batchChars;
}
