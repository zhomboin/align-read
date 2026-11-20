export function pdfAddress(value?: string) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password) return;
    if ((url.hostname === 'arxiv.org' && /^\/pdf\/[a-z-]+\/\d+v?\d*\/?$/i.test(url.pathname)) ||
      /\.pdf$/i.test(url.pathname) || /\/pdf\/[^/]+\/?$/i.test(url.pathname) ||
      /\.pdf$/i.test(url.searchParams.get('file') ?? '')) return url;
  } catch { return; }
}
