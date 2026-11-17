const assert = require('node:assert/strict');

const endpoint = 'https://model.example.test/v1/chat/completions';
const host = 'https://model.example.test/*';
const fields = {endpoint, model: 'example-model'};
const config = {...fields, apiKey: 'sample-ai-secret'};
const deepseek = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: 'sample-deepseek-key' };
const minimax = { endpoint: 'https://api.minimax.cn/v1/chat/completions', model: 'MiniMax-M3.1-Flash', apiKey: 'sample-minimax-key' };
const minimaxGlobal = 'https://api.minimax.io/v1/chat/completions';
const permissionFor = (endpoint) => new URL(endpoint).origin + '/*';
const timedStreams = new Set(['slow-stream', 'stalled-stream', 'continuous-stream', 'connect-stalled']);

function streamedResponse({signal}, content, mode) {
  const data = (value) => Buffer.from(`data: ${JSON.stringify(value)}\r\n\r\n`);
  const frame = (delta, finish_reason = null) => data({choices: [{delta, finish_reason}]});
  const reasoning = Buffer.concat([Buffer.from(': keep-alive\r\n\r\n'), frame({reasoning_content: 'Reasoning only'})]);
  const answer = frame({content});
  const split = answer.indexOf(Buffer.from('译')) + 1;
  const chunks = [reasoning, answer.subarray(0, split), answer.subarray(split)];
  if (mode === 'stalled-stream' || mode === 'continuous-stream') chunks.splice(1);
  else if (mode === 'stream-provider-timeout') chunks.push(data({base_resp: {status_code: 2066}}));
  else if (mode !== 'truncated-stream') chunks.push(frame({}, mode === 'length-stream' ? 'length' : 'stop'));

  let stop;
  const body = new ReadableStream({
    start(controller) {
      let timer;
      function abort() {
        stop();
        controller.error(signal.reason);
      }
      stop = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, {once: true});
      function send() {
        const chunk = chunks.shift() ?? (mode === 'continuous-stream' ? reasoning : undefined);
        if (chunk) {
          controller.enqueue(chunk);
          timer = setTimeout(send, timedStreams.has(mode) ? 100 : 0);
        } else if (mode !== 'stalled-stream') {
          stop();
          controller.close();
        }
      }
      timer = setTimeout(send, timedStreams.has(mode) ? 100 : 0);
    },
    cancel() { stop(); },
  });
  return new Response(body, {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}});
}

async function aiResponse(options, mode, url) {
  const body = JSON.parse(options.body);
  const {items} = JSON.parse(body.messages[1].content);
  if (typeof mode === 'number') return Response.json({base_resp: {status_code: mode}});
  if (mode === 'auth') return new Response(null, {status: 401});
  if (mode === 'rate-limit') return new Response(null, {status: 429});
  if (mode === 'missing') return new Response(null, {status: 404});
  if (mode === 'blocked' || mode === 'connect-stalled') {
    const {signal} = options;
    signal.throwIfAborted();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  }
  const rows = items.map(({index, text}) => ({index, text: '译 ' + text})).reverse();
  if (mode === 'duplicate') rows[1].index = rows[0].index;
  if (mode === 'unknown') rows[0].index = items.length;
  if (mode === 'incomplete') rows.pop();
  const plain = JSON.stringify({items: rows});
  if (url.includes('minimax.') && mode !== 'json-response') return streamedResponse(options, plain, mode);
  return Response.json({choices: [{finish_reason: 'stop', message: {
    content: url === deepseek.endpoint ? plain : '```json\n' + plain + '\n```',
    ...(url.includes('minimax.') && {reasoning_content: 'Separate reasoning field'}),
  }}]});
}

