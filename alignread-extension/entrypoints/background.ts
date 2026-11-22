import { browser } from 'wxt/browser';
import { DEFAULT_PARAGRAPH_SHORTCUT, isParagraphShortcut } from '../src/shared/paragraph-shortcut';
import {
  getSettings, hasProviderPermission, isConfigured, isDisabled, normalize, parseYoudaoCredentials, providerConsent,
  providerOrigin, publicSettings, removeUnusedProviderPermissions, sameCredentials, updateSettings, type Settings,
} from '../src/background/settings/settings';
import { installPdfTranslation } from '../src/background/pdf-port';
import { translateWithProvider } from '../src/background/translation/dispatch';
import { aiStrategy } from '../src/background/translation/ai-strategies';
import { EMPTY_AI_SERVICES, isAiProviderId, parseAiKey, parseAiSettings } from '../src/shared/ai-settings';
import { readReaderPage } from '../src/shared/reader-page';
import { sameSelectionPage } from '../src/shared/selection-page';
import {
  LIMITS, PROVIDER_IDS, TRANSLATION_PROVIDERS, clampRatio, defaults, failure, isProviderId, isReaderMode, isReadingOptions, isRecord,
  isTabId, selectedProviderAccess, success,
  type OptionsMessage, type PageState, type PopupMessage, type ProviderCheck, type ProviderId, type ReaderCommand, type ReaderRequest,
  type ReaderState, type Session, type TranslationItem,
} from '../src/shared/reader-messages';
import { MAX_SELECTION_LENGTH, type SelectionCommand, type SelectionKind, type SelectionRequest } from '../src/shared/selection-messages';

type Grant = { session: Session; documentId: string; hostname: string; revision: string; provider: ProviderId; pageUrl?: string };
type SessionKind = 'reader' | SelectionKind;
type Batch = Extract<ReaderRequest, { type: 'batch' }>;
type Job = { sessionId: string; batchId: string; controller: AbortController; promise: ReturnType<typeof translate> };
const jobs = new Map<string, Job>();
const tabCommands = new Map<number, Promise<unknown>>();
const limiter: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let slot = 0;
const grantKey = (tabId: number, kind: SessionKind) => kind + ':' + tabId;

export default defineBackground(() => {
  installPdfTranslation(validItems);
  browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (!isRecord(message) || sender.id !== browser.runtime.id) return;
    let response: Promise<unknown> | undefined;
    if (sender.url === browser.runtime.getURL('/popup.html') && isTabId(message.tabId)) {
      const command = message as unknown as PopupMessage;
      // Switching stops sessions via the same tab queue used by start and stop.
      response = command.type === 'page' || command.type === 'switch-provider'
        ? popup(command) : onTab(command.tabId, () => popup(command));
    } else if (sender.url?.split('#')[0] === browser.runtime.getURL('/pdf.html') && message.type === 'settings') {
      response = options({ type: 'settings' });
    } else if (sender.url?.split('#')[0] === browser.runtime.getURL('/options.html')) {
      response = options(message as unknown as OptionsMessage);
    } else if (sender.tab?.id !== undefined && sender.frameId === 0 && sender.documentId) {
      response = typeof message.type === 'string' && /^(selection|paragraph):/.test(message.type)
        ? selection(sender.tab.id, sender.documentId, sender.url, message as unknown as SelectionRequest)
        : reader(sender.tab.id, sender.documentId, sender.url, message as unknown as ReaderRequest);
    }
    if (!response) return;
    void response.then(reply, () => reply(failure('unavailable')));
    return true;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void onTab(tabId, () => Promise.all([clearGrant(tabId, 'reader'), clearGrant(tabId, 'selection'), clearGrant(tabId, 'paragraph')]))
      .catch(() => undefined);
  });
  browser.permissions.onRemoved.addListener(({ origins }) => {
    if (origins?.length) {
      void stopAfterPermissionRemoval().catch(() => undefined);
    }
  });
});

async function stopAfterPermissionRemoval() {
  const settings = await getSettings();
  if (await hasProviderPermission(settings, settings.provider)) return;
  await stopSessions((grant) => grant.revision === settings.revision);
}

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
  cancelSessionJob(key, grant.session.id);
  await browser.storage.session.remove(key);
}

function cancelSessionJob(key: string, sessionId: string) {
  const job = jobs.get(key);
  if (job?.sessionId === sessionId) {
    job.controller.abort();
    jobs.delete(key);
  }
}

