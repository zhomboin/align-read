const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const replacementFixturePath = '/replacement-fixture.html';
const failedText = 'Failed fragment';
const heldEdit = 'Pending altered phrase';
const heldRoute = 'Pending route phrase';
const heldStop = 'Pending stopped phrase';
const reactiveOriginal = 'Reactive site phrase';
const reactiveUpdate = 'Updated reactive site phrase';
const arrowRight = {key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39};

async function checkReplacementPopup({page, evaluate, until, request, dispatch, saveYoudao, tabs, grants, session, calls, youdaoOrigin, tabId}) {
  const tab = {url: 'https://example.test/guide', documentId: 'replacement-popup'};
  tabs.set(tabId, tab);
  assert((await saveYoudao({appKey: 'test-app', appSecret: 'test-secret'})).ok);
  grants.add(youdaoOrigin);
  assert((await request({type: 'select-provider', provider: 'youdao'})).ok);
  await page('Emulation.setDeviceMetricsOverride', {width: 440, height: 800, deviceScaleFactor: 1, mobile: false});
  await page('Page.navigate', {url: 'http://alignread.test/popup.html'});

  const mode = '.mode-field';
  const range = '.translation-range-field';
  const checked = (field) => `document.querySelector('${field} input[type="radio"]:checked')`;
  const pick = (field, value) => evaluate(`document.querySelector('${field} input[value="${value}"]').labels[0].click()`);
  const button = (label) => `Array.from(document.querySelectorAll('button')).find(node => node.textContent === ${JSON.stringify(label)})`;
  const shown = (label) => until(() => evaluate(`!!${button(label)} && !${button(label)}.disabled`));
  const click = (label) => evaluate(`${button(label)}.click()`);

  await shown('开启双栏');
  assert.equal(await evaluate(`${checked(mode)}.value`), 'dual');
  assert.equal(await evaluate(`${checked(range)}.value`), 'visible');
  await click('开启选词翻译');
  await shown('关闭选词翻译');
  const selectionId = tab.selectionId;
  await pick(range, 'main');
  await evaluate(`${checked(mode)}.focus()`);
  await page('Input.dispatchKeyEvent', {type: 'keyDown', ...arrowRight});
  await page('Input.dispatchKeyEvent', {type: 'keyUp', ...arrowRight});
  assert(await evaluate(`${checked(mode)} === document.activeElement`));
  assert.equal(await evaluate(`${checked(mode)}.value`), 'replace');
  await click('开启原位翻译');
  await shown('恢复原文');
  assert.equal(session[`reader:${tabId}`].session.mode, 'replace');
  assert.equal(session[`reader:${tabId}`].session.range, 'main');
  assert.deepEqual(await request({type: 'start', tabId, provider: 'youdao', mode: 'invalid',
    options: {source: 'en', target: 'zh-CN', range: 'main'}}, 'popup'), {ok: false, error: 'unavailable'});
  assert.equal(session[`reader:${tabId}`].session.mode, 'replace');
  tab.readerState = {mode: 'replace', status: 'partial', total: 2, done: 1, failed: 1};
  await page('Page.reload');
  await shown('重试失败项');
  assert.equal(await evaluate(`${checked(mode)}.value`), 'replace');
  await click('重试失败项');
  await until(() => tab.readerRetryMode === 'replace');
  await shown('重新翻译');
  assert.equal(tab.selectionId, selectionId);
  await pick(mode, 'dual');
  await click('切换为双栏');
  await shown('关闭双栏');
  assert.equal(session[`reader:${tabId}`].session.mode, 'dual');
  assert.equal(tab.selectionId, selectionId);
  await pick(mode, 'replace');
  await click('切换为原位翻译');
  await shown('恢复原文');
  await click('恢复原文');
  await shown('开启原位翻译');
  assert.equal(session[`reader:${tabId}`], undefined);
  assert.equal(tab.selectionId, selectionId);
  await checkModeSwitchWorker({dispatch, request, session, tabId, tab, calls, until});
  assert.equal(tab.selectionId, selectionId);
  await request({type: 'reset'});
  tabs.delete(tabId);
  console.log('Built Popup switched range and mode with labels and the keyboard, retried, and restored independently of selection.');
}

