import { browser } from 'wxt/browser';

export function pdfAddress(value?: string, confirmed = false) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) return;
    if (confirmed || (url.hostname === 'arxiv.org' && /^\/pdf\/[a-z-]+\/\d+v?\d*\/?$/i.test(url.pathname)) ||
      /\.pdf$/i.test(url.pathname) || /\/pdf\/[^/]+\/?$/i.test(url.pathname) ||
      /\.pdf$/i.test(url.searchParams.get('file') ?? '')) return url;
  } catch { return; }
}

export async function currentPdf(tabId: number, value?: string) {
  const address = pdfAddress(value, true);
  if (!address) return;
  try {
    const [top] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] }, injectImmediately: true,
      func: () => ({ href: location.href, isPdf: document.contentType === 'application/pdf' }),
    });
    if (top?.result) return top.result.href === value && top.result.isPdf ? address : undefined;
  } catch {
    // Some native viewers expose the tab URL but reject scripts in their document.
  }
  return pdfAddress(value);
}
