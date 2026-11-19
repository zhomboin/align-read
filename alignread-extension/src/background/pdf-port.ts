import { browser } from 'wxt/browser';
import { getSettings, hasProviderPermission, isConfigured, isDisabled, providerOrigin } from './settings/settings';
import { translateWithProvider } from './translation/dispatch';
import { failure, isProviderId, isReadingOptions, isRecord, type TranslationItem } from '../shared/reader-messages';

export function installPdfTranslation(validItems: (items: unknown) => items is TranslationItem[]) {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'pdf-translation' || port.sender?.id !== browser.runtime.id ||
      port.sender.url?.split('#')[0] !== browser.runtime.getURL('/pdf.html')) return;
    const controller = new AbortController();
    let revision: string | undefined;
    let busy = false;
    let hostname = '';
    let origin: string | undefined;
    function stop() {
      controller.abort();
      browser.permissions.onRemoved.removeListener(permissionRemoved);
      browser.storage.onChanged.removeListener(changed);
    }
    function revoked() {
      if (controller.signal.aborted) return;
      stop();
      port.disconnect();
    }
    async function permissionRemoved() {
      if (origin && !await browser.permissions.contains({ origins: [origin] })) revoked();
    }
    function changed(changes: Record<string, { newValue?: unknown; }>, area: string) {
      if (area !== 'local' || !changes.providerSettings) return;
      const value = changes.providerSettings.newValue;
      if (!isRecord(value) || (revision !== undefined && (value.revision ?? '') !== revision)) { revoked(); return; }
      const disabledSites = Array.isArray(value.disabledSites) ? value.disabledSites.filter((site): site is string => typeof site === 'string') : [];
      if (isDisabled(hostname, { disabledSites })) revoked();
    }
    browser.permissions.onRemoved.addListener(permissionRemoved);
    browser.storage.onChanged.addListener(changed);
    port.onDisconnect.addListener(stop);
    port.onMessage.addListener(async (message: unknown) => {
      if (busy || !isRecord(message) || !isProviderId(message.provider) || !isReadingOptions(message.options) ||
        typeof message.hostname !== 'string' || typeof message.id !== 'string' || !validItems(message.items)) {
        if (!controller.signal.aborted) port.postMessage(failure('invalid-response'));
        return;
      }
      busy = true;
      try {
        const settings = await getSettings();
        revision ??= settings.revision;
        const provider = message.provider;
        hostname = message.hostname;
        origin = providerOrigin(settings, provider);
        const denied = settings.provider !== provider || settings.revision !== revision ? 'provider-changed'
          : isDisabled(message.hostname, settings) ? 'site-disabled'
            : !isConfigured(settings, provider) ? 'not-configured'
              : !(await hasProviderPermission(settings, provider)) ? 'consent-required' : undefined;
        if (controller.signal.aborted) return;
        const result = denied ? failure(denied) : await translateWithProvider(provider, settings, {
          ...message.options, id: message.id, items: message.items,
        }, controller.signal);
        if (!controller.signal.aborted) port.postMessage(result);
      } catch {
        if (!controller.signal.aborted) port.postMessage(failure('unavailable'));
      } finally { busy = false; }
    });
  });
}