async function checkModeSwitchWorker({dispatch, request, session, tabId, tab, calls, until}) {
  const key = `reader:${tabId}`;
  assert((await request({type: 'start', tabId, provider: 'youdao', mode: 'dual',
    options: {source: 'en', target: 'zh-CN', range: 'main'}}, 'popup')).ok);
  const previous = session[key];
  const sender = {tab: {id: tabId}, frameId: 0, documentId: tab.documentId};
  const changeMode = (overrides = {}, source = {}) => dispatch({
    type: 'switch-mode', sessionId: previous.session.id, mode: 'replace', pageUrl: tab.url, ...overrides,
  }, {...sender, url: tab.url, ...source});

  assert.equal(await changeMode({}, {frameId: 1}), undefined);
  assert.deepEqual(await changeMode({}, {documentId: 'other-document'}), {ok: false, error: 'stale'});
  assert.deepEqual(await changeMode({sessionId: 'old-session'}), {ok: false, error: 'stale'});
  tab.url = 'https://example.test/signin';
  assert.deepEqual(await changeMode(), {ok: false, error: 'sensitive-site'});
  assert.deepEqual(session[key], previous);

  tab.url = 'https://example.test/guide/new';
  assert.deepEqual(await changeMode({pageUrl: previous.pageUrl}), {ok: false, error: 'stale'});
  const beforeBatch = calls.length;
  const pendingBatch = dispatch({
    type: 'batch', sessionId: previous.session.id,
    pageUrl: tab.url, batchId: 'mode-pending', items: [{id: 'source', text: 'Pending before navigation'}],
  }, {...sender, url: tab.url});
  const pendingRequest = await until(() => calls[beforeBatch]);
  tab.layoutFailure = true;
  assert.deepEqual(await changeMode(), {ok: false, error: 'layout-start'});
  tab.layoutFailure = false;
  assert.deepEqual(session[key], previous);
  assert.equal(tab.readerState.mode, 'dual');
  assert.equal(pendingRequest.options.signal.aborted, false);

  const switched = await changeMode();
  assert(switched.ok && switched.value.mode === 'replace');
  assert.equal(pendingRequest.options.signal.aborted, true);
  assert.deepEqual(await pendingBatch, {ok: false, error: 'stale'});
  const current = session[key];
  assert.notEqual(current.session.id, previous.session.id);
  assert.equal(tab.readerSessionId, current.session.id);
  assert.deepEqual(current, {...previous, session: {
    ...previous.session, id: current.session.id, mode: 'replace', pageUrl: tab.url,
  }});
  assert.deepEqual(await changeMode(), {ok: false, error: 'stale'});
  assert.deepEqual(await dispatch({type: 'closed', sessionId: previous.session.id}, {...sender, url: tab.url}),
    {ok: false, error: 'stale'});
  assert.deepEqual(session[key], current);
  console.log('Reader mode switch kept provider, choices and authorization, rejected stale routes, and retained the active grant on failure.');
}

