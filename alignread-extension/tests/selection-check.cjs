const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkSelectionWorker({dispatch, request, saveYoudao, session, tabs, grants, calls, youdaoOrigin, until}) {
  const tabId = 17;
  const documentId = 'selection-doc';
  const tab = {url: 'https://selection.example.test/guide', documentId};
  tabs.set(tabId, tab);
  const popup = (type, details) => request({type, tabId, ...details}, 'popup');
  const options = {provider: 'youdao', options: {source: 'en', target: 'zh-CN', range: 'visible'}};
  const start = (confirmSensitive = false) => popup('selection-start', {...options, confirmSensitive});
  const sender = () => ({tab: {id: tabId}, frameId: 0, documentId, url: tab.url});
  const send = (type, message, from = sender()) => dispatch({type, ...message}, from);
  const pageState = async () => (await popup('page')).value;

  await saveYoudao({appKey: 'selection-test-id', appSecret: 'selection-test-secret'}, false);
  await request({type: 'select-provider', provider: 'youdao'});
  const initialCalls = calls.length;
  assert.deepEqual(await start(), {ok: false, error: 'consent-required'});
  await saveYoudao(undefined, true);
  assert.deepEqual(await start(), {ok: false, error: 'consent-required'});
  grants.add(youdaoOrigin);

  tab.url = 'https://selection.example.test/login';
  assert.deepEqual(await start(), {ok: false, error: 'sensitive-site'});
  assert((await start(true)).ok);
  assert.equal((await pageState()).selectionEnabled, true);
  tab.url = 'https://selection.example.test/guide';
  assert.equal((await pageState()).selectionEnabled, false);
  assert((await start()).ok);
  assert((await popup('start', options)).ok);
  assert.equal(calls.length, initialCalls);
  const sessionId = session[`selection:${tabId}`].session.id;
  const item = {sessionId, requestId: 'selected-item', text: '  Selected words only  '};
  const translate = (changes, from) => send('selection:translate', {...item, ...changes}, from);
  for (const from of [
    {...sender(), documentId: 'other-doc'}, {...sender(), frameId: 1},
    {...sender(), tab: {id: tabId + 1}}, {...sender(), url: 'https://selection.example.test/login'},
  ]) assert.equal((await translate({}, from))?.ok, from.frameId === 1 ? undefined : false);
  for (const text of ['', ' '.repeat(8), 'x'.repeat(1001)]) {
    assert.deepEqual(await translate({text}), {ok: false, error: 'invalid-response'});
  }
  const previousUrl = tab.url;
  tab.url = 'https://selection.example.test/login';
  assert.deepEqual(await translate({}, {...sender(), url: previousUrl}), {ok: false, error: 'stale'});
  tab.url = previousUrl;
  assert.equal(calls.length, initialCalls);

  assert.deepEqual(await translate(), {ok: true, value: 'Mock: Selected words only'});
  const sent = calls.at(-1).options;
  assert.deepEqual(sent.body.getAll('q'), ['Selected words only']);
  assert.equal(sent.body.get('from'), 'en');
  assert.equal(sent.body.get('to'), 'zh-CHS');
  assert.equal(sent.credentials, 'omit');
  assert.equal(sent.referrerPolicy, 'no-referrer');
  assert(!JSON.stringify(session).includes('Selected words only'));

  const callsBefore = calls.length;
  const pending = translate({requestId: 'pending', text: 'Pending before navigation'});
  await until(() => calls.length > callsBefore);
  assert((await send('selection:cancel', {sessionId, requestId: 'pending'})).ok);
  assert.deepEqual(await pending, {ok: false, error: 'stale'});
  assert(session[`reader:${tabId}`]);
  assert((await popup('selection-stop')).ok);
  assert.equal((await pageState()).selectionEnabled, false);
  assert.deepEqual(await translate(), {ok: false, error: 'stale'});
  assert(session[`reader:${tabId}`]);

  assert((await start()).ok);
  const preference = (await request({type: 'settings'})).value;
  const saveDisabled = (disabledSites) => request({type: 'save', preferences: {...preference, disabledSites}});
  assert((await saveDisabled(['selection.example.test'])).ok);
  assert.deepEqual(await start(), {ok: false, error: 'site-disabled'});
  assert.equal((await pageState()).selectionEnabled, false);
  assert((await saveDisabled([])).ok);
  assert((await start()).ok);
  await request({type: 'select-provider', provider: 'google'});
  assert.equal((await pageState()).selectionEnabled, false);
  assert.equal(session[`selection:${tabId}`], undefined);
  await request({type: 'reset'});
  tabs.delete(tabId);
  console.log('Selection Worker passed explicit authorization, sensitive and disabled pages, tab/document isolation, request shape, and cancellation.');
}