async function checkAiWorker({request, dispatch, settings, tabs, grants, session, calls, until, setResponse, revokePermission, local}) {
  const save = (config, authorized = true) => request({type: 'save-ai', provider: 'ai', config, authorized});
  const test = () => request({type: 'test-provider', provider: 'ai'});
  delete local.providerSettings.aiServices;
  Object.assign(local.providerSettings, {ai: config, aiAuthorized: true});
  assert.deepEqual((await settings()).aiServices.ai, fields);
  assert((await settings()).providers.ai.consent);
  assert(!JSON.stringify(await settings()).includes(config.apiKey));
  await request({type: 'reset'});
  const beforeSetup = calls.length;
  assert.deepEqual(await test(), {ok: false, error: 'not-configured'});
  for (const endpoint of [
    'http://model.example.test/v1/chat/completions', 'https://*.example.test/v1/chat/completions',
    'https://user:pass@model.example.test/v1/chat/completions', 'https://model.example.test/v1/chat/completions?token=sample',
    'https://model.example.test/v1/models',
  ]) assert.deepEqual(await save({...config, endpoint}), {ok: false, error: 'ai-config'});
  assert((await save(config)).ok);
  assert.deepEqual((await settings()).aiServices.ai, fields);
  assert(!JSON.stringify(await settings()).includes(config.apiKey));
  assert.deepEqual(await test(), {ok: false, error: 'consent-required'});
  grants.add(host);
  assert((await save(fields, false)).ok);
  assert(!grants.has(host));
  assert.deepEqual(await test(), {ok: false, error: 'consent-required'});
  assert.equal(calls.length, beforeSetup);
  grants.add(host);
  assert((await save(fields)).ok);
  assert.equal((await test()).value.providers.ai.lastCheck.error, undefined);
  for (const [mode, error] of [['auth', 'authentication'], ['rate-limit', 'rate-limit'], ['missing', 'ai-endpoint']]) {
    setResponse(mode);
    assert.equal((await test()).value.providers.ai.lastCheck.error, error);
  }
  setResponse('success');

  await request({type: 'select-provider', provider: 'ai'});
  const tabId = 70;
  const url = 'https://article.example.test/page';
  tabs.set(tabId, {url, documentId: 'ai-doc'});
  const sender = {tab: {id: tabId}, documentId: 'ai-doc', url, frameId: 0};
  const start = (type) => request({type, tabId, provider: 'ai', options: {
    source: 'auto', target: 'zh-CN', range: 'main',
  }}, 'popup');
  assert((await start('start')).ok);
  const sessionId = session['reader:70'].session.id;
  const batch = () => dispatch({type: 'batch', sessionId, batchId: 'local-batch', items: [
    {id: 'local-alpha', text: 'Alpha\nBeta'}, {id: 'local-gamma', text: 'Gamma'},
  ]}, sender);
  assert.deepEqual(await batch(), {ok: true, value: {id: 'local-batch', items: [
    {id: 'local-gamma', text: '译 Gamma'}, {id: 'local-alpha', text: '译 Alpha\nBeta'},
  ]}});
  const {url: calledEndpoint, options} = calls.at(-1);
  assert.equal(calledEndpoint, endpoint);
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, 'Bearer ' + config.apiKey);
  const body = JSON.parse(options.body);
  assert.equal(body.model, config.model);
  assert.deepEqual(JSON.parse(body.messages[1].content), {source: 'auto', target: '简体中文', items: [
    {index: 0, text: 'Alpha\nBeta'}, {index: 1, text: 'Gamma'},
  ]});
  for (const mode of ['duplicate', 'unknown', 'incomplete']) {
    setResponse(mode);
    assert.deepEqual(await batch(), {ok: false, error: 'invalid-response'});
  }
  setResponse('success');
  assert((await start('selection-start')).ok);
  assert.deepEqual(await dispatch({type: 'selection:translate', sessionId: session['selection:70'].session.id,
    requestId: 'ai-selection', text: 'Selected'}, sender), {ok: true, value: '译 Selected'});

  const newEndpoint = 'https://other.example.test/v1/chat/completions';
  assert.deepEqual(await save({...fields, endpoint: newEndpoint}), {ok: false, error: 'ai-config'});
  assert((await save({...fields, model: 'second-model'})).ok);
  assert.equal((await settings()).providers.ai.lastCheck, null);
  assert.deepEqual(await batch(), {ok: false, error: 'stale'});
  assert.equal(session['selection:70'], undefined);
  assert((await start('start')).ok);
  const count = calls.length;
  setResponse('blocked');
  const active = dispatch({type: 'batch', sessionId: session['reader:70'].session.id, batchId: 'pending',
    items: [{id: 'local-pending', text: 'Waiting'}]}, sender);
  await until(() => calls.length > count);
  revokePermission(host);
  assert.deepEqual(await active, {ok: false, error: 'stale'});
  setResponse('success');
  grants.add(host);
  const newHost = 'https://other.example.test/*';
  grants.add(newHost);
  assert((await save({...config, endpoint: newEndpoint})).ok);
  assert(!grants.has(host));
  assert((await settings()).providers.ai.hostPermission);
  await request({type: 'reset'});
  assert(!grants.has(newHost));
  assert.equal((await settings()).aiServices.ai, null);
  console.log('AI translation passed setup, credentials, permissions, connection, reader, selection, and response validation.');
}