async function checkReplacementBrowser({page, evaluate, until, build}) {
  const fixtureUrl = 'http://alignread.test' + replacementFixturePath;
  const resize = (width) => page('Emulation.setDeviceMetricsOverride', {width, height: 850, deviceScaleFactor: 1, mobile: false});
  await page('Page.navigate', {url: fixtureUrl});
  await until(() => evaluate(`location.href === ${JSON.stringify(fixtureUrl)} && !!document.getElementById('mixed')`));
  await resize(680);
  await evaluate(`(${initReplacement})(${JSON.stringify(failedText)})`);
  await evaluate(fs.readFileSync(path.join(build, 'reader.js'), 'utf8'));

  const command = (type) => evaluate(`readerCommand({type:'reader:${type}'})`);
  const start = (mode) => evaluate(`readerCommand({type:'reader:start',session:{id:'replacement-${mode}',mode:'${mode}',
    source:'en',target:'zh-CN',range:'main',pageUrl:location.href,ratio:.5,highlight:true,syncScroll:true,cache:false}})`);
  const content = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const state = (status, mode = 'replace') => until(async () => {
    const current = await command('state');
    if (current?.status === 'error') throw new Error(JSON.stringify(current));
    return current?.mode === mode && current.status === status && current;
  });
  const messages = () => evaluate('replacementBatches.flatMap(({items}) => items.map(({text}) => text))');
  const batchFor = (text) => until(() => evaluate(`replacementBatches.find(({items}) => items.some(item => item.text === ${JSON.stringify(text)}))`));
  const hold = (text) => evaluate(`void replacementHeld.add(${JSON.stringify(text)})`);
  const release = (batchId) => evaluate(`replacementRelease.get(${JSON.stringify(batchId)})()`);
  const setParagraph = (id, value) => evaluate(`document.getElementById(${JSON.stringify(id)}).firstChild.data = ${JSON.stringify(value)}`);
  const appendParagraph = (id, value) => evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend',
    ${JSON.stringify(`<p id="${id}">${value}</p>`)})`);
  const picker = (mode) => `readerControl('.reader-mode-field input[value="${mode}"]')`;
  const switchMode = (mode) => evaluate(`${picker(mode)}.labels[0].click()`);
  const assertModeControls = async (mode) => {
    const variant = mode === 'replace' ? '.replacement-controls' : '.toolbar';
    assert(await evaluate(`readerShadows().length === 1 && !!readerControl('${variant} .reader-mode-field input:checked[value="${mode}"]')`));
  };
  const assertOriginalLayout = async () => assert(await evaluate(`
    getComputedStyle(document.body).position === 'static' && document.body.getBoundingClientRect().width > innerWidth * .9 &&
    document.adoptedStyleSheets.length === 0 && !readerControl('.toolbar')`));

  assert((await start('replace')).ok);
  const partial = await state('partial');
  assert.equal(partial.failed, 1);
  await assertOriginalLayout();
  await assertModeControls('replace');
  await switchMode('dual');
  await until(() => evaluate(`readerControl('.mode-switch-error[role=status]')?.textContent.includes('960')`));
  assert.equal((await command('state')).mode, 'replace');
  assert.equal(await evaluate('replacementSwitches.length'), 0);
  await assertModeControls('replace');
  assert.equal(await content('#mixed'), '  译 Read 译 the guide 译 with 译 care 译 and loadItem("Inline code example").  ');
  assert.equal(await content('#semantic-code'), 'const label = "Semantic code example";\n    report(label);');
  assert.equal(await content('#rendered-code'), 'def print_sample():\n    return "Rendered code example"');
  assert.deepEqual(await evaluate('[...document.querySelector("#role-code").children].map(line => line.textContent)'),
    ['if ready:', '    log("Role code example")']);
  assert.equal(await content('#partial'), 'Partial heading Failed fragment');
  assert.equal(await content('#adjacent'), '译 First phrase 译 Second phrase');
  assert(await evaluate('checkOriginalNodes()'));
  await evaluate(`document.querySelector('#mixed a').click()`);
  assert.equal(await evaluate('referenceClicks'), 1);
  assert.equal(await evaluate(`document.querySelector('#mixed a').getAttribute('href')`), '#anchor');
  assert.equal(await evaluate(`document.querySelector('input').value`), 'Input value');
  const initial = await messages();
  assert.deepEqual(initial.sort(), ['Read', 'the guide', 'with', 'care', 'and', 'First phrase', 'Second phrase',
    'Original site paragraph', 'Site controlled phrase', 'Partial heading', failedText].sort());

  await command('retry');
  await state('ready');
  assert.equal(await content('#partial'), '译 Partial heading 译 Failed fragment');
  assert.equal((await messages()).filter(text => text === failedText).length, 2);
  await evaluate('replacementBatches.length = 0');
  await hold(heldEdit);
  await setParagraph('anchor', heldEdit);
  const oldEdit = await batchFor(heldEdit);
  await setParagraph('anchor', 'Fresh site value');
  await until(async () => (await content('#anchor')) === '译 Fresh site value');
  await release(oldEdit.batchId);
  await state('ready');
  assert.equal(await content('#anchor'), '译 Fresh site value');
  assert.deepEqual(await messages(), [heldEdit, 'Fresh site value']);

  await evaluate(`(${initReactiveSiteParagraph})(${JSON.stringify(reactiveOriginal)})`);
  await until(() => evaluate('siteWriteUndos >= 1'));
  await state('ready');
  assert.equal(await content('#site-reactive'), reactiveOriginal);
  await evaluate(`updateReactiveSiteText(${JSON.stringify(reactiveUpdate)})`);
  await until(() => evaluate('siteWriteUndos >= 2'));
  await state('ready');
  assert.equal(await content('#site-reactive'), reactiveUpdate);

  await hold(heldStop);
  await appendParagraph('stop-pending', heldStop);
  const oldStop = await batchFor(heldStop);
  await evaluate(`{
    document.getElementById('site-owned').firstChild.data = 'Site latest value';
    [...readerControl('.replacement-controls').querySelectorAll('button')]
      .find(button => button.textContent === '恢复原文').click();
  }`);
  await release(oldStop.batchId);
  assert.equal(await command('state'), null);
  assert.equal(await evaluate('readerShadows().length'), 0);
  assert.equal(await content('#anchor'), 'Fresh site value');
  assert.equal(await content('#site-owned'), 'Site latest value');
  assert.equal(await content('#stop-pending'), heldStop);
  assert(await evaluate('checkOriginalNodes() && checkOriginalText()'));
  assert.equal(await evaluate('siteWriteUndos'), 2);
  assert.deepEqual((await messages()).filter(text => text === reactiveOriginal || text === reactiveUpdate),
    [reactiveOriginal, reactiveUpdate]);
  await evaluate(`document.getElementById('stop-pending').remove(); disposeReactiveSiteParagraph()`);

  await resize(1280);
  assert((await start('replace')).ok);
  await state('ready');
  await assertModeControls('replace');
  await switchMode('dual');
  await state('ready', 'dual');
  await assertModeControls('dual');
  assert(await evaluate('checkOriginalNodes() && checkOriginalText()'));
  assert(await evaluate(`readerShadows()[0].activeElement === ${picker('dual')}`));
  await page('Input.dispatchKeyEvent', {type: 'keyDown', ...arrowRight});
  await page('Input.dispatchKeyEvent', {type: 'keyUp', ...arrowRight});
  await state('ready');
  await assertModeControls('replace');
  assert(await evaluate(`readerShadows()[0].activeElement === ${picker('replace')}`));
  await assertOriginalLayout();
  assert.equal(await content('#mixed'), '  译 Read 译 the guide 译 with 译 care 译 and loadItem("Inline code example").  ');
  const switches = await evaluate('replacementSwitches');
  assert.deepEqual(switches.map(({mode, pageUrl}) => ({mode, pageUrl})),
    ['dual', 'replace'].map(mode => ({mode, pageUrl: fixtureUrl})));
  assert.notEqual(switches[0].sessionId, switches[1].sessionId);

  await hold(heldRoute);
  await appendParagraph('route-pending', heldRoute);
  const oldRoute = await batchFor(heldRoute);
  await evaluate(`history.pushState(null, '', '/replacement-next');
    document.querySelector('main').insertAdjacentHTML('beforeend', '<p id="next-page">Next page phrase</p>')`);
  await until(async () => (await content('#next-page')) === '译 Next page phrase');
  await until(() => evaluate(`replacementCancelled.includes(${JSON.stringify(oldRoute.batchId)})`));
  await release(oldRoute.batchId);
  await state('ready');
  assert.equal(await content('#route-pending'), heldRoute);
  assert.equal(await content('#anchor'), 'Fresh site value');
  assert(await evaluate('checkOriginalText()'));
  await evaluate(`history.pushState(null, '', '/signin')`);
  await until(async () => (await command('state'))?.error === 'sensitive-site');
  assert.equal(await content('#next-page'), 'Next page phrase');
  await assertOriginalLayout();
  assert.equal(await evaluate('readerShadows().length'), 0);
  await require('./paper-check.cjs').checkPaper({evaluate, until, mode:'replace', readerState:() => command('state'),
    replaceFixture: html => evaluate('document.body.innerHTML = ' + JSON.stringify(html))});
  console.log('Built reader switched modes on-page, preserved nodes and layout, restored originals, and isolated late responses.');
}

function initReactiveSiteParagraph(original) {
  const paragraph = document.createElement('p');
  paragraph.id = 'site-reactive';
  const node = document.createTextNode(original);
  paragraph.append(node);
  globalThis.siteWriteUndos = 0;
  let source = original;
  const observer = new MutationObserver(() => {
    if (node.data === source) return;
    siteWriteUndos++;
    node.data = source;
  });
  observer.observe(node, {characterData: true});
  document.querySelector('main').append(paragraph);
  globalThis.updateReactiveSiteText = (text) => { source = text; node.data = text; };
  globalThis.disposeReactiveSiteParagraph = () => { observer.disconnect(); paragraph.remove(); };
}

function initReplacement(failedText) {
  const shadows = new Set();
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const shadow = attachShadow.call(this, options);
    shadows.add(shadow);
    return shadow;
  };
  globalThis.readerShadows = () => [...shadows].filter(({host}) => host.isConnected && host.hasAttribute('data-alignread-host'));
  globalThis.readerControl = (selector) => readerShadows().map(root => root.querySelector(selector)).find(Boolean);
  const adjacent = document.querySelector('#adjacent');
  adjacent.append(document.createTextNode('First phrase'), document.createTextNode(' Second phrase'));
  const mixed = document.querySelector('#mixed');
  const tracked = [mixed, ...mixed.children, adjacent,
    ...document.querySelectorAll('#semantic-code, #rendered-code, #role-code')];
  const children = tracked.map(element => [...element.childNodes]);
  const originals = tracked.map(element => element.textContent);
  globalThis.checkOriginalNodes = () => tracked.every((element, index) => children[index].length === element.childNodes.length &&
    children[index].every((node, position) => node === element.childNodes[position]));
  globalThis.checkOriginalText = () => tracked.every((element, index) => element.textContent === originals[index]);
  globalThis.referenceClicks = 0;
  mixed.querySelector('a').addEventListener('click', event => {
    event.preventDefault();
    referenceClicks++;
  });
  globalThis.replacementBatches = [];
  globalThis.replacementHeld = new Set();
  globalThis.replacementRelease = new Map();
  globalThis.replacementCancelled = [];
  globalThis.replacementSwitches = [];
  let session;
  let fail = true;
  chrome.runtime = {
    id: 'alignread-test',
    onMessage: {addListener(listener) {
      globalThis.readerCommand = (message) => {
        if (message.type === 'reader:start') session = message.session;
        return new Promise(resolve => listener(message, {id: 'alignread-test'}, resolve));
      };
    }},
    async sendMessage(message) {
      if (message.type === 'switch-mode') {
        replacementSwitches.push(message);
        if (message.sessionId !== session?.id || message.pageUrl !== location.href) return {ok: false, error: 'stale'};
        const next = {...session, id: 'toolbar-' + replacementSwitches.length, mode: message.mode, pageUrl: message.pageUrl};
        const result = await readerCommand({type: 'reader:switch-mode', previousSessionId: session.id, session: next});
        if (result.ok) session = next;
        return result;
      }
      if (message.type === 'cancel') replacementCancelled.push(message.batchId);
      if (message.type !== 'batch') return {ok: true};
      replacementBatches.push(message);
      const delayed = message.items.some(({text}) => replacementHeld.delete(text));
      if (delayed) await new Promise(resolve => replacementRelease.set(message.batchId, resolve));
      const items = message.items.flatMap(({id, text}) => {
        if (fail && text === failedText) { fail = false; return []; }
        return [{id, text: (delayed ? '过期 ' : '译 ') + text}];
      });
      return {ok: true, value: {id: message.batchId, items}};
    },
  };
}

module.exports = {checkReplacementBrowser, checkReplacementPopup, replacementFixturePath};