async function checkSelectionPage({page, evaluate, until, build, initReader}) {
  await page('Page.navigate', {url: 'about:blank'});
  await until(() => evaluate('location.href === "about:blank" && !!document.body'));
  await page('Emulation.setDeviceMetricsOverride', {width: 520, height: 640, deviceScaleFactor: 1, mobile: false});
  const {frameTree} = await page('Page.getFrameTree');
  await page('Page.setDocumentContent', {frameId: frameTree.frame.id, html: `
    <!DOCTYPE html><html><body><main><article>
      <h1>Reading guide</h1>
      <p id="source">A focused reader can review a build artifact without losing context.</p>
      <p id="second">Another phrase to translate independently.</p>
      <p id="empty"> &nbsp; </p>
      <p id="oversized">${'large selection '.repeat(70)}</p>
      <textarea id="private">Do not send me</textarea>
      <p id="editable" contenteditable>Editable private text</p>
      <p id="editor" class="cm-editor">Editor content</p>
      <p id="mixed">Public <span hidden>Private</span> sample</p>
    </article></main></body></html>`});
  await evaluate('(' + initReader.toString() + ')()');
  await evaluate(fs.readFileSync(path.join(build, 'reader.js'), 'utf8'));
  await evaluate('(' + initSelection.toString() + ')()');
  await evaluate(fs.readFileSync(path.join(build, 'selection.js'), 'utf8'));

  const command = (type, session) => evaluate(`selectionCommand(${JSON.stringify({type, session})})`);
  const enable = (id) => command('selection:start', {id, source: 'en', target: 'zh-CN'});
  const pick = (id, start, end) => evaluate(`pick(${JSON.stringify(id)}, ${start ?? 'undefined'}, ${end ?? 'undefined'})`);
  const visible = (className) => evaluate(`selectionShadow?.querySelector('.${className}')?.hidden === false`);
  const content = (className) => evaluate(`selectionShadow.querySelector('.${className}').textContent`);
  async function click(className) {
    const point = await evaluate(`(() => {
      const {left, top, width, height} = selectionShadow.querySelector('.${className}').getBoundingClientRect();
      return {x: left + width / 2, y: top + height / 2};
    })()`);
    await page('Input.dispatchMouseEvent', {type: 'mousePressed', button: 'left', clickCount: 1, ...point});
    await page('Input.dispatchMouseEvent', {type: 'mouseReleased', button: 'left', clickCount: 1, ...point});
  }
  async function key(key, windowsVirtualKeyCode) {
    await page('Input.dispatchKeyEvent', {type: 'keyDown', key, code: key, windowsVirtualKeyCode,
      ...(key === 'Enter' && {text: '\r', unmodifiedText: '\r'})});
    await page('Input.dispatchKeyEvent', {type: 'keyUp', key, code: key, windowsVirtualKeyCode});
  }
  const requests = () => evaluate('selectionMessages.filter(item => item.type === "selection:translate")');

  assert.equal(await command('selection:state'), null);
  await pick('source', 2, 16);
  assert.equal(await evaluate('!!document.querySelector("[data-alignread-selection]")'), false);
  assert((await enable('first')).ok);
  assert.equal(await command('selection:state'), 'first');
  await until(() => visible('trigger'));
  assert.equal((await requests()).length, 0);
  await evaluate('selectionMode = "slow"');
  await click('trigger');
  await until(() => visible('card'));
  assert.equal(await content('source'), 'focused reader');
  assert.equal(await content('status'), '正在翻译…');
  assert.equal((await requests()).at(-1).text, 'focused reader');
  assert.equal(await evaluate('getSelection().toString()'), 'focused reader');
  await evaluate('finishSelection({ok:true,value:"专注阅读者"})');
  await until(() => visible('copy'));
  assert.equal(await content('result'), '专注阅读者');
  await click('copy');
  await until(async () => (await content('status')) === '已复制');
  assert.equal(await evaluate('copiedSelection'), '专注阅读者');
  assert.equal(await evaluate('getSelection().toString()'), 'focused reader');
  await key('Escape', 27);
  await until(() => visible('trigger'));
  assert.equal(await visible('card'), false);
  assert.equal(await evaluate('getSelection().toString()'), 'focused reader');

  await evaluate('selectionMode = "error"; selectionShadow.querySelector(".trigger").focus()');
  assert(await evaluate('selectionShadow.activeElement === selectionShadow.querySelector(".trigger")'));
  await key('Enter', 13);
  await until(() => visible('retry'));
  assert((await content('status')).includes('无法连接'));
  await evaluate('selectionMode = "success"');
  await click('retry');
  await until(() => visible('copy'));
  assert.equal(await content('result'), '译 focused reader');
  await page('Input.dispatchMouseEvent', {type: 'mousePressed', x: 505, y: 620, button: 'left', clickCount: 1});
  await page('Input.dispatchMouseEvent', {type: 'mouseReleased', x: 505, y: 620, button: 'left', clickCount: 1});
  await until(async () => !(await visible('card')));

  await pick('source');
  await until(() => visible('trigger'));
  await evaluate('selectionMode = "slow"');
  await click('trigger');
  await until(() => visible('card'));
  const pendingId = (await requests()).at(-1).requestId;
  await pick('second');
  await until(() => visible('trigger'));
  assert(await evaluate(`selectionMessages.some(item => item.type === 'selection:cancel' && item.requestId === ${JSON.stringify(pendingId)})`));
  await evaluate('finishSelection({ok:true,value:"旧译文"}); selectionMode = "success"');
  await click('trigger');
  await until(() => visible('copy'));
  assert.equal(await content('result'), '译 Another phrase to translate independently.');

  const beforeExcluded = (await requests()).length;
  for (const id of ['editable', 'editor', 'mixed', 'empty']) {
    await pick(id);
    await until(async () => !(await visible('trigger')) && !(await visible('card')));
  }
  await evaluate('document.querySelector("#private").focus(); document.querySelector("#private").select()');
  assert.equal(await visible('trigger'), false);
  await evaluate('document.querySelector("#private").blur()');
  await pick('oversized');
  await until(() => visible('trigger'));
  await click('trigger');
  assert((await content('status')).includes('选区过长'));
  assert.equal((await requests()).length, beforeExcluded);

  await page('Emulation.setDeviceMetricsOverride', {width: 1280, height: 800, deviceScaleFactor: 1, mobile: false});
  const reader = await evaluate(`readerCommand({type:'reader:start',session:{id:'dual',source:'en',target:'zh-CN',range:'main',
    ratio:0.5,syncScroll:true,highlight:true,cache:true}})`);
  assert(reader.ok);
  await until(() => evaluate('readerCommand({type:"reader:state"}).then(state => state?.status === "ready")'));
  await pick('source', 2, 16);
  await until(() => visible('trigger'));
  await click('trigger');
  await until(() => visible('copy'));
  assert.equal(await content('result'), '译 focused reader');
  assert.equal(await evaluate('getSelection().toString()'), 'focused reader');
  await evaluate('readerCommand({type:"reader:stop"})');
  assert.equal(await command('selection:state'), 'first');
  await evaluate('location.hash = "next"');
  await until(async () => (await command('selection:state')) === null);
  assert.equal(await evaluate('!!document.querySelector("[data-alignread-selection]")'), false);
  console.log('Selection UI passed AC-P1-01, preserved selections, retry/copy/close, excluded content, stale responses, and dual-pane coexistence.');
}

