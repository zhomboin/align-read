const assert = require('node:assert/strict');

const endpoint = 'https://model.example.test/v1/chat/completions';
const host = 'https://model.example.test/*';
const fields = {endpoint, model: 'example-model'};
const config = {...fields, apiKey: 'sample-ai-secret'};

async function aiResponse(options, mode) {
  const body = JSON.parse(options.body);
  const {items} = JSON.parse(body.messages[1].content);
  if (mode === 'auth') return new Response(null, {status: 401});
  if (mode === 'rate-limit') return new Response(null, {status: 429});
  if (mode === 'missing') return new Response(null, {status: 404});
  if (mode === 'blocked') {
    const {signal} = options;
    signal.throwIfAborted();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  }
  const rows = items.map(({index, text}) => ({index, text: '译 ' + text})).reverse();
  if (mode === 'duplicate') rows[1].index = rows[0].index;
  if (mode === 'unknown') rows[0].index = items.length;
  if (mode === 'incomplete') rows.pop();
  return Response.json({choices: [{finish_reason: 'stop', message: {
    content: '```json\n' + JSON.stringify({items: rows}) + '\n```',
  }}]});
}

async function checkAiWorker({request, dispatch, settings, tabs, grants, session, calls, until, setResponse, revokePermission}) {
  const save = (config, authorized = true) => request({type: 'save-ai', config, authorized});
  const test = () => request({type: 'test-provider', provider: 'ai'});
  await request({type: 'reset'});
  const beforeSetup = calls.length;
  assert.deepEqual(await test(), {ok: false, error: 'not-configured'});
  for (const endpoint of [
    'http://model.example.test/v1/chat/completions', 'https://*.example.test/v1/chat/completions',
    'https://user:pass@model.example.test/v1/chat/completions', 'https://model.example.test/v1/chat/completions?token=sample',
    'https://model.example.test/v1/models',
  ]) assert.deepEqual(await save({...config, endpoint}), {ok: false, error: 'ai-config'});
  assert((await save(config)).ok);
  assert.deepEqual((await settings()).ai, fields);
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
  assert.equal((await settings()).ai, null);
  console.log('AI translation passed setup, credentials, permissions, connection, reader, selection, and response validation.');
}

module.exports = {aiResponse, checkAiWorker, config, host};
