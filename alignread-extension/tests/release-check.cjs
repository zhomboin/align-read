const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {setTimeout: wait} = require('node:timers/promises');
const {checkSelectionPage, checkSelectionPopup, checkSelectionWorker} = require('./selection-check.cjs');
const {checkSettings} = require('./settings-check.cjs');
const {aiResponse, checkAiWorker, checkNamedAiWorkers, timedStreams} = require('./ai-check.cjs');
const {checkInlineRow} = require('./inline-row-check.cjs');
const {checkHeaderLayout} = require('./header-layout-check.cjs');
const {checkRepositoryLayout} = require('./repository-layout-check.cjs');
const {checkAiPresets} = require('./ai-presets-check.cjs');
const {checkSpaBrowser, checkSpaWorker, spaFixturePath} = require('./spa-check.cjs');
const {checkReplacementBrowser, checkReplacementPopup, replacementFixturePath} = require('./replacement-check.cjs');

const selectionOnly = process.argv.includes('--selection');
const {checkPaper} = require('./paper-check.cjs');
const {checkPdfBrowser} = require('./pdf-check.cjs');
const {initBrowser} = require('./browser-bridge.cjs');
const {event, checkPdfWorker} = require('./pdf-worker-check.cjs');
const pdfOnly = process.argv.includes('--pdf');
const settingsOnly = process.argv.includes('--settings');
const layoutOnly = process.argv.includes('--layout');
const spaOnly = process.argv.includes('--spa');
const replacementOnly = process.argv.includes('--replace');
const build = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? path.resolve(__dirname, '../.output/chrome-mv3');
const manifest = JSON.parse(fs.readFileSync(path.join(build, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
assert.deepEqual(manifest.optional_host_permissions,
  ['https://translation.googleapis.com/*', 'https://openapi.youdao.com/*', 'https://*/*']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.deepEqual(manifest.options_ui, {open_in_tab: true, page: 'options.html'});
const googleOrigin = 'https://translation.googleapis.com/*';
const youdaoOrigin = 'https://openapi.youdao.com/*';
const id = 'alignread-test';
const origin = 'chrome-extension://' + id;
const sample = 'Hello, world!';
const selectionPopupTab = 18;
const local = { providerSettings: {
  source: 'auto', target: 'zh-CN', range: 'visible', provider: 'google',
  authorized: true, key: 'legacy-google-secret', youdao: null, youdaoAuthorized: false,
} };
const session = {};
const tabs = new Map();
const grants = new Set([googleOrigin]);
const calls = [];
const noopEvent = { addListener() {} };
const storage = (data) => ({
  async get(key) { return key == null ? structuredClone(data) : { [key]: structuredClone(data[key]) }; },
  async set(entries) { Object.assign(data, structuredClone(entries)); },
  async remove(key) { delete data[key]; },
});
let listener;
let permissionRemoved;
let response = 'success';
let blocked;
let permitted = false;
let heartbeats = 0;
const activeIntervals = new Set();
const streamState = () => ({heartbeats, active: activeIntervals.size});
const testDelay = (ms) => timedStreams.has(response) ? Math.ceil(ms / 100) : ms;
const setResponse = (value) => { response = value; };
function revokePermission(host) {
  if (grants.delete(host)) permissionRemoved({origins: [host]});
}
function startWorker() {
  const chrome = {
    runtime: {
      onConnect: event(),
      id, getURL: (suffix) => origin + suffix,
      onMessage: { addListener(handler) { listener = handler; } },
      async getPlatformInfo() { heartbeats++; return {}; },
    },
    storage: {
      onChanged: event(),
      local: { ...storage(local), async setAccessLevel(value) { assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'); } },
      session: storage(session),
    },
    tabs: {
      onRemoved: noopEvent,
      async query() { return []; },
      async get(id) { return tabs.get(id) ?? {url: 'https://docs.example.test/start', documentId: 'doc'}; },
      async sendMessage(id, message, target) {
        const tab = tabs.get(id);
        const kind = message.type.split(':')[0];
        if (target.documentId && target.documentId !== tab?.documentId) throw Error('Document changed');
        if (!tab?.scripts?.length) throw Error('No listener in document');
        if (!tab.scripts.includes(`/${kind}.js`)) return undefined;
        if (kind === 'selection') {
          if (message.type === 'selection:state') return tab.selectionId ?? null;
          if (message.type === 'selection:start') {
            tab.selectionId = message.session.id;
            return {ok: true, value: null};
          }
          delete tab.selectionId;
          return null;
        }
        if (message.type === 'reader:start' || message.type === 'reader:switch-mode') {
          if (message.type === 'reader:switch-mode' && tab.readerSessionId !== message.previousSessionId) {
            return {ok: false, error: 'stale'};
          }
          if (tab.layoutFailure) return {ok: false, error: 'layout-start'};
          tab.readerSessionId = message.session.id;
          tab.lastReaderCommand = message.type;
          tab.readerState = {status: 'preparing', total: 0, done: 0, failed: 0};
          if (message.session.mode) tab.readerState.mode = message.session.mode;
          return {ok: true, value: tab.readerState};
        }
        if (message.type === 'reader:stop') {
          delete tab.readerState;
          delete tab.readerSessionId;
        }
        if (message.type === 'reader:retry') tab.readerRetryMode = tab.readerState?.mode;
        return tab.readerState ?? null;
      },
    },
    permissions: {
      async contains({origins}) { return origins.every((host) => grants.has(host)); },
      async remove({origins}) { for (const host of origins) revokePermission(host); },
      onRemoved: event(),
    },
    scripting: {
      async executeScript({target, files}) {
        const tab = await chrome.tabs.get(target.tabId);
        if (tab.restricted) throw Error('scripting permission denied');
        if (files) {
          assert.deepEqual(Array.from(target.documentIds), [tab.documentId]);
          (tab.scripts ??= []).push(...files);
        }
        return [{documentId: tab.documentId, result: tab.url}];
      },
    },
  };
  const context = vm.createContext({chrome, crypto, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    AbortSignal: {any: (signals) => AbortSignal.any(signals), timeout: (ms) => AbortSignal.timeout(testDelay(ms))},
    setTimeout: (action, ms) => setTimeout(action, testDelay(ms)), clearTimeout,
    setInterval(action, ms) {
      const timer = setInterval(action, testDelay(ms)).unref();
      activeIntervals.add(timer);
      return timer;
    },
    clearInterval(timer) { activeIntervals.delete(timer); clearInterval(timer); },
    async fetch(url, options) {
      calls.push({url, options});
      if (blocked) await blocked.promise;
      if (url.endsWith('/chat/completions')) return aiResponse(options, response, url);
      if (url.includes('youdao.com')) {
        const q = options.body.get('q');
        if (q === 'Pending before navigation') {
          await new Promise((_, reject) => {
            if (options.signal.aborted) reject(options.signal.reason);
            else options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
          });
        }
        assert.equal(options.body.get('signType'), 'v3');
        assert.match(options.body.get('sign'), /^[0-9a-f]{64}$/);
        return Response.json(response === 'auth' ? {errorCode: '202'} :
          {errorCode: '0', translateResults: [{query: q, translation: response === 'empty' ? ' ' : q === sample ? '你好，世界！' : 'Mock: ' + q}]});
      }
      assert.deepEqual(JSON.parse(options.body).q, [sample]);
      assert.equal(options.headers['X-Goog-Api-Key'], 'legacy-google-secret');
      return Response.json({data: {translations: [{translatedText: '你好，世界！'}]}});
    },
  });
  permissionRemoved = chrome.permissions.onRemoved.emit;
  vm.runInContext(fs.readFileSync(path.join(build, 'background.js'), 'utf8'), context);
  return chrome;
}
function dispatch(message, sender) {
  return new Promise(resolve => {
    const pending = listener(message, {id, ...sender}, resolve);
    if (!pending) resolve(undefined);
  }).then(result => result === undefined ? undefined : JSON.parse(JSON.stringify(result)));
}
const request = (message, page = 'options') => dispatch(message, {url: origin + '/' + page + '.html'});
const settings = () => request({type: 'settings'}).then(result => result.value);
const test = (provider) => request({type: 'test-provider', provider});
const saveYoudao = (credentials, authorized = true) => request({type: 'save-youdao', credentials, authorized});
async function until(callback) {
  for (let index = 0; index < 150; index++) {
    const result = await callback();
    if (result) return result;
    await wait(30);
  }
  throw new Error('Timed out: ' + callback.toString());
}
async function checkWorker() {
  startWorker();
  let view = await settings();
  assert.deepEqual(view.providers.google, {configured: true, consent: true, hostPermission: true, lastCheck: null});
  assert(!JSON.stringify(view).includes('legacy-google-secret'));
  assert.deepEqual(await test('youdao'), {ok: false, error: 'not-configured'});
  assert.equal(calls.length, 0);
  const creds = { appKey: 'app-id-123456', appSecret: 'local-secret' };
  await saveYoudao(creds);
  view = await settings();
  assert.deepEqual(view.providers.youdao, {configured: true, consent: true, hostPermission: false, lastCheck: null, appKeySuffix: '3456'});
  assert(!JSON.stringify(view).includes(creds.appKey));
  assert(!JSON.stringify(view).includes(creds.appSecret));
  assert.equal(view.provider, 'google');
  assert.deepEqual(await test('youdao'), {ok: false, error: 'consent-required'});
  assert.equal(calls.length, 0);
  assert.deepEqual(await request({type: 'test-provider', provider: 'youdao', tabId: 9}, 'popup'),
    {ok: false, error: 'unavailable'});

  grants.add(youdaoOrigin);
  assert.equal((await test('youdao')).value.providers.youdao.lastCheck.error, undefined);
  assert.equal(calls.length, 1);
  startWorker();
  assert.equal((await settings()).providers.youdao.lastCheck.error, undefined);
  await saveYoudao(undefined);
  assert((await settings()).providers.youdao.lastCheck.checkedAt > 0);
  assert((await test('google')).value.providers.google.lastCheck.checkedAt > 0);
  await request({type: 'save', preferences: {...await settings(), target: 'en'}});
  assert.equal(local.providerSettings.authorized, true);
  response = 'auth';
  assert.equal((await test('youdao')).value.providers.youdao.lastCheck.error, 'authentication');
  assert.deepEqual(local.providerSettings.youdao, creds);
  response = 'empty';
  assert.equal((await test('youdao')).value.providers.youdao.lastCheck.error, 'invalid-response');
  response = 'success';

  const callCount = calls.length;
  let release;
  blocked = {promise: new Promise(resolve => { release = resolve; })};
  const pending = test('youdao');
  await until(() => calls.length > callCount);
  const replacement = { ...creds, appSecret: 'replacement-secret' };
  await saveYoudao(replacement);
  release();
  assert.deepEqual(await pending, {ok: false, error: 'config-changed'});
  blocked = undefined;
  assert.equal((await settings()).providers.youdao.lastCheck, null);
  assert.equal((await settings()).providers.google.lastCheck.error, undefined);
  await request({type: 'select-provider', provider: 'youdao'});
  const beforeLayout = calls.length;
  tabs.set(1, {url: 'https://docs.example.test/start', documentId: 'doc', layoutFailure: true});
  assert.deepEqual(await request({type: 'start', tabId: 1, provider: 'youdao', options: {
    source: 'auto', target: 'zh-CN', range: 'visible',
  }}, 'popup'), {ok: false, error: 'layout-start'});
  assert.deepEqual(tabs.get(1).scripts, ['/reader.js']);
  assert.equal(calls.length, beforeLayout);
  await saveYoudao(null, false);
  assert(!(await settings()).providers.youdao.configured);
  assert.equal(grants.has(youdaoOrigin), false);
  await request({type: 'reset'});
  view = await settings();
  assert(!view.providers.google.configured && !view.providers.youdao.configured);
  assert.equal(view.providers.google.lastCheck, null);
  console.log('Background migration, permissions, masking, sample requests, persisted results, rotation, and layout-before-translation checks passed.');
  const credentials = { appKey: 'fixture-app', appSecret: 'fixture-secret' };
  await saveYoudao(credentials, false);
  await request({type: 'select-provider', provider: 'youdao'});
  const start = (tabId) => request({type: 'start', tabId, provider: 'youdao', options: {
    source: 'en', target: 'zh-CN', range: 'visible',
  }}, 'popup');
  assert.deepEqual(await start(1), {ok: false, error: 'consent-required'});
  await saveYoudao(undefined, true);
  grants.add(youdaoOrigin);
  tabs.set(2, {url: 'chrome://settings', documentId: 'browser-settings'});
  tabs.set(3, {url: 'https://example.test/file.pdf', documentId: 'pdf'});
  tabs.set(4, {url: 'https://example.test/denied', documentId: 'denied', restricted: true});
  for (const tabId of [2, 3, 4]) assert.deepEqual(await start(tabId), {ok: false, error: 'unsupported-page'});
  tabs.set(5, {url: 'https://example.test/one', documentId: 'doc-a'});
  tabs.set(6, {url: 'https://example.test/two', documentId: 'doc-b'});
  assert((await start(5)).ok && (await start(6)).ok);
  const a = session['reader:5'].session.id;
  const b = session['reader:6'].session.id;
  assert.notEqual(a, b);
  const batch = (tabId, documentId, sessionId, text) => dispatch({
    type: 'batch', sessionId, batchId: 'first-batch', items: [{id: 'first-item', text}],
  }, {tab: {id: tabId}, frameId: 0, documentId});
  assert.deepEqual(await batch(5, 'doc-b', b, 'Cross-tab content'), {ok: false, error: 'stale'});

  const [first, second] = await Promise.all([batch(5, 'doc-a', a, 'First document'), batch(6, 'doc-b', b, 'Second document')]);
  assert.deepEqual(first.value.items, [{id: 'first-item', text: 'Mock: First document'}]);
  assert.deepEqual(second.value.items, [{id: 'first-item', text: 'Mock: Second document'}]);
  const beforeNavigation = calls.length;
  const oldBatch = batch(5, 'doc-a', a, 'Pending before navigation');
  await until(() => calls.length > beforeNavigation);
  const pendingRequest = calls.at(-1);
  await dispatch({type: 'closed', sessionId: a}, {tab:{id:5}, frameId:0, documentId:'doc-a'});
  assert.equal(pendingRequest.options.signal.aborted, true);
  assert.deepEqual(await oldBatch, {ok: false, error: 'stale'});
  tabs.set(5, {url: 'https://example.test/new', documentId: 'doc-a-next'});
  assert((await start(5)).ok);
  const current = session['reader:5'].session.id;
  assert.notEqual(current, a);
  assert.deepEqual(await batch(5, 'doc-a', current, 'Old document'), {ok: false, error: 'stale'});
  assert((await batch(5, 'doc-a-next', current, 'Current document')).ok);
  assert((await batch(6, 'doc-b', b, 'Second document still open')).ok);
  const resized = await dispatch({type: 'resize', sessionId: current, ratio: .4},
    {tab:{id:5}, frameId:0, documentId:'doc-a-next'});
  assert(resized.ok);
  assert.equal((await settings()).ratio, .4);
  await request({type: 'reset'});
  console.log('Worker tab/document isolation, navigation cancellation, restricted pages, unauthorized requests, and ratio persistence passed.');

}

async function checkBrowser() {
  const program = process.env.CHROMIUM_BIN ?? 'chromium';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alignread-options-'));
  const child = spawn(program, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
    '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const [, , stderr, input, output] = child.stdio;
  const pending = new Map();
  let sequence = 0, buffer = '';
  let diagnostics = '';
  let browserError, pipeError, failure;

  function fail(error) {
    if (failure) return;
    failure = error;
    for (const promise of pending.values()) promise.reject(error);
    pending.clear();
  }

  stderr.setEncoding('utf8').on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8000);
  });
  child.once('error', (error) => { browserError = error; });
  const stopped = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      const status = signal ? 'signal ' + signal : 'exit code ' + code;
      fail(new Error([
        'Chromium "' + program + '" closed (' + status + ').',
        browserError?.message, pipeError?.message, diagnostics.trim(),
        'Set CHROMIUM_BIN to a Chromium or Chrome executable for the OS running Node.js.',
      ].filter(Boolean).join('\n')));
      resolve();
    });
  });
  function recordPipeError(error) {
    pipeError ??= error;
  }
  input.on('error', recordPipeError);
  output.on('error', recordPipeError);

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    input.write(JSON.stringify({id, method, params, sessionId}) + '\0');
  });
  const watchdog = setTimeout(() => {
    browserError ??= new Error('Chromium regression timed out after 90 seconds.');
    child.kill();
  }, 90000);
  output.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const event = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const promise = pending.get(event.id);
      if (promise) {
        pending.delete(event.id);
        if (event.error) promise.reject(new Error(JSON.stringify(event.error)));
        else promise.resolve(event.result);
        continue;
      }
      void handle(event).catch(fail);
    }
  });
  async function handle({sessionId, method, params}) {
    if (method === 'Fetch.requestPaused') {
      const {pathname} = new URL(params.request.url);
      const relative = pathname === '/' ? '/options.html' : pathname;
      const fixture = pathname === spaFixturePath ? 'spa.html' : pathname === replacementFixturePath ? 'replacement.html' : null;
      const file = fixture ? path.join(__dirname, 'fixtures', fixture) : path.join(build, relative);
      const content = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
      const type = {'.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png'}[path.extname(file)];
      const contentType = type === 'image/png' ? type : (type ?? 'text/plain') + '; charset=utf-8';
      await send('Fetch.fulfillRequest', {requestId: params.requestId, responseCode: content ? 200 : 404,
        responseHeaders: [{name: 'Content-Type', value: contentType}],
        body: content?.toString('base64')}, sessionId);
    } else if (method === 'Runtime.bindingCalled') {
      const {id, message} = JSON.parse(params.payload);
      let result;
      if (message.type === 'mock-permission') {
        result = permitted;
        if (result) message.origins.forEach(host => grants.add(host));
      } else {
        const popup = ['page', 'switch-provider', 'start', 'control', 'selection-start', 'selection-stop'].includes(message.type);
        result = await request(message, popup ? 'popup' : 'options');
      }
      await send('Runtime.evaluate', {expression: 'completeRequest(' + id + ',' + JSON.stringify(result) + ')'}, sessionId);
    }
  }
  try {
    console.log((await send('Browser.getVersion')).product);
    const {targetInfos} = await send('Target.getTargets');
    const {sessionId} = await send('Target.attachToTarget', {targetId: targetInfos.find(i => i.type === 'page').targetId, flatten: true});
    const page = (method, params) => send(method, params, sessionId);
    const evaluate = async (expression) => {
      const response = await page('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Runtime.addBinding', {name: 'alignreadRequest'});
    await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${initBrowser})(${JSON.stringify(manifest.version)}, ${selectionPopupTab})`,
    });
    await page('Fetch.enable', {patterns: [{urlPattern: 'http://alignread.test/*'}]});
    async function checkReplacement() {
      await checkReplacementPopup({page, evaluate, until, request, dispatch, saveYoudao, tabs, grants, session, calls,
        youdaoOrigin, tabId: selectionPopupTab});
      await checkReplacementBrowser({page, evaluate, until, build});
    }
    if (pdfOnly) return await checkPdfBrowser({page, evaluate, until, build});
    if (replacementOnly) return await checkReplacement();
    if (spaOnly) return await checkSpaBrowser({page, evaluate, until, build});
    if (!layoutOnly) {
      if (!settingsOnly) {
        await checkSelectionPopup({page, evaluate, until, request, saveYoudao, tabs, grants, calls, youdaoOrigin, tabId: selectionPopupTab});
        await checkSelectionPage({page, evaluate, until, build, initReader});
      }
      if (selectionOnly) return;
      await checkSettings({page, evaluate, until, manifest, request, local, grants,
        setPermission: (value) => { permitted = value; }, setResponse});
      if (settingsOnly) return;
      await checkPdfBrowser({page, evaluate, until, build});
    }

    await page('Page.navigate', {url: 'about:blank'});
    await until(() => evaluate('location.href === "about:blank"'));
    const {frameTree} = await page('Page.getFrameTree');
    const fixture = fs.readFileSync(path.resolve(__dirname, 'fixtures/index.html'), 'utf8');
    await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    await page('Page.setDocumentContent', {frameId: frameTree.frame.id, html: fixture});
    await evaluate('(' + initReader.toString() + ')()');
    await evaluate(fs.readFileSync(path.join(build, 'reader.js'), 'utf8'));
    const replaceFixture = (html) => evaluate('document.documentElement.innerHTML = new DOMParser().parseFromString(' +
      JSON.stringify(html) + ', "text/html").documentElement.innerHTML');
    const readerState = () => evaluate('readerCommand({type:"reader:state"})');
    const start = (id) => evaluate('readerCommand(' + JSON.stringify({type: 'reader:start', session: {
      id, source: 'en', target: 'zh-CN', range: 'main', ratio: 0.5, highlight: true, syncScroll: true, cache: true,
    }}) + ')');
    await evaluate('document.body.style.setProperty("position", "static", "important")');
    assert((await start('blocked')).ok);
    await until(async () => (await readerState())?.error === 'layout-start');
    assert.equal(await evaluate('readerBatches'), 0);
    assert.equal(await evaluate('document.adoptedStyleSheets.length === 0'), true);
    assert.equal(await evaluate('document.body.style.getPropertyValue("position")'), 'static');
    await evaluate('document.body.style.removeProperty("position")');
    assert((await start('normal')).ok);
    await until(async () => { const state = await readerState(); if (state?.status === 'error') throw new Error(JSON.stringify(state)); return state?.status === 'ready'; });
    assert(await evaluate('readerBatches > 0'));
    await evaluate('document.body.style.setProperty("position", "static", "important"); dispatchEvent(new Event("resize"))');
    await until(async () => (await readerState())?.error === 'incompatible');
    assert.equal(await evaluate('document.adoptedStyleSheets.length === 0'), true);
    console.log('Built reader in Chromium distinguishes startup and active layout failures and sends zero text on startup failure.');
    await evaluate('readerCommand({type:"reader:stop"})');
    const startLayout = (id, range, ratio = .5) => evaluate('readerCommand(' + JSON.stringify({type: 'reader:start', session: {
      id, source: 'en', target: 'zh-CN', range, ratio, highlight: true, syncScroll: true, cache: true,
    }}) + ')');

    await evaluate(`{
      const attachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) {
        const shadow = attachShadow.call(this, options);
        if (this.hasAttribute('data-alignread-host')) globalThis.pane = shadow;
        return shadow;
      };
      globalThis.measureLayout = () => {
        const rect = (element) => element ? {...element.getBoundingClientRect().toJSON(), position:getComputedStyle(element).position} : {};
        const bar = document.querySelector('.notice');
        const button = bar.lastElementChild;
        const title = new Range();
        title.selectNodeContents(document.querySelector('.chapter h1'));
        const row = globalThis.pane?.querySelector('[data-sidebar-side]');
        const first = row?.querySelector('[data-reading-area=sidebar]');
        const last = row?.querySelector('[data-reading-area=content]');
        const footer = globalThis.pane?.querySelector('article section[aria-label="页脚"]');
        const action = rect(button);
        return {
          leftPane: document.body.clientWidth, sidebar: rect(document.querySelector('.catalog')),
          main: rect(document.querySelector('.chapter')), title: title.getBoundingClientRect().toJSON(),
          banner: {...rect(bar), whiteSpace:getComputedStyle(button).whiteSpace, actionRight:action.right,
            clickable: button.contains(document.elementFromPoint((action.left + action.right) / 2, (action.top + action.bottom) / 2))},
          footer: rect(document.querySelector('footer')), styleCount: document.adoptedStyleSheets.length,
          translated: {
            side:row?.dataset.sidebarSide ?? null,
            sameRow:first && last && Math.abs(first.getBoundingClientRect().top - last.getBoundingClientRect().top) < 2 &&
              (row.dataset.sidebarSide === 'left' ? first.getBoundingClientRect().right < last.getBoundingClientRect().left :
                last.getBoundingClientRect().right < first.getBoundingClientRect().left),
            menuHasText:first?.textContent.includes('Reference navigation'),
            mainHasTitle:!!last?.querySelector('h1')?.textContent.includes('Install a build plugin'),
            footerAfterColumns:footer && row && footer.getBoundingClientRect().top >= row.getBoundingClientRect().bottom
          }
        };
      };
    }`);
    for (const kind of ['flex', 'right', 'fixed', 'article', 'deep']) {
      await replaceFixture(layoutFixture(kind));
      await evaluate('window.scrollTo(0,0)');
      const reportedSide = kind === 'right' ? 'right' : 'left';
      const before = await evaluate('measureLayout()');
      if (kind !== 'article') assert.equal(before.sidebar.position, kind === 'fixed' ? 'fixed' : 'static');
      assert.equal(before.footer.position, 'static');
      assert.equal(before.banner.position, 'fixed');
      assert((await startLayout(kind, 'visible')).ok);
      await until(async () => {
        const state = await readerState();
        if (state?.status === 'error') throw new Error(kind + ': ' + JSON.stringify(state));
        return state?.status === 'ready';
      });

      const current = await evaluate('measureLayout()');
      assert.equal(current.footer.position, before.footer.position, kind);
      assert.equal(current.banner.position, before.banner.position, kind);
      assert(current.banner.right <= current.leftPane + 2, JSON.stringify(current));
      assert.equal(current.banner.whiteSpace, 'nowrap');
      assert(current.banner.actionRight <= current.banner.right, JSON.stringify(current));
      assert(current.banner.clickable && Math.abs(current.banner.bottom - (kind === 'deep' ? 894 : 900)) <= 2, JSON.stringify(current));
      if (kind !== 'article') {
        assert.equal(current.sidebar.position, before.sidebar.position, kind);
        assert.equal(current.translated.side, reportedSide, kind);
        assert(current.translated.sameRow, JSON.stringify(current));
        assert.equal(current.translated.menuHasText, true);
        assert.equal(current.translated.mainHasTitle, true);
        assert.equal(current.translated.footerAfterColumns, true);
        if (reportedSide === 'left') assert(current.title.left >= current.sidebar.right, JSON.stringify(current));
        else assert(current.title.right <= current.sidebar.left, JSON.stringify(current));
        assert(current.main.right <= current.leftPane + 2, JSON.stringify(current));
      } else assert.equal(current.translated.side, null);

      await evaluate('document.body.scrollTo(0, 320)');
      await until(() => evaluate('document.body.scrollTop >= 315'));
      await evaluate('new Promise(requestAnimationFrame)');
      const moved = await evaluate('measureLayout()');
      assert(current.footer.top - moved.footer.top >= 315, JSON.stringify({current:current.footer, moved:moved.footer}));
      assert(Math.abs(current.banner.top - moved.banner.top) <= 2 && moved.banner.clickable,
        JSON.stringify({kind, current:current.banner, moved:moved.banner}));
      if (kind !== 'article') {
        await until(() => evaluate('pane.querySelector(".scroll").scrollTop > 200'));
        await evaluate('pane.querySelector(".scroll").dispatchEvent(new WheelEvent("wheel",{bubbles:true})); pane.querySelector(".scroll").scrollTo(0,720)');
        await until(() => evaluate('document.body.scrollTop > 500'));
        const synced = await evaluate('measureLayout()');
        assert(Math.abs(synced.banner.bottom - current.banner.bottom) <= 2 && synced.banner.clickable,
          JSON.stringify(synced.banner));
      }
      await evaluate('readerCommand({type:"reader:stop"})');
      const after = await evaluate('measureLayout()');
      assert.equal(after.banner.whiteSpace, before.banner.whiteSpace);
      assert.equal(after.leftPane, before.leftPane);
      assert.equal(after.styleCount, before.styleCount);
    }
    await replaceFixture(layoutFixture('flex', false));
    assert((await startLayout('late-overlay', 'visible')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    await evaluate('document.body.scrollTo(0,520)');
    await until(() => evaluate('document.body.scrollTop >= 500'));
    await evaluate('document.body.insertAdjacentHTML("beforeend", ' + JSON.stringify('<div class="widget"><div><section>' +
      fixtureNotice + '</section></div></div>') + ')');
    await until(() => evaluate('measureLayout().banner.actionRight <= measureLayout().leftPane'));
    const late = await evaluate('measureLayout()');
    assert(Math.abs(late.banner.bottom - 894) <= 2 && late.banner.clickable, JSON.stringify(late.banner));
    await evaluate('pane.querySelector("[role=separator]").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
    const resized = await evaluate('measureLayout()');
    assert(Math.abs(resized.banner.bottom - late.banner.bottom) <= 2 && resized.banner.clickable &&
      resized.banner.actionRight <= resized.leftPane, JSON.stringify(resized.banner));
    await evaluate('readerCommand({type:"reader:stop"})');
    assert.equal(await evaluate('document.querySelector(".notice").hasAttribute("style")'), false);

    await replaceFixture(layoutFixture('flex'));
    assert((await startLayout('main-only', 'main')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    assert.equal(await evaluate('pane.querySelector("[data-sidebar-side]") === null'), true);
    assert.equal(await evaluate('pane.querySelector("article h1").textContent.includes("Install a build plugin")'), true);
    assert.equal(await evaluate('pane.querySelector("article").textContent.includes("Reference navigation")'), false);
    console.log('Sidebar positions, fixed menu clearance, translated structure, footer flow, cookie buttons, restoration, and sync passed in Chromium.');
    await evaluate('readerCommand({type:"reader:stop"})');

    await page('Emulation.setDeviceMetricsOverride', {width: 1640, height: 900, deviceScaleFactor: 1, mobile: false});
    await replaceFixture(columnsFixture());
    assert((await startLayout('columns', 'visible')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    const columns = await evaluate(`{
      const rows = pane.querySelectorAll('[data-reading-columns]');
      const measure = (row) => [...row.children].map((column) => {
        const {left, top} = column.getBoundingClientRect();
        return {left, top, heading:column.querySelector('h2,h3')?.textContent, links:column.querySelectorAll('a').length};
      });
      [measure(rows[0]), measure(rows[1]), measure(rows[2])];
    }`);
    const [cards, footer, footerLinks] = columns;
    for (const [row, count] of [[cards, 3], [footer, 2], [footerLinks, 4]]) {
      assert.equal(row.length, count);
      assert(row.every((column, index) => Math.abs(column.top - row[0].top) < 2 &&
        (index === 0 || column.left > row[index - 1].left)), JSON.stringify(row));
    }
    assert.match(cards[1].heading, /Get support/);
    assert.match(footer[1].heading, /Get the newsletter/);
    assert.equal(footerLinks[0].links, 2);
    assert.equal(await evaluate('pane.querySelector("[data-reading-columns] > div:nth-child(2) a").getAttribute("href")'),
      'https://example.com/support');
    assert(await evaluate(`{
      const link = pane.querySelector('[data-reading-columns] > div:nth-child(2) a');
      let navigates;
      pane.addEventListener('click', (event) => {
        navigates = !event.defaultPrevented && !CSS.highlights.has('alignread-paragraph');
        event.preventDefault();
      }, {once:true});
      link.click();
      navigates;
    }`));
    assert.equal(await evaluate(`{
      pane.querySelector('[data-reading-columns] > div:nth-child(2) h2 span').click();
      CSS.highlights.get('alignread-paragraph')?.values().next().value?.startContainer.parentElement.textContent;
    }`), 'Get support');

    await page('Emulation.setDeviceMetricsOverride', {width: 1100, height: 900, deviceScaleFactor: 1, mobile: false});
    await evaluate(`{
      const divider = pane.querySelector('[role=separator]');
      for (let i = 0; i < 10; i++) divider.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    }`);
    assert(await evaluate(`{
      const [first, , last] = pane.querySelector('[data-reading-columns]').children;
      const scroll = pane.querySelector('.scroll');
      last.getBoundingClientRect().top > first.getBoundingClientRect().bottom &&
        scroll.scrollWidth <= scroll.clientWidth + 1;
    }`));
    await evaluate('readerCommand({type:"reader:stop"})');
    await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    assert((await startLayout('columns-main-only', 'main')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    assert.equal(await evaluate('pane.querySelectorAll("[data-reading-columns]").length'), 1);
    await evaluate('readerCommand({type:"reader:stop"})');
    console.log('Translated grid cards, nested footer columns, visual order, narrow wrapping, and source mapping passed.');

    await replaceFixture(tabsFixture());
    assert((await startLayout('tabs', 'main')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    const tabLayout = await evaluate(`{
      const rows = [...pane.querySelectorAll('[data-reading-navigation=tabs]')];
      const lists = rows.map((row) => {
        const items = [...row.children];
        const bounds = items.map((item) => item.getBoundingClientRect());
        return {
          horizontal: bounds.every((item, i) => !i || Math.abs(item.top - bounds[0].top) < 2 &&
            item.left > bounds[i - 1].left),
          markers: getComputedStyle(items[0]).listStyleType,
          active: row.querySelector('[aria-current=true]')?.textContent,
          width: row.clientWidth,
          bounds: bounds.map(({left, top, width}) => [left, top, width]),
        };
      });
      const ordinary = pane.querySelector('article ul:not([data-reading-navigation])');
      ({lists, ordinary: getComputedStyle(ordinary).display, markers: getComputedStyle(ordinary.firstElementChild).listStyleType});
    }`);
    assert.equal(tabLayout.lists.length, 2);
    assert(tabLayout.lists.every(({horizontal, markers}) => horizontal && markers === 'none'), JSON.stringify(tabLayout));
    assert.match(tabLayout.lists[0].active, /Overview/);
    assert.match(tabLayout.lists[1].active, /Reference/);
    assert.equal(tabLayout.ordinary, 'block');
    assert.equal(tabLayout.markers, 'disc');
    assert.equal(await evaluate('pane.querySelector("[data-reading-navigation=tabs] li:nth-child(2) a").href'), 'https://example.com/learn');
    assert.equal(await evaluate('readerPayloads.flat().some(text => /Do not translate this button|Hidden tab/.test(text))'), false);
    assert.equal(await evaluate(`{
      pane.querySelector('[aria-label="Documentation sections"] [aria-current=true] [data-reader-block] > span').click();
      CSS.highlights.get('alignread-paragraph')?.values().next().value?.startContainer.parentElement.textContent;
    }`), 'Reference');
    await page('Emulation.setDeviceMetricsOverride', {width: 1100, height: 900, deviceScaleFactor: 1, mobile: false});
    await evaluate(`{
      const divider = pane.querySelector('[role=separator]');
      for (let i = 0; i < 10; i++) divider.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    }`);
    assert(await evaluate(`{
      const row = pane.querySelector('[data-reading-navigation=tabs]');
      const scroll = pane.querySelector('.scroll');
      row.scrollWidth > row.clientWidth && scroll.scrollWidth <= scroll.clientWidth + 1 &&
        Math.abs(row.firstElementChild.getBoundingClientRect().top - row.lastElementChild.getBoundingClientRect().top) < 2;
    }`));
    await evaluate('readerCommand({type:"reader:stop"})');
    await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    console.log('Translated link and ARIA tabs keep their layout, selection, links and source mapping; ordinary lists keep markers.');

    const structures = fs.readFileSync(path.resolve(__dirname, 'fixtures/layout-structures.html'), 'utf8');
    await replaceFixture(structures);
    await evaluate('readerPayloads.length = 0');
    assert((await startLayout('reading-structures', 'main')).ok);
    await until(async () => (await readerState())?.status === 'ready');
    const structure = await evaluate(`{
      const article = pane.querySelector('article');
      const box = article.querySelector('[data-reading-surface]');
      const list = article.querySelector('[data-reading-list-columns]');
      const table = article.querySelector('table');
      const image = article.querySelector('figure [role=img]');
      ({
        background: box.style.backgroundColor, borderRadius: box.style.borderRadius,
        inline: ['mark','del','ins','em strong','sub','sup','kbd','hr','dl dt','dl dd']
          .every(tag => tag === 'em strong' ? !!article.querySelector('em strong,strong em') : !!article.querySelector(tag)),
        breaks: article.querySelectorAll('p br').length,
        grid: [...list.children].every(li => li.getBoundingClientRect().top === list.firstElementChild.getBoundingClientRect().top),
        marker: getComputedStyle(list).listStyleType,
        numbering: article.querySelector('ol').reversed && article.querySelector('ol').start === 7 &&
          article.querySelector('ol li[value]').value === 4 && getComputedStyle(article.querySelector('ol')).listStyleType === 'upper-roman',
        open: article.querySelector('[data-reading-disclosure=open]').textContent.includes('Visible disclosure text'),
        closed: article.querySelector('[data-reading-disclosure=closed]').querySelectorAll('[data-reader-block]').length,
        image: image.getAttribute('aria-label'), caption: article.querySelector('figcaption').textContent,
        imageLoads: article.querySelectorAll('img').length,
        spans: table.querySelector('th[scope=colgroup]').colSpan === 2 && table.querySelector('th[scope=row]').rowSpan === 2,
        tableStyle: getComputedStyle(table).captionSide === 'bottom' && getComputedStyle(table.querySelector('td')).textAlign === 'right',
      });
    }`);
    assert.deepEqual(structure, {
      background: 'rgb(37, 58, 73)', borderRadius: '8px', inline: true, breaks: 2, grid: true, marker: 'square',
      numbering: true, open: true, closed: 1, image: 'Image description only', caption: '译 Figure caption',
      imageLoads: 0, spans: true, tableStyle: true,
    });
    assert.equal(await evaluate('readerPayloads.flat().some(text => /Hidden disclosure text|Image description only|Ctrl\\+K/.test(text))'), false);
    await checkInlineRow({evaluate, until});

    await page('Emulation.setDeviceMetricsOverride', {width: 1024, height: 900, deviceScaleFactor: 1, mobile: false});
    await until(() => evaluate('pane.querySelector(".scroll").clientWidth <= 512'));
    assert(await evaluate(`{
      const table = pane.querySelector('.table-scroll');
      const scroll = pane.querySelector('.scroll');
      table.scrollWidth > table.clientWidth && scroll.scrollWidth <= scroll.clientWidth + 1;
    }`), 'A wide table should scroll within its wrapper without widening the reader pane.');
    await evaluate(`{
      const cell = document.querySelector('tbody tr:first-child td:last-child');
      cell.scrollIntoView({block:'center'});
      const range = new Range();
      range.selectNodeContents(cell);
      const bounds = range.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:bounds.left + 2, clientY:bounds.top + 2}));
    }`);
    assert(await evaluate('pane.querySelector(".table-scroll").scrollLeft > 0'));
    await evaluate('readerCommand({type:"reader:stop"})');
    await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
    console.log('Reading structure coverage passed for surfaces, line breaks, lists, disclosures, figures and wide tables.');

    await checkHeaderLayout({evaluate, until, page, replaceFixture, startLayout, readerState});
    await checkPaper({evaluate, until, replaceFixture, readerState});
    await checkRepositoryLayout({evaluate, until, page, replaceFixture, startLayout, readerState});

    await replaceFixture(fixture.replace('</article>',
      '<form><input type="password" value="fixture-password"><textarea>fixture-textarea</textarea></form></article>'));
    await evaluate('readerMode = "partial"; readerPayloads.length = 0;');
    assert((await startLayout('structure', 'main')).ok);
    await until(async () => {
      const state = await readerState();
      return state.status === 'partial' && state.done > 0 && state.failed === 1;
    });
    assert(await evaluate('["h1", "ul", "blockquote", "pre", "table"].every(tag => pane.querySelector("article " + tag))'));
    assert.match(await evaluate('pane.querySelector("article pre").textContent'), /const result = Math.max/);
    assert.equal(await evaluate('readerPayloads.flat().some(text => /fixture value|fixture-password|fixture-textarea|Hidden fixture text|Editable fixture text|const result/.test(text))'), false);
    assert(await evaluate('pane.querySelector(".retry") !== null'));
    await evaluate('pane.querySelector(".retry").click()');
    await until(async () => (await readerState())?.status === 'ready');
    assert.equal(await evaluate('pane.querySelectorAll("article button").length'), 0);
    assert(await evaluate(String.raw`{
      const matches = [...pane.querySelectorAll('article p[data-reader-block]')]
        .filter(element => element.textContent.includes('Read the topic in order'));
      if (matches.length !== 2 || matches[0].dataset.readerBlock === matches[1].dataset.readerBlock) {
        throw Error('Duplicate paragraphs must retain distinct IDs');
      }
      matches[1].dispatchEvent(new PointerEvent('pointerover', {bubbles:true}));
      const ranges = [...CSS.highlights.get('alignread-paragraph')];
      if (ranges.length !== 1 || ranges[0].startContainer.parentElement.previousElementSibling.id !== 'example') {
        throw Error('Wrong original paragraph highlighted');
      }
      const text = matches[1].firstElementChild;
      const selection = getSelection(), range = new Range();
      range.selectNodeContents(text);
      selection.removeAllRanges();
      selection.addRange(range);
      CSS.highlights.delete('alignread-paragraph');
      text.click();
      if (CSS.highlights.has('alignread-paragraph') || !selection.toString().includes('Read the topic in order')) {
        throw Error('Selecting translated text must take priority over locating the original');
      }
      selection.removeAllRanges();
      text.click();
      if (!matches[1].hasAttribute('data-active') || !CSS.highlights.has('alignread-paragraph')) {
        throw Error('Clicking translated text must locate the original');
      }
      CSS.highlights.delete('alignread-paragraph');
      matches[1].focus({preventScroll:true});
      matches[1].dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}));
      if (pane.activeElement !== matches[1] || !CSS.highlights.has('alignread-paragraph')) {
        throw Error('Enter on the focused translated paragraph must locate the original');
      }
      const open = document.querySelector('details');
      open.querySelector('summary').click();
      if (!open.open) throw Error('Original details interaction was lost');
      range.selectNodeContents(document.querySelector('main h1'));
      selection.removeAllRanges();
      selection.addRange(range);
      if (!selection.toString().includes('Reading an API reference')) throw Error('Native selection was lost');
      selection.removeAllRanges();
      document.getElementById('example').getBoundingClientRect().top < innerHeight;
    }`));
    await evaluate('document.querySelector("nav a").click()');
    await until(() => evaluate('location.hash === "#example"'));
    assert.equal((await readerState()).status, 'ready');
    for (let index = 0; index < 5; index++) {
      await evaluate('pane.querySelector("[role=separator]").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
    }
    assert(await evaluate('Math.abs(document.body.getBoundingClientRect().width - innerWidth * .4) < 2'));
    assert(Math.abs((await evaluate('readerSavedRatio')) - .4) < 1e-10);
    await evaluate('readerCommand({type:"reader:stop"})');
    assert((await startLayout('restored-ratio', 'main', .4)).ok);
    await until(async () => (await readerState())?.status === 'ready');
    assert(await evaluate('Math.abs(document.body.getBoundingClientRect().width - innerWidth * .4) < 2'));
    await evaluate('readerCommand({type:"reader:stop"})');
    await page('Emulation.setDeviceMetricsOverride', {width: 850, height: 900, deviceScaleFactor: 1, mobile: false});
    assert.deepEqual(await startLayout('too-narrow', 'main'), {ok: false, error: 'narrow'});
    await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});

    await evaluate('readerMode = "rate-limit"');
    assert((await startLayout('server-busy', 'main')).ok);
    await until(async () => (await readerState())?.error === 'rate-limit');
    await evaluate('pane.querySelector(".retry").click()');
    await until(async () => (await readerState())?.status === 'ready');
    await evaluate('readerCommand({type:"reader:stop"})');
    for (let round = 0; round < 10; round++) {
      const count = await evaluate('readerBatches');
      await evaluate('readerMode = "slow"');
      assert((await startLayout('cycle-' + round, 'main')).ok);
      await until(async () => (await evaluate('readerBatches')) > count);
      assert.equal(await evaluate('document.querySelectorAll("[data-alignread-host]").length'), 1);
      if (round === 0) await evaluate('window.dispatchEvent(new Event("pagehide"))');
      else await evaluate('readerCommand({type:"reader:stop"})');
      assert.equal(await evaluate('document.querySelectorAll("[data-alignread-host]").length'), 0);
    }
    await wait(170);
    assert.equal(await evaluate('document.querySelectorAll("[data-alignread-host]").length'), 0);
    assert.equal(await evaluate('document.adoptedStyleSheets.length'), 0);
    console.log('Reader structure, input filtering, highlighting, seeking, native details/selection, resizing, failures, and ten open/close cycles passed.');

    await evaluate('readerMode = "success"');
    for (const count of [100, 500, 1000]) {
      const lines = Array.from({length: count}, (_, index) =>
        '<p>Section ' + (index + 1) + '. This paragraph explains how to use the documented feature.</p>').join('');
      await replaceFixture('<!doctype html><html><body><main><h1>Long technical reference</h1>' + lines + '</main></body></html>');
      const first = performance.now();
      assert((await startLayout('performance-' + count, 'main')).ok);
      await until(() => evaluate('!!pane.querySelector(".toolbar")'));
      const feedback = Math.round(performance.now() - first);
      await until(async () => (await readerState())?.status === 'ready');
      const complete = Math.round(performance.now() - first);
      assert.equal(await evaluate('pane.querySelectorAll("article p").length'), count);
      console.log(JSON.stringify({paragraphs: count, feedbackMs: feedback, completeMs:complete}));
      await evaluate('readerCommand({type:"reader:stop"})');
    }
    if (!layoutOnly) {
      await checkSpaBrowser({page, evaluate, until, build});
      await checkReplacement();
    }
  } finally {
    clearTimeout(watchdog);
    child.kill();
    await stopped;
    await fs.promises.rm(profile, {recursive: true, force: true, maxRetries: 5});
  }
}

const fixtureNotice = '<div class="notice"><p>This site uses optional cookies. Choose an option to continue reading this manual.</p>' +
  '<button>Reject</button><button>Accept</button></div>';

function columnsFixture() {
  const cards = [['Get ahead', 'training'], ['Get support', 'support'], ['Upcoming events', 'events']];
  const links = ['Why Java', 'Learn', 'Resources', 'Community'];
  return `<!doctype html><html><head><style>
    body{margin:0;font:16px/1.5 sans-serif} main,footer{padding:24px}
    .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
    .footer-layout{display:flex;flex-direction:row-reverse;gap:24px}.newsletter{flex:1;min-width:0}
    .links{display:flex;flex:2;gap:12px;min-width:0}.links>div{flex:1;min-width:0}.links a{display:block}
    </style></head><body><main><h1>Project overview</h1><div class="cards">
    ${cards.map(([title, path]) => `<section><h2>${title}</h2><p>Explore the project and its documentation.</p>
      <a href="https://example.com/${path}">Learn more</a></section>`).join('')}
    </div><p>More about the project.</p></main><footer><div class="footer-layout">
    <div class="newsletter"><h2>Get the newsletter</h2><p>Read the latest project news.</p></div>
    <div class="links">${links.map((title) => `<div><h3>${title}</h3>
      <a href="https://example.com/guides">Guides</a><a href="https://example.com/topics">Topics</a></div>`).join('')}</div>
    </div></footer></body></html>`;
}

function tabsFixture() {
  return `<!doctype html><html><head><style>
    body{margin:0;font:16px/1.5 sans-serif} main{padding:24px}
    .tabs{list-style:none;padding:0}.tabs li{display:inline-block;margin-right:20px}
    [role=tablist]{display:flex;gap:16px}
    </style></head><body><main><h1>Project documentation</h1>
    <ul class="tabs"><li class="active"><a href="https://example.com/overview">Overview</a></li>
      <li><a href="https://example.com/learn">Learn</a></li><li><a href="https://example.com/support">Support</a></li>
      <li><a href="https://example.com/samples">Samples</a></li></ul>
    <nav role="tablist" aria-label="Documentation sections">
      <button role="tab" aria-selected="false">Guides</button>
      <button role="tab" aria-selected="true">Reference</button>
      <button role="tab" aria-selected="false" hidden>Hidden tab</button>
    </nav>
    <button type="button">Do not translate this button</button>
    <section><h2>Features</h2><ul><li>Start an application</li><li>Configure a service</li></ul></section>
    </main></body></html>`;
}

function layoutFixture(kind, withNotice = true) {
  const entries = Array.from({length: 42}, (_, i) => '<li><a href="#step-' + i + '">Navigation topic ' + i + '</a></li>').join('');
  const sections = Array.from({length: 42}, (_, i) => '<section id="step-' + i + '"><h2>Installing step ' + i + '</h2>' +
    '<p>This chapter covers different installation choices and explains what each configuration does.</p></section>').join('');
  return '<!doctype html><html><head><meta charset="UTF-8"><style>' +
    'html,body{margin:0}body{font:16px/1.5 sans-serif;color:#142f37}*{box-sizing:border-box}' +
    '.top{position:sticky;top:0;width:100vw;height:68px;background:white;z-index:4;padding:16px}' +
    '.manual{display:flex;width:100%}.manual.right{flex-direction:row-reverse}.catalog{width:240px;flex:none;height:500px;overflow:auto;background:#eef2f4;padding:12px}' +
    '.manual.fixed .catalog{position:fixed;top:68px;left:0}.manual.fixed .chapter{margin:0 auto}' +
    '.chapter{width:900px;min-width:900px;padding:0 16px}.chapter h1{margin:0;padding-top:8px}' +
    'footer{height:90px;margin-top:24px;background:#e2e8eb;padding:16px}' +
    '.notice{position:fixed;bottom:0;left:0;width:100vw;display:flex;align-items:center;gap:12px;background:#26363c;color:white;padding:12px 20px;z-index:9}' +
    '.notice p{flex:1;min-width:0}.notice button{font:inherit;padding:6px;flex:0 1 32px}' +
    '.widget .notice{left:auto;right:0;width:100%;translate:0 -6px}' +
    '</style></head><body><header class="top">Documentation portal</header><div class="manual ' + kind + '">' +
    (kind === 'article' ? '' : '<nav aria-label="Documentation" class="catalog"><h2>Reference navigation</h2><ul>' + entries + '</ul></nav>') +
    '<main class="chapter"><article><h1>Install a build plugin</h1>' + sections + '</article></main></div>' +
    '<footer>Documentation terms and version history</footer>' +
    (withNotice ? kind === 'deep' ? '<div class="widget"><div><section>' + fixtureNotice + '</section></div></div>' : fixtureNotice : '') +
    '</body></html>';
}
function initReader() {
  globalThis.chrome ??= {};
  globalThis.readerBatches = 0;
  globalThis.readerPayloads = [];
  globalThis.readerMode = 'success';
  globalThis.readerSavedRatio = null;
  chrome.runtime = {
    id: 'alignread-test',
    onMessage: {addListener(listener) {
      globalThis.readerCommand = (message) => new Promise(resolve => listener(message,{id:'alignread-test'},resolve));
    }},
    async sendMessage(message) {
      if (message.type === 'resize') readerSavedRatio = message.ratio;
      if (message.type !== 'batch') return {ok:true};
      readerBatches++;
      readerPayloads.push(message.items.map(({text}) => text));
      let items = message.items;
      if (readerMode === 'rate-limit') {
        readerMode = 'success';
        return {ok:false, error:'rate-limit'};
      }
      if (readerMode === 'partial') {
        items = items.filter(({text}) => text !== 'Reading an API reference');
        if (items.length < message.items.length) readerMode = 'success';
      }
      if (readerMode === 'slow') await new Promise(resolve => setTimeout(resolve, 150));
      return {ok:true, value: {id:message.batchId, items:items.map(({id,text}) => ({id,text:'译 ' + text}))}};
    }
  };
}

async function run() {
  if (pdfOnly || !(layoutOnly || spaOnly || replacementOnly || selectionOnly || settingsOnly)) {
    await checkPdfWorker({chrome:startWorker(), origin, id, sample, calls, grants, googleOrigin, local});
  }
  if (layoutOnly || pdfOnly) return checkBrowser();
  if (replacementOnly) { startWorker(); return checkBrowser(); }
  if (selectionOnly || settingsOnly || spaOnly) startWorker();
  else await checkWorker();
  if (!selectionOnly && !settingsOnly) {
    await checkSpaWorker({dispatch, request, saveYoudao, session, tabs, grants, calls, youdaoOrigin, until});
  }
  if (spaOnly) return checkBrowser();
  if (!selectionOnly) {
    const aiWorker = {request, dispatch, settings, tabs, grants, session, calls, until, setResponse, revokePermission, local, streamState};
    await checkAiWorker(aiWorker);
    await checkNamedAiWorkers(aiWorker);
    await checkAiPresets(aiWorker);
  }
  if (!settingsOnly) await checkSelectionWorker({dispatch, request, saveYoudao, session, tabs, grants, calls, youdaoOrigin, until});
  await checkBrowser();
}

run().catch(error => { console.error(error); process.exitCode = 1; });