async function checkSelectionPopup({page, evaluate, until, request, saveYoudao, tabs, grants, calls, youdaoOrigin, tabId}) {
  const tab = {url: 'https://selection.example.test/guide', documentId: 'popup-doc'};
  tabs.set(tabId, tab);
  await page('Page.navigate', {url: 'http://alignread.test/popup.html'});
  const button = 'document.querySelector(".selection-actions button")';
  const label = () => evaluate(button + '?.textContent.trim()');
  await until(() => evaluate('document.body?.textContent.includes("配置翻译服务")'));
  assert(await evaluate(button + '.disabled'));
  await saveYoudao({appKey: 'popup-test-id', appSecret: 'popup-test-secret'});
  await request({type: 'select-provider', provider: 'youdao'});
  grants.add(youdaoOrigin);
  await until(() => evaluate(button + '?.disabled === false'));
  assert.equal(await label(), '开启选词翻译');
  assert((await evaluate('document.getElementById(' + button + '.getAttribute("aria-describedby")).textContent')).includes('选中文字'));

  const count = calls.length;
  await evaluate(button + '.click()');
  await until(async () => (await label()) === '关闭选词翻译');
  assert(tab.selectionId);
  await page('Page.reload');
  await until(async () => (await label()) === '关闭选词翻译');
  await evaluate(button + '.click()');
  await until(async () => (await label()) === '开启选词翻译');
  assert.equal(tab.selectionId, undefined);
  assert.equal(calls.length, count);
  await request({type: 'reset'});
  tabs.delete(tabId);
  console.log('Built Popup activated and stopped selection translation independently without submitting text.');
}

function initSelection() {
  const attach = Element.prototype.attachShadow;
  window.selectionShadow = null;
  Element.prototype.attachShadow = function (options) {
    const root = attach.call(this, options);
    if (this.hasAttribute('data-alignread-selection')) window.selectionShadow = root;
    return root;
  };
  window.pick = (id, start, end) => {
    document.activeElement?.blur();
    const node = document.getElementById(id);
    const range = document.createRange();
    if (start === undefined) range.selectNodeContents(node);
    else {
      range.setStart(node.firstChild, start);
      range.setEnd(node.firstChild, end);
    }
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    async writeText(text) { window.copiedSelection = text; },
  }});
  window.selectionMessages = [];
  window.selectionMode = 'success';
  const previous = chrome.runtime;
  chrome.runtime = {...previous,
    onMessage: {addListener(listener) {
      window.selectionCommand = (message) => new Promise(resolve => listener(message, {id: previous.id}, resolve));
    }},
    async sendMessage(message) {
      if (!message.type.startsWith('selection:')) return previous.sendMessage(message);
      selectionMessages.push(message);
      if (message.type !== 'selection:translate') return {ok: true};
      if (selectionMode === 'slow') return new Promise(resolve => { window.finishSelection = resolve; });
      if (selectionMode === 'error') return {ok: false, error: 'network'};
      return {ok: true, value: '译 ' + message.text};
    },
  };
}

module.exports = {checkSelectionPage, checkSelectionPopup, checkSelectionWorker};
