// Chromium reports the size of file URLs in progress events. Its Range responses
// can contain just the requested bytes with status 200 and no Content-Range.
export function localSource(url: URL, signal: AbortSignal, chunkSize: number, limit: number) {
  return new Promise<Blob | { size: number; modified: string | null }>((resolve, reject) => {
    signal.throwIfAborted();
    const request = new XMLHttpRequest();
    const cancel = () => request.abort();
    request.open('GET', url.href);
    request.responseType = 'blob';
    request.onprogress = event => {
      const size = event.lengthComputable ? event.total : event.loaded;
      if (size > limit) {
        reject(new Error('请选择 100 MiB 以内的 PDF。'));
        cancel();
      } else if (event.lengthComputable && size > chunkSize) {
        resolve({ size, modified: request.getResponseHeader('Last-Modified') });
        cancel();
      }
    };
    request.onload = () => resolve(request.response);
    request.onerror = () => reject(new Error('无法读取本地文件，请点击「选择 PDF」。'));
    request.onabort = () => reject(signal.reason ?? new Error('读取已取消。'));
    request.onloadend = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, { once: true });
    request.send();
  });
}
