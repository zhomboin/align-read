const assert = require('node:assert/strict');

function event() {
  const listeners = new Set();
  return {
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    emit: (...args) => Promise.all([...listeners].map(fn => fn(...args))),
  };
}

async function checkPdfWorker({ chrome, origin, id, sample, calls, grants, googleOrigin, local }) {
  const options = { source: 'en', target: 'zh-CN', range: 'main' };
  const message = { id: 'pdf-page', provider: 'google', hostname: 'paper.example.test', options, items: [{ id: 'one', text: sample }] };
  function open(url) {
    const replies = [];
    const port = {
      name: 'pdf-translation', sender: { id, url }, onMessage: event(), onDisconnect: event(), closed: false,
      postMessage(reply) { replies.push(reply); },
      disconnect() { this.closed = true; this.onDisconnect.emit(); }
    };
    chrome.runtime.onConnect.emit(port);
    return { port, send: async m => { await port.onMessage.emit(m); return replies.shift(); } };
  }
  const before = calls.length;
  const fake = open('https://paper.example.test/pdf.html');
  assert.equal(await fake.send(message), undefined);
  const { port, send } = open(origin + '/pdf.html#19');
  assert.equal((await send({ ...message, items: [] })).error, 'invalid-response');
  assert.equal((await send({ ...message, provider: 'youdao' })).error, 'provider-changed');
  local.providerSettings.disabledSites = ['example.test'];
  assert.equal((await send(message)).error, 'site-disabled');
  delete local.providerSettings.disabledSites;
  grants.delete(googleOrigin);
  assert.equal((await send(message)).error, 'consent-required');
  grants.add(googleOrigin);
  assert.equal(calls.length, before);
  const result = await send(message);
  assert(result.ok && result.value.items[0].text === '你好，世界！');
  await chrome.storage.onChanged.emit({ providerSettings: { newValue: { ...local.providerSettings, dualComments: true, disabledSites: [] } } }, 'local');
  assert.equal(port.closed, false);
  await chrome.storage.onChanged.emit({ providerSettings: { newValue: { ...local.providerSettings, disabledSites: ['example.test'] } } }, 'local');
  assert.equal(port.closed, true);
  calls.splice(before);
  console.log('PDF Worker checked the viewer, configuration, site rules, provider permission and revocation.');
}
module.exports = { event, checkPdfWorker };
