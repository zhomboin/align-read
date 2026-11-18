const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const spaFixturePath = '/spa-fixture.html';
const heldText = 'In-flight text from previous route';

async function checkSpaBrowser({page, evaluate, until, build}) {
  const fixtureUrl = 'http://alignread.test' + spaFixturePath;
  await page('Page.navigate', {url: fixtureUrl});
  await until(() => evaluate(`location.href === ${JSON.stringify(fixtureUrl)} && !!document.querySelector('#anchor')`));
  await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await evaluate(`(${initSpaReader})(${JSON.stringify(heldText)})`);
  await evaluate(fs.readFileSync(path.join(build, 'reader.js'), 'utf8'));

  const command = (type) => evaluate(`readerCommand({type:'reader:${type}'})`);
  const translated = (text) => evaluate(`!!globalThis.spaPane?.querySelector('article')?.textContent.includes(${JSON.stringify('译 ' + text)})`);
  const ready = () => until(async () => {
    const state = await command('state');
    if (state?.status === 'error') throw new Error(JSON.stringify(state));
    return state?.status === 'ready';
  });
  const messages = () => evaluate('spaBatches.flatMap(({items}) => items.map(({text}) => text))');
  const clearMessages = () => evaluate('spaBatches.length = 0');
  const start = (range, pageUrl) => evaluate(`readerCommand({type:'reader:start',session:{id:'spa',source:'en',target:'zh-CN',
    range:${JSON.stringify(range)},pageUrl:${JSON.stringify(pageUrl)},ratio:.5,highlight:true,syncScroll:true,cache:false}})`);
  assert.deepEqual(await start('main', fixtureUrl + '?previous'), {ok: false, error: 'stale'});
  assert((await start('main', fixtureUrl)).ok);
  await ready();
  assert(await translated('Unchanged introduction'));
  await clearMessages();
  await evaluate(`{
    document.querySelector('#editable-text').firstChild.data = 'Updated paragraph';
    document.querySelector('#removed').remove();
    document.querySelector('#hidden').hidden = false;
    document.querySelector('main').insertAdjacentHTML('beforeend', '<p id="appended">Added paragraph</p>' +
      '<p hidden>Hidden update</p><form><p>Private form hint</p><input value="Private value"></form>' +
      '<div contenteditable>Private draft</div>');
  }`);
  await until(() => translated('Added paragraph'));
  await ready();
  assert.deepEqual((await messages()).sort(), ['Added paragraph', 'Revealed paragraph', 'Updated paragraph']);
  assert(await translated('Unchanged introduction'));
  assert.equal(await translated('Paragraph to remove'), false);
  assert.equal(await translated('Text before edit'), false);
  const source = await evaluate(`{
    Array.from(spaPane.querySelectorAll('[data-reader-block]')).find(element => element.textContent === '译 Added paragraph').click();
    CSS.highlights.get('alignread-paragraph')?.values().next().value?.startContainer.parentElement.id;
  }`);
  assert.equal(source, 'appended');

  await clearMessages();
  await evaluate(`document.querySelector('#css-revealed').style.setProperty('--paragraph-display', 'block')`);
  await until(() => translated('Revealed by style'));
  assert.deepEqual(await messages(), ['Revealed by style']);
  await evaluate(`document.querySelector('#css-revealed').style.removeProperty('--paragraph-display')`);
  await until(async () => !(await translated('Revealed by style')));

  await clearMessages();
  await command('pause');
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Added while paused</p>')`);
  await until(() => evaluate(`spaPane.querySelector('article')?.textContent.includes('Added while paused')`));
  assert.equal((await command('state')).status, 'paused');
  assert.deepEqual(await messages(), []);
  await command('resume');
  await until(() => translated('Added while paused'));
  await ready();
  assert.deepEqual(await messages(), ['Added while paused']);

  await clearMessages();
  await evaluate(`location.hash = '#anchor'`);
  await until(() => evaluate(`location.hash === '#anchor'`));
  assert(await translated('Unchanged introduction'));
  assert.deepEqual(await messages(), []);
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>${heldText}</p>')`);
  const oldBatch = await until(() => evaluate(`spaBatches.find(({items}) => items.some(({text}) => text === ${JSON.stringify(heldText)}))`));
  assert.equal(new URL(oldBatch.pageUrl).pathname, spaFixturePath);
  await evaluate(`history.pushState(null, '', '/spa-next')`);
  await until(async () => !(await translated('Unchanged introduction')));
  await until(() => evaluate(`spaCancelled.includes(${JSON.stringify(oldBatch.batchId)})`));
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Loading next chapter</p>')`);
  await until(() => translated('Loading next chapter'));
  assert.deepEqual((await messages()).sort(), [heldText, 'Loading next chapter'].sort());
  await evaluate(`document.querySelector('main').outerHTML = '<div id="view"><h1>New route article</h1><p>New route paragraph</p></div>'`);
  await until(() => translated('New route paragraph'));
  await ready();
  assert.equal(await evaluate(`new URL(spaBatches.at(-1).pageUrl).pathname`), '/spa-next');
  await evaluate('spaReleaseOldBatch()');
  assert.equal(await translated(heldText), false);
  assert(await translated('New route paragraph'));
  assert.deepEqual((await messages()).sort(), [heldText, 'Loading next chapter', 'New route article', 'New route paragraph'].sort());

  await clearMessages();
  await command('pause');
  await evaluate(`{
    history.replaceState(null, '', '#/chapter');
    document.querySelector('#view').innerHTML = '<p>Hash route article</p>';
  }`);
  await until(() => evaluate(`spaPane.querySelector('article')?.textContent.includes('Hash route article')`));
  assert.equal((await command('state')).status, 'paused');
  assert.deepEqual(await messages(), []);
  await command('resume');
  await until(() => translated('Hash route article'));
  await ready();
  assert.equal(await translated('New route paragraph'), false);
  assert.equal(await evaluate(`new URL(spaBatches.at(-1).pageUrl).hash`), '#/chapter');

  await evaluate('history.back()');
  await until(() => evaluate(`location.pathname === ${JSON.stringify(spaFixturePath)}`));
  await evaluate(`document.querySelector('#view').innerHTML = '<p>Restored route article</p>'`);
  await until(() => translated('Restored route article'));
  await ready();
  await command('stop');
  assert.equal(await command('state'), null);
  assert.equal(await evaluate(`document.querySelectorAll('[data-alignread-host]').length`), 0);
  assert.equal(await evaluate('document.adoptedStyleSheets.length'), 0);
  assert.equal(await evaluate(`CSS.highlights.has('alignread-paragraph')`), false);
  await clearMessages();
  await evaluate(`document.querySelector('#view').append('Edited after the reader stopped');`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(await messages(), []);

  assert((await start('visible', fixtureUrl)).ok);
  await ready();
  await clearMessages();
  await evaluate(`{
    history.pushState(null, '', '#/login');
    document.querySelector('#view').textContent = 'Sensitive route text';
  }`);
  await until(async () => (await command('state'))?.error === 'sensitive-site');
  assert.equal(await evaluate('document.adoptedStyleSheets.length'), 0);
  assert.deepEqual(await messages(), []);

  await evaluate(`history.replaceState(null, '', '/spa-fixture.html');
    document.querySelector('#view').textContent = 'Safe article before replacing the body';`);
  assert((await start('visible', fixtureUrl)).ok);
  await ready();
  await clearMessages();
  await evaluate(`document.body.replaceWith(Object.assign(document.createElement('body'), {textContent: 'Replacement body'}));`);
  await until(async () => (await command('state'))?.error === 'incompatible');
  assert.equal(await evaluate('document.adoptedStyleSheets.length'), 0);
  assert.deepEqual(await messages(), []);
  console.log('SPA reader retained unchanged translations, updated live content and alignment, rejected late batches, and cleaned up.');
}

function initSpaReader(heldText) {
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const shadow = nativeAttachShadow.call(this, options);
    if (this.hasAttribute('data-alignread-host')) globalThis.spaPane = shadow;
    return shadow;
  };
  globalThis.spaBatches = [];
  globalThis.spaCancelled = [];
  globalThis.chrome ??= {};
  chrome.runtime = {
    id: 'alignread-test',
    onMessage: {addListener(listener) {
      globalThis.readerCommand = (message) => new Promise(resolve => listener(message, {id: 'alignread-test'}, resolve));
    }},
    async sendMessage(message) {
      if (message.type === 'cancel') spaCancelled.push(message.batchId);
      if (message.type !== 'batch') return {ok: true};
      spaBatches.push(message);
      if (message.items.some(({text}) => text === heldText)) {
        await new Promise(resolve => { globalThis.spaReleaseOldBatch = resolve; });
      }
      return {ok: true, value: {id: message.batchId, items: message.items.map(({id, text}) => ({id, text: '译 ' + text}))}};
    },
  };
}