async function stopSessions(matches: (grant: Grant) => boolean) {
  const stored = await browser.storage.session.get(null);
  await Promise.all(Object.entries(stored).map(async ([key, value]) => {
    const parts = /^(reader|selection|paragraph):(\d+)$/.exec(key);
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
    if (next === current) return current;
    next.checks = { ...current.checks };
    for (const provider of PROVIDER_IDS) {
      if (!sameCredentials(provider, current, next)) next.checks[provider] = null;
    }
    const accessChanged = !sameCredentials(current.provider, current, next) ||
      providerConsent(current, current.provider) !== providerConsent(next, current.provider);
    if (next.provider === current.provider && !accessChanged) return next;
    previousRevision = current.revision;
    return { ...next, revision: crypto.randomUUID() };
  });
  if (previousRevision !== undefined) await stopSessions(({ revision }) => revision === previousRevision);
  return saved;
}

async function selectProvider(provider: unknown, configuredOnly = false) {
  if (!isProviderId(provider)) return failure('unavailable');
  let missingCredentials = false;
  const settings = await updateProviderSettings((current) => {
    missingCredentials = configuredOnly && !isConfigured(current, provider);
    return missingCredentials || current.provider === provider ? current : { ...current, provider };
  });
  return missingCredentials ? failure('not-configured') : success(settings);
}

async function options(message: OptionsMessage) {
  switch (message.type) {
    case 'settings':
      return success(await publicSettings(await getSettings()));
    case 'save-shortcut': {
      if (!isParagraphShortcut(message.shortcut)) return failure('unavailable');
      await updateSettings(current => ({ ...current, paragraphShortcut: message.shortcut }));
      const grants = await browser.storage.session.get(null);
      const tabs = new Set(tabCommands.keys());
      for (const key of Object.keys(grants)) {
        const match = /^paragraph:(\d+)$/.exec(key);
        if (match) tabs.add(Number(match[1]));
      }
      await Promise.all([...tabs].map(tabId => onTab(tabId, async () => {
        const grant = await getGrant(tabId, 'paragraph');
        if (!grant) return;
        const { paragraphShortcut } = await getSettings();
        await send(tabId, grant.documentId, {
          type: 'paragraph:shortcut', sessionId: grant.session.id,
          shortcut: paragraphShortcut
        }).catch(() => undefined);
      })));
      return success((await getSettings()).paragraphShortcut);
    }
    case 'save': {
      if (!isReadingOptions(message.preferences)) return failure('unavailable');
      const { cache, disabledSites, authorized: _authorized, ...reading } = normalize(message.preferences);
      const sitePreferences = { cache, disabledSites };
      const changes = message.scope === 'reading' ? reading
        : message.scope === 'sites' ? sitePreferences : { ...reading, ...sitePreferences };
      const settings = await updateSettings((current) => ({ ...current, ...changes }));
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
      if (!settings.authorized) await removeUnusedProviderPermissions([TRANSLATION_PROVIDERS.google.origin]);
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
      if (!settings.youdaoAuthorized) await removeUnusedProviderPermissions([TRANSLATION_PROVIDERS.youdao.origin]);
      return success(await publicSettings(settings));
    }
    case 'save-ai': {
      const { config, authorized, provider } = message;
      if (!isAiProviderId(provider)) return failure('ai-config');
      const fields = isRecord(config) ? parseAiSettings(provider, config) : null;
      const key = isRecord(config) ? parseAiKey(config.apiKey) : null;
      if (typeof authorized !== 'boolean' || (config !== null && (!fields ||
          (config.apiKey !== undefined && !key)))) return failure('ai-config');

      let oldOrigin: string | undefined;
      let missingKey = false;
      const settings = await updateProviderSettings((current) => {
        const previous = current.aiServices[provider];
        const apiKey = key ?? (previous?.endpoint === fields?.endpoint ? previous?.apiKey : undefined);
        if (fields && !apiKey) {
          missingKey = true;
          return current;
        }
        oldOrigin = providerOrigin(current, provider);
        const service = fields && apiKey ? { ...fields, apiKey, authorized } : null;
        return { ...current, aiServices: { ...current.aiServices, [provider]: service } };
      });
      if (missingKey) return failure('ai-config');
      await removeUnusedProviderPermissions([oldOrigin]);
      return success(await publicSettings(settings));
    }
    case 'select-provider': {
      const selected = await selectProvider(message.provider);
      return selected.ok ? success(await publicSettings(selected.value)) : selected;
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
      let origins: (string | undefined)[] = [];
      const settings = await updateSettings((current) => {
        origins = PROVIDER_IDS.map((provider) => providerOrigin(current, provider));
        return {
          ...defaults, paragraphShortcut: DEFAULT_PARAGRAPH_SHORTCUT,
          provider: 'google', key: '', revision: crypto.randomUUID(), youdao: null, youdaoAuthorized: false,
          aiServices: { ...EMPTY_AI_SERVICES }, checks: {},
        };
      });
      await stopSessions(() => true);
      await removeUnusedProviderPermissions(origins);
      return success(await publicSettings(settings));
    }
    default:
      return failure('unavailable');
  }
}

async function testProvider(provider: ProviderId) {
  const settings = await getSettings();
  if (!isConfigured(settings, provider)) return failure('not-configured');
  if (!(await hasProviderPermission(settings, provider))) return failure('consent-required');

  const item = { id: 'connection-test', text: 'Hello, world!' };
  const testTimeout = isAiProviderId(provider) ? aiStrategy(provider).timeout + 3_000 : 22_000;
  const signal = AbortSignal.timeout(testTimeout);
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
  if (message.type === 'switch-provider') {
    const selected = await selectProvider(message.provider, true);
    if (!selected.ok) return selected;
    message = { type: 'page', tabId: message.tabId };
  }
  const { tabId } = message;
  const tab = await browser.tabs.get(tabId);
  const settings = await getSettings();
  const view = await publicSettings(settings);
  const url = tab.url ? new URL(tab.url) : undefined;
  const available = url && /^https?:$/.test(url.protocol) && !/\.pdf$/i.test(url.pathname);
  const disabled = available && isDisabled(url.hostname, settings);
  const sensitive = readReaderPage(tab.url)?.sensitive ?? false;

  if (message.type === 'page') {
    async function enabled(kind: SelectionKind) {
      if (!available || disabled) return false;
      const grant = await getGrant(tabId, kind);
      if (!grant || !sameSelectionPage(grant.pageUrl, tab.url)) return false;
      const active = await send(tabId, grant.documentId, { type: `${kind}:state` }).catch(() => null);
      return active === grant.session.id;
    }
    const [reader, selectionEnabled, paragraphEnabled] = await Promise.all([
      available ? browser.tabs.sendMessage(tabId, { type: 'reader:state' } satisfies ReaderCommand, { frameId: 0 })
        .catch(() => null) as Promise<ReaderState | null> : null,
      enabled('selection'), enabled('paragraph'),
    ]);
    return success<PageState>({
      settings: view, reader, selectionEnabled, paragraphEnabled,
      hostname: url?.hostname, sensitive,
      error: !available ? 'unsupported-page' : disabled ? 'site-disabled' : undefined,
    });
  }

  if (message.type === 'selection-stop' || message.type === 'paragraph-stop') {
    const kind = message.type === 'selection-stop' ? 'selection' : 'paragraph';
    const grant = await getGrant(tabId, kind);
    if (grant) {
      await clearGrant(tabId, kind, grant.session.id);
      await send(tabId, grant.documentId, { type: `${kind}:stop` }).catch(() => undefined);
    }
    return success(null);
  }

  if (message.type === 'control') {
    if (!['stop', 'pause', 'resume', 'retry'].includes(message.command)) return failure('unavailable');
    const grant = await getGrant(tabId, 'reader');
    if (!grant) return success(null);
    if (message.command === 'stop') await clearGrant(tabId, 'reader', grant.session.id);
    return success(await send(tabId, grant.documentId, {
      type: `reader:${message.command}`,
    }).catch(() => null));
  }

  if ((message.type !== 'start' && message.type !== 'selection-start' && message.type !== 'paragraph-start') || !isReadingOptions(message.options)) {
    return failure('unavailable');
  }
  if (message.type === 'start' && message.mode !== undefined && !isReaderMode(message.mode)) {
    return failure('unavailable');
  }
  const kind = message.type === 'start' ? 'reader' : message.type === 'selection-start' ? 'selection' : 'paragraph';
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

  // A different content script may receive the message without replying.
  const state = await send(tabId, documentId, { type: `${kind}:state` }).catch(() => undefined);
  if (state === undefined) {
    await browser.scripting.executeScript({ target: { tabId, documentIds: [documentId] }, files: [`/${kind}.js`] });
  }

  const current = await getSettings();
  if (current.revision !== settings.revision) return failure('stale');
  if (isDisabled(url.hostname, current)) return failure('site-disabled');
  const session: Session = {
    source: message.options.source, target: message.options.target, range: message.options.range,
    id: crypto.randomUUID(), ratio: view.ratio,
    dualComments: view.dualComments, replaceComments: view.replaceComments,
    highlight: view.highlight, syncScroll: view.syncScroll, cache: view.cache && !sensitive,
    ...(message.type === 'start' && { pageUrl: tab.url, mode: message.mode ?? 'dual' }),
  };
  if (kind === 'reader' && state?.mode && state.mode !== session.mode && (state.status !== 'error' || state.total > 0)) {
    const previous = await getGrant(tabId, 'reader');
    if (previous?.documentId === documentId && previous.revision === settings.revision && previous.provider === settings.provider &&
        (!sensitive || readReaderPage(previous.pageUrl)?.key === readReaderPage(tab.url)?.key)) {
      return switchReaderSession(tabId, previous, session);
    }
  }
  await clearGrant(tabId, kind);
  await browser.storage.session.set({
    [grantKey(tabId, kind)]: { session, documentId, hostname: url.hostname, revision: settings.revision,
      provider: settings.provider, pageUrl: tab.url } satisfies Grant,
  });
  try {
    const result = await send(tabId, documentId, kind === 'paragraph'
      ? { type: 'paragraph:start', session: { ...session, shortcut: current.paragraphShortcut } }
      : { type: `${kind}:start`, session });
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

async function reader(tabId: number, documentId: string, senderUrl: string | undefined, message: ReaderRequest) {
  // Order grant checks and job insertion with cancellation without waiting on the provider in the tab queue.
  const accepted = await onTab(tabId, async () => {
    const grant = await getGrant(tabId, 'reader');
    if (!grant || grant.documentId !== documentId || grant.session.id !== message.sessionId) {
      return { result: failure('stale') };
    }
    if (message.type === 'switch-mode') {
      return { result: await switchReaderMode(tabId, grant, senderUrl, message) };
    }
    if (message.type === 'closed') {
      await clearGrant(tabId, 'reader', message.sessionId);
      return { result: success(null) };
    }
    if (message.type === 'resize' && Number.isFinite(message.ratio)) {
      await updateSettings((settings) => ({ ...settings, ratio: clampRatio(message.ratio) }));
      return { result: success(null) };
    }
    if (message.type === 'cancel' && typeof message.batchId === 'string') {
      const key = grantKey(tabId, 'reader');
      const job = jobs.get(key);
      if (job?.sessionId === message.sessionId && job.batchId === message.batchId) {
        job.controller.abort();
        jobs.delete(key);
      }
      return { result: success(null) };
    }
    if (message.type !== 'batch' || typeof message.batchId !== 'string' || !validItems(message.items) ||
        (message.pageUrl !== undefined && typeof message.pageUrl !== 'string')) {
      return { result: failure('invalid-response') };
    }
    if (message.pageUrl !== undefined && senderUrl &&
        readReaderPage(message.pageUrl)?.key !== readReaderPage(senderUrl)?.key) {
      return { result: failure('stale') };
    }
    return { result: queueBatch(tabId, 'reader', grant, message) };
  });
  return accepted.result;
}

async function switchReaderMode(
  tabId: number, grant: Grant, senderUrl: string | undefined,
  message: Extract<ReaderRequest, { type: 'switch-mode' }>,
) {
  const { mode, pageUrl } = message;
  if (!isReaderMode(mode) || mode === (grant.session.mode ?? 'dual') || typeof pageUrl !== 'string') {
    return failure('unavailable');
  }
  if (!senderUrl || readReaderPage(pageUrl)?.key !== readReaderPage(senderUrl)?.key) return failure('stale');
  const pageFailure = await verifyReaderPage(tabId, grant, pageUrl);
  if (pageFailure) return pageFailure;
  const settings = await getSettings();
  if (settings.revision !== grant.revision || settings.provider !== grant.provider) return failure('stale');
  if (isDisabled(grant.hostname, settings)) return failure('site-disabled');
  if (!(await hasProviderPermission(settings, grant.provider))) return failure('consent-required');
  if ((await getSettings()).revision !== grant.revision) return failure('stale');

  const session: Session = {
    ...grant.session, id: crypto.randomUUID(), mode, pageUrl, ratio: settings.ratio,
    cache: grant.session.cache && settings.cache,
  };
  return switchReaderSession(tabId, grant, session);
}

async function switchReaderSession(tabId: number, grant: Grant, session: Session) {
  const key = grantKey(tabId, 'reader');
  const result = await send(tabId, grant.documentId, {
    type: 'reader:switch-mode', previousSessionId: grant.session.id, session,
  }).catch(() => undefined);
  if (!result?.ok) return result ?? failure('unavailable');

  cancelSessionJob(key, grant.session.id);
  // The tab queue holds new batches until the reader accepts the switch and the grant is saved.
  try {
    await browser.storage.session.set({ [key]: { ...grant, session } satisfies Grant });
  } catch {
    await send(tabId, grant.documentId, { type: 'reader:stop' }).catch(() => undefined);
    await clearGrant(tabId, 'reader', grant.session.id).catch(() => undefined);
    return failure('unavailable');
  }
  return result;
}

async function selection(tabId: number, documentId: string, url: string | undefined, message: SelectionRequest) {
  const kind = message.type.startsWith('paragraph:') ? 'paragraph' : 'selection';
  const grant = await getGrant(tabId, kind);
  if (!grant || grant.documentId !== documentId || grant.session.id !== message.sessionId) return failure('stale');
  if (message.type === 'selection:closed' || message.type === 'paragraph:closed') {
    await onTab(tabId, () => clearGrant(tabId, kind, message.sessionId));
    return success(null);
  }
  const key = grantKey(tabId, kind);
  if (message.type === 'selection:cancel' || message.type === 'paragraph:cancel') {
    const job = jobs.get(key);
    if (job?.sessionId === grant.session.id && job.batchId === message.requestId) job.controller.abort();
    return success(null);
  }
  if ((message.type !== 'selection:translate' && message.type !== 'paragraph:translate') ||
    !sameSelectionPage(grant.pageUrl, url)) return failure('stale');
  if (typeof message.requestId !== 'string' || typeof message.text !== 'string' ||
    message.text.length > (kind === 'paragraph' ? LIMITS.batchChars : MAX_SELECTION_LENGTH)) return failure('invalid-response');
  const batch: Batch = {
    type: 'batch', sessionId: message.sessionId, batchId: message.requestId,
    items: [{ id: message.requestId, text: message.text.trim() }],
  };
  if (!validItems(batch.items)) return failure('invalid-response');
  const result = await queueBatch(tabId, kind, grant, batch);
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

async function verifyReaderPage(tabId: number, grant: Grant, pageUrl: string | undefined) {
  const initial = readReaderPage(grant.pageUrl);
  const expected = readReaderPage(pageUrl ?? grant.pageUrl);
  if (!initial || !expected || initial.origin !== expected.origin) return failure('stale');
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url) return failure('stale');
  const actual = readReaderPage(tab.url);
  if (!actual) return failure('unsupported-page');
  if ((pageUrl === undefined && tab.url !== grant.pageUrl) || actual.key !== expected.key) return failure('stale');
  if (actual.sensitive && actual.key !== initial.key) return failure('sensitive-site');
  return undefined;
}

async function translate(tabId: number, kind: SessionKind, grant: Grant, message: Batch, signal: AbortSignal) {
  const settings = await getSettings();
  const provider = grant.provider ?? 'google';
  if (signal.aborted || (await getGrant(tabId, kind))?.session.id !== grant.session.id ||
      settings.revision !== grant.revision || settings.provider !== provider || isDisabled(grant.hostname, settings)) {
    return failure('stale');
  }
  if (!(await hasProviderPermission(settings, provider))) return failure('consent-required');
  if (kind !== 'reader') {
    const { url } = await browser.tabs.get(tabId);
    if (!sameSelectionPage(grant.pageUrl, url)) return failure('stale');
    if (url !== grant.pageUrl) {
      const active = await send(tabId, grant.documentId, { type: `${kind}:state` }).catch(() => null);
      if (active !== grant.session.id) return failure('stale');
    }
  }
  if (signal.aborted || (await getSettings()).revision !== grant.revision) return failure('stale');
  if (kind === 'reader') {
    const pageFailure = await verifyReaderPage(tabId, grant, message.pageUrl);
    if (pageFailure) return pageFailure;
  }
  if (signal.aborted) return failure('stale');
  const request = {
    source: grant.session.source, target: grant.session.target, range: grant.session.range,
    id: message.batchId, items: message.items,
  };
  const result = await translateWithProvider(provider, settings, request, signal);
  if (signal.aborted || (await getSettings()).revision !== grant.revision) return failure('stale');
  if (kind === 'reader') {
    const pageFailure = await verifyReaderPage(tabId, grant, message.pageUrl);
    if (pageFailure) return pageFailure;
  }
  return signal.aborted ? failure('stale') : result;
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
