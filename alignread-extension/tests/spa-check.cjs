const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout: wait} = require('node:timers/promises');

const spaFixturePath = '/spa-fixture.html';
const heldText = 'In-flight text from previous route';
const queryHeldText = 'In-flight text before query change';
const overviewPendingText = 'In-flight overview paragraph';
const persistentPendingText = 'In-flight paragraph shared by both panels';

async function checkSpaBrowser({page, evaluate, until, build}) {
  const fixtureUrl = 'http://alignread.test' + spaFixturePath;
  await page('Page.navigate', {url: fixtureUrl});
  await until(() => evaluate(`location.href === ${JSON.stringify(fixtureUrl)} && !!document.querySelector('#anchor')`));
  await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await evaluate(`(${initSpaReader})(${JSON.stringify([heldText, queryHeldText, overviewPendingText])})`);
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
  const findBatch = (text) => until(() => evaluate(`spaBatches.find(({items}) => items.some(({text}) => text === ${JSON.stringify(text)}))`));
  const cancelled = (batchId) => until(() => evaluate(`spaCancelled.includes(${JSON.stringify(batchId)})`));
  const release = (batchId) => evaluate(`spaReleaseBatches.get(${JSON.stringify(batchId)})()`);
  const assertSameSplit = async () => assert(await evaluate(`spaPane.host === originalSpaHost && originalSpaHost.isConnected &&
    document.body.getBoundingClientRect().width < innerWidth - 1`));
  const start = (range, pageUrl) => evaluate(`readerCommand({type:'reader:start',session:{id:'spa',source:'en',target:'zh-CN',
    range:${JSON.stringify(range)},pageUrl:${JSON.stringify(pageUrl)},ratio:.5,highlight:true,syncScroll:true,cache:false}})`);
  assert.deepEqual(await start('main', fixtureUrl + '?previous'), {ok: false, error: 'stale'});
  assert((await start('main', fixtureUrl)).ok);
  await ready();
  assert(await translated('Unchanged introduction'));
  assert(await translated('Overview tab content'));
  await evaluate('globalThis.originalSpaHost = spaPane.host');
  await clearMessages();
  await evaluate(`document.querySelector('a[href="#overview"]').click()`);
  await until(() => evaluate(`location.hash === '#overview'`));
  await evaluate(`{
    const learn = document.querySelector('a[href="#learn"]');
    learn.addEventListener('click', () => {
      originalSpaHost.remove();
      document.adoptedStyleSheets = [];
    }, {once: true});
    learn.click();
  }`);
  await until(() => evaluate(`location.hash === '#learn'`));
  await until(() => translated('Learn tab guide'));
  await ready();
  await assertSameSplit();
  assert(await evaluate('document.adoptedStyleSheets.length > 0'));
  assert(await translated('Unchanged introduction'));
  assert.equal(await translated('Overview tab content'), false);
  assert.deepEqual((await messages()).sort(), ['Learn tab guide', 'Learning resources']);
  const learnSource = await evaluate(`{
    spaPane.querySelector('article li [data-reader-block], article li[data-reader-block]').click();
    CSS.highlights.get('alignread-paragraph')?.values().next().value?.startContainer.parentElement.id;
  }`);
  assert.equal(learnSource, 'learn-guide');

  await evaluate(`document.querySelector('a[href="#overview"]').click()`);
  await until(() => translated('Overview tab content'));
  await ready();
  await clearMessages();
  await evaluate(`{
    document.querySelector('#anchor').insertAdjacentHTML('afterend', '<p id="pending-common">${persistentPendingText}</p>');
    document.querySelector('#overview').insertAdjacentHTML('beforeend', '<p id="pending-overview">${overviewPendingText}</p>');
  }`);
  const oldOverviewBatch = await findBatch(overviewPendingText);
  assert.deepEqual(oldOverviewBatch.items.map(({text}) => text).sort(), [overviewPendingText, persistentPendingText].sort());
  await clearMessages();
  await evaluate(`document.querySelector('a[href="#learn"]').click()`);
  await cancelled(oldOverviewBatch.batchId);
  await until(() => translated('Learn tab guide'));
  await ready();
  await assertSameSplit();
  assert(await translated(persistentPendingText));
  assert.deepEqual((await messages()).sort(), ['Learn tab guide', 'Learning resources', persistentPendingText].sort());
  await release(oldOverviewBatch.batchId);
  await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
  assert.equal(await evaluate(`spaPane.querySelector('article').textContent.includes('过期 ')`), false);
  assert(await translated(persistentPendingText));
  assert(await translated('Learn tab guide'));
  await evaluate(`{
    document.querySelector('#pending-overview').remove();
    document.querySelector('#pending-common').remove();
  }`);
  await until(async () => !(await translated(persistentPendingText)));

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
  await evaluate(`document.querySelector('a[href="#css-target"]').click()`);
  await until(() => translated('Content revealed by the hash target'));
  await ready();
  await assertSameSplit();
  assert.deepEqual(await messages(), ['Content revealed by the hash target']);
  await clearMessages();
  await evaluate(`document.querySelector('a[href="#anchor"]').click()`);
  await until(() => evaluate(`location.hash === '#anchor'`));
  await until(async () => !(await translated('Content revealed by the hash target')));
  assert(await translated('Unchanged introduction'));
  assert.deepEqual(await messages(), []);
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>${heldText}</p>')`);
  const oldBatch = await findBatch(heldText);
  assert.equal(new URL(oldBatch.pageUrl).pathname, spaFixturePath);
  await evaluate(`history.pushState(null, '', '/spa-next')`);
  await until(async () => !(await translated('Unchanged introduction')));
  await cancelled(oldBatch.batchId);
  await evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Loading next chapter</p>')`);
  await until(() => translated('Loading next chapter'));
  assert.deepEqual((await messages()).sort(), [heldText, 'Loading next chapter'].sort());
  await evaluate(`document.querySelector('main').outerHTML = '<div id="view"><h1>New route article</h1><p>New route paragraph</p></div>'`);
  await until(() => translated('New route paragraph'));
  await ready();
  assert.equal(await evaluate(`new URL(spaBatches.at(-1).pageUrl).pathname`), '/spa-next');
  await release(oldBatch.batchId);
  assert.equal(await translated(heldText), false);
  assert(await translated('New route paragraph'));
  assert.deepEqual((await messages()).sort(), [heldText, 'Loading next chapter', 'New route article', 'New route paragraph'].sort());

  await clearMessages();
  await command('pause');
  await evaluate(`{
    history.replaceState(null, '', '#/chapter');
    document.querySelector('#view').innerHTML = '<p>Hash route article</p>' +
      '<p id="query-extra">Paragraph filtered by query</p><p id="query-retained">Retained query item</p>' +
      '<p><a href="#anchor">Inline navigation link</a></p>';
  }`);
  await until(() => evaluate(`spaPane.querySelector('article')?.textContent.includes('Hash route article')`));
  assert.equal((await command('state')).status, 'paused');
  assert.deepEqual(await messages(), []);
  await command('resume');
  await until(() => translated('Hash route article'));
  await ready();
  assert.equal(await translated('New route paragraph'), false);
  assert.equal(await evaluate(`new URL(spaBatches.at(-1).pageUrl).hash`), '#/chapter');

  await clearMessages();
  await evaluate(`history.replaceState(null, '', '?sort=recent#/chapter')`);
  await wait(250);
  await assertSameSplit();
  assert(await translated('Hash route article'));
  assert.equal((await command('state')).status, 'ready');
  assert.deepEqual(await messages(), []);

  await evaluate(`{
    history.replaceState(null, '', '?filter=guide#/chapter');
    document.querySelector('#view').prepend(document.querySelector('#query-retained'));
    document.querySelector('#query-extra').remove();
  }`);
  await until(() => evaluate(`spaPane.querySelector('article [data-reader-block]')?.textContent === '译 Retained query item'`));
  await ready();
  await assertSameSplit();
  assert.equal(await translated('Paragraph filtered by query'), false);
  assert(await translated('Hash route article'));
  assert(await translated('Inline navigation link'));
  assert.equal(await evaluate(`new URL(spaPane.querySelector('article a[href$="#anchor"]').href).search`), '?filter=guide');
  assert.deepEqual(await messages(), []);

  await evaluate(`document.querySelector('#view').insertAdjacentHTML('beforeend', '<p>${queryHeldText}</p>')`);
  const oldQueryBatch = await findBatch(queryHeldText);
  assert.equal(new URL(oldQueryBatch.pageUrl).search, '?filter=guide');
  await clearMessages();
  await evaluate(`{
    history.replaceState(null, '', '?filter=reference#/chapter');
    document.querySelector('#view').insertAdjacentHTML('beforeend', '<p>New paragraph after query change</p>');
  }`);
  await cancelled(oldQueryBatch.batchId);
  await until(() => translated('New paragraph after query change'));
  await ready();
  await release(oldQueryBatch.batchId);
  await assertSameSplit();
  assert(await translated('Retained query item'));
  assert(await translated(queryHeldText));
  assert.deepEqual((await messages()).sort(), [queryHeldText, 'New paragraph after query change'].sort());
  assert(await evaluate(`spaBatches.every(({pageUrl}) => new URL(pageUrl).search === '?filter=reference')`));

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
  await wait(300);
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
  await evaluate('globalThis.originalSpaHost = spaPane.host');
  await clearMessages();
  await evaluate(`document.body.replaceWith(Object.assign(document.createElement('body'), {textContent: 'Replacement body'}));`);
  await until(() => translated('Replacement body'));
  await ready();
  await assertSameSplit();
  assert.equal(await translated('Safe article before replacing the body'), false);
  assert.deepEqual(await messages(), ['Replacement body']);
  await command('stop');
  assert.equal(await command('state'), null);
  assert.equal(await evaluate(`document.querySelectorAll('[data-alignread-host]').length`), 0);
  assert.equal(await evaluate('document.adoptedStyleSheets.length'), 0);
  assert(await evaluate(`getComputedStyle(document.body).position === 'static' &&
    document.body.getBoundingClientRect().width > innerWidth * .9`));
  console.log('SPA reader retained unchanged translations, updated live content and alignment, rejected late batches, and cleaned up.');
}

function initSpaReader(heldTexts) {
  const held = new Set(heldTexts);
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const shadow = nativeAttachShadow.call(this, options);
    if (this.hasAttribute('data-alignread-host')) globalThis.spaPane = shadow;
    return shadow;
  };
  globalThis.spaBatches = [];
  globalThis.spaCancelled = [];
  globalThis.spaReleaseBatches = new Map();
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
      const delayed = message.items.some(({text}) => held.delete(text));
      if (delayed) await new Promise(resolve => spaReleaseBatches.set(message.batchId, resolve));
      const prefix = delayed ? '过期 ' : '译 ';
      return {ok: true, value: {id: message.batchId, items: message.items.map(({id, text}) => ({id, text: prefix + text}))}};
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
