import { isSensitive } from './reader-messages';

export function readReaderPage(href: string | undefined): {
  key: string; viewKey: string; origin: string; sensitive: boolean;
} | undefined {
  if (!href) return;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol) || /\.pdf$/i.test(url.pathname)) return;

  const hashRoute = /^#!?\//.test(url.hash) ? url.hash : '';
  const hashView = hashRoute ? '#' + hashRoute.slice(1).split(/[?#]/, 1)[0] : '';
  const hashPath = hashView.replace(/^#!?/, '');
  return {
    key: url.origin + url.pathname + url.search + hashRoute,
    viewKey: url.origin + url.pathname + hashView,
    origin: url.origin,
    sensitive: isSensitive(url.hostname, decodedPath(url.pathname)) || isSensitive('', decodedPath(hashPath)),
  };
}

function decodedPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
