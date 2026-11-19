function initBrowser(version, tabId) {
  const requests = new Map();
  let sequence = 0;
  function request(message) {
    return new Promise(resolve => {
      const id = ++sequence;
      requests.set(id, resolve);
      alignreadRequest(JSON.stringify({ id, message }));
    });
  }
  globalThis.openedOptions = 0;
  globalThis.chrome ??= {};
  chrome.runtime = {
    id: 'alignread-test', getManifest: () => ({ version }), sendMessage: request,
    async openOptionsPage() { globalThis.openedOptions += 1; }
  };
  chrome.tabs = { async query() { return [{ id: tabId }]; } };
  chrome.permissions = { request: ({ origins }) => request({ type: 'mock-permission', origins }) };
  globalThis.completeRequest = (id, result) => {
    const resolve = requests.get(id);
    requests.delete(id);
    resolve(result);
  };
  globalThis.fill = (node, value, event = 'input') => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value').set.call(node, value);
    node.dispatchEvent(new Event(event, { bubbles: true }));
  };
}

module.exports = { initBrowser };