async function checkNamedAiWorkers({request, dispatch, settings, tabs, grants, session, calls, setResponse, streamState}) {
  const save = (provider, config) => request({type: 'save-ai', provider, config, authorized: true});
  const test = (provider) => request({type: 'test-provider', provider});
  const services = {deepseek, minimax};
  const tabId = 71;
  const url = 'https://article.example.test/selected';
  const documentId = 'named-ai-doc';
  tabs.set(tabId, {url, documentId});
  for (const [provider, service] of Object.entries(services)) {
    const {endpoint, model, apiKey} = service;
    assert.deepEqual(await save(provider, {...service, endpoint: config.endpoint}), {ok: false, error: 'ai-config'});
    assert((await save(provider, service)).ok);
    assert.deepEqual(await test(provider), {ok: false, error: 'consent-required'});
    grants.add(permissionFor(endpoint));
    assert.equal((await test(provider)).value.providers[provider].lastCheck.error, undefined);

    const call = calls.at(-1);
    const body = JSON.parse(call.options.body);
    assert.equal(call.url, endpoint);
    assert.equal(call.options.headers.Authorization, 'Bearer ' + apiKey);
    assert.equal(body.model, model);
    if (provider === 'deepseek') {
      assert.equal(body.stream, false);
      assert.deepEqual(body.response_format, {type: 'json_object'});
      assert.deepEqual(body.thinking, {type: 'disabled'});
      assert.equal(body.reasoning_split, undefined);
    } else {
      assert.equal(body.stream, true);
      assert.equal(body.reasoning_split, true);
      assert.equal(body.reasoning_effort, 'low');
      assert.equal(body.response_format, undefined);
    }

    const switched = await request({type: 'switch-provider', tabId, provider}, 'popup');
    assert.equal(switched.value.settings.provider, provider);
    assert((await request({type: 'selection-start', tabId, provider, options: {
      source: 'en', target: 'zh-CN', range: 'main',
    }}, 'popup')).ok);
    assert.deepEqual(await dispatch({type: 'selection:translate', sessionId: session['selection:71'].session.id,
      requestId: provider, text: 'Selected'}, {tab: {id: tabId}, documentId, url, frameId: 0}), {ok: true, value: '译 Selected'});
  }

  for (const [code, error] of [[1002, 'rate-limit'], [1004, 'authentication'], [1008, 'quota'], [2022, 'ai-endpoint']]) {
    setResponse(code);
    assert.equal((await test('minimax')).value.providers.minimax.lastCheck.error, error);
  }
  setResponse('success');
  assert.deepEqual(await save('minimax', {endpoint: minimaxGlobal, model: minimax.model}), {ok: false, error: 'ai-config'});
  grants.add(permissionFor(minimaxGlobal));
  assert((await save('minimax', {...minimax, endpoint: minimaxGlobal, apiKey: 'sample-global-key'})).ok);
  assert(!grants.has(permissionFor(minimax.endpoint)));
  assert.equal((await test('minimax')).value.providers.minimax.lastCheck.error, undefined);
  const before = streamState().heartbeats;
  for (const [mode, error] of [
    ['slow-stream', undefined], ['connect-stalled', 'ai-connect-timeout'],
    ['stalled-stream', 'timeout'], ['continuous-stream', 'timeout'],
    ['truncated-stream', 'invalid-response'], ['length-stream', 'invalid-response'], ['stream-provider-timeout', 'timeout'],
    ['json-response', undefined],
  ]) {
    setResponse(mode);
    assert.equal((await test('minimax')).value.providers.minimax.lastCheck.error, error, mode);
    assert.equal(streamState().active, 0, mode);
  }
  assert(streamState().heartbeats > before);
  setResponse('success');
  const view = await settings();
  assert.equal(view.aiServices.minimax.endpoint, minimaxGlobal);
  assert.equal(view.aiServices.deepseek.endpoint, deepseek.endpoint);
  assert(!JSON.stringify(view).includes(deepseek.apiKey));
  assert(!JSON.stringify(view).includes('sample-global-key'));
  assert(view.providers.deepseek.hostPermission);
  await request({type: 'reset'});
  assert(!grants.has(permissionFor(deepseek.endpoint)) && !grants.has(permissionFor(minimaxGlobal)));
  console.log('DeepSeek and MiniMax passed request formats, isolated keys, region changes, slow streams and both timeout limits.');
}

module.exports = {aiResponse, checkAiWorker, checkNamedAiWorkers, timedStreams, config, host, deepseek, minimax, minimaxGlobal};