async function checkSpaWorker({dispatch, request, saveYoudao, session, tabs, grants, calls, youdaoOrigin, until}) {
  const first = 'https://docs.example.test/guide';
  const next = 'https://docs.example.test/reference?view=api';
  const tabId = 51;
  const tab = {url: first, documentId: 'spa-document'};
  tabs.set(tabId, tab);
  await saveYoudao({appKey: 'spa-app', appSecret: 'spa-secret'});
  grants.add(youdaoOrigin);
  await request({type: 'select-provider', provider: 'youdao'});
  const start = (confirmSensitive) => request({type: 'start', tabId, provider: 'youdao', confirmSensitive,
    options: {source: 'en', target: 'zh-CN', range: 'main'}}, 'popup');
  const send = (message, senderUrl = tab.url) => dispatch({...message, sessionId: session[`reader:${tabId}`].session.id},
    {tab: {id: tabId}, frameId: 0, documentId: tab.documentId, url: senderUrl});
  const batch = (batchId, pageUrl, text = 'New route request') => send({type: 'batch', batchId, pageUrl,
    items: [{id: 'first-item', text}]});

  assert((await start(false)).ok);
  tab.url = first + '#anchor';
  assert((await batch('regular-anchor', first)).ok);
  const startCallCount = calls.length;
  const old = batch('spa-old', first, 'Pending before navigation');
  await until(() => calls.length > startCallCount);
  const pending = calls.at(-1);
  tab.url = next;
  await send({type: 'cancel', batchId: 'unrelated'});
  assert.equal(pending.options.signal.aborted, false);
  await send({type: 'cancel', batchId: 'spa-old'});
  assert.equal(pending.options.signal.aborted, true);
  assert.deepEqual(await old, {ok: false, error: 'stale'});
  assert.deepEqual(await batch('previous-route', first), {ok: false, error: 'stale'});
  assert.equal(calls.length, startCallCount + 1);
  const mismatchedSender = await send({type: 'batch', batchId: 'mismatched-sender', pageUrl: next,
    items: [{id: 'first-item', text: 'Text sent from the previous route'}]}, first);
  assert.deepEqual(mismatchedSender, {ok: false, error: 'stale'});
  assert.equal(calls.length, startCallCount + 1);
  assert((await batch('current-route', next)).ok);

  const beforeSensitive = calls.length;
  tab.url = 'https://docs.example.test/signin';
  assert.equal((await batch('sensitive-path', tab.url)).ok, false);
  tab.url = 'https://docs.example.test/reference#/login';
  assert.equal((await batch('sensitive-hash', tab.url)).ok, false);
  assert.equal(calls.length, beforeSensitive);
  assert.equal((await start(false)).ok, false);
  assert((await start(true)).ok);
  assert((await batch('confirmed-sensitive', tab.url)).ok);

  const beforeCrossOrigin = calls.length;
  tab.url = 'https://other.example.test/reference';
  assert.equal((await batch('cross-origin', tab.url)).ok, false);
  assert.equal(calls.length, beforeCrossOrigin);
  await request({type: 'reset'});
  console.log('SPA Worker validated current route, cancelled the matching batch, and guarded sensitive and cross-origin routes.');
}

module.exports = {checkSpaBrowser, checkSpaWorker, spaFixturePath};
