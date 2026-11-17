const assert = require('node:assert/strict');

const presets = {
  openai: ['https://api.openai.com/v1/chat/completions', 'gpt-5.4-mini',
    {response_format: {type: 'json_object'}, reasoning_effort: 'none'}],
  gemini: ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'gemini-3.1-flash-lite',
    {reasoning_effort: 'minimal'}],
  grok: ['https://api.x.ai/v1/chat/completions', 'grok-4.3', {reasoning_effort: 'none'}],
  glm: ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-5.3-flash',
    {thinking: {type: 'enabled'}, reasoning_effort: 'low'}, true],
  kimi: ['https://api.moonshot.cn/v1/chat/completions', 'kimi-k3', {reasoning_effort: 'low'}, true],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'doubao-seed-2-0-lite-260215',
    {thinking: {type: 'disabled'}}],
  hunyuan: ['https://tokenhub.tencentmaas.com/v1/chat/completions', 'hy3', {thinking: {type: 'disabled'}}],
};

async function checkAiPresets({request, dispatch, settings, tabs, grants, session, calls, setResponse}) {
  const save = (provider, config, authorized = true) => request({type: 'save-ai', provider, config, authorized});
  const test = (provider) => request({type: 'test-provider', provider});
  const tabId = 72;
  const url = 'https://article.example.test/reader';
  const documentId = 'ai-presets-doc';
  const sender = {tab: {id: tabId}, documentId, url, frameId: 0};
  const reading = {source: 'en', target: 'zh-CN', range: 'main'};
  tabs.set(tabId, {url, documentId});
  for (const [provider, [endpoint, model, options, stream = false]] of Object.entries(presets)) {
    const host = new URL(endpoint).origin + '/*';
    const apiKey = 'sample-' + provider + '-key';
    const fields = {endpoint, model};
    const count = calls.length;
    assert.equal((await settings()).aiServices[provider], null, provider);
    assert.deepEqual(await test(provider), {ok: false, error: 'not-configured'});
    for (const invalid of [
      new URL('/other/chat/completions', endpoint).href,
      'https://other.example.test/v1/chat/completions',
      endpoint + '?extra=sample',
    ]) {
      assert.deepEqual(await save(provider, {endpoint: invalid, model, apiKey}), {ok: false, error: 'ai-config'});
    }
    assert((await save(provider, {...fields, apiKey}, false)).ok);
    grants.add(host);
    assert.deepEqual(await test(provider), {ok: false, error: 'consent-required'});
    grants.delete(host);
    const saved = await save(provider, fields);
    assert(saved.ok);
    assert.deepEqual(saved.value.aiServices[provider], fields);
    assert(!JSON.stringify(saved.value).includes(apiKey));
    assert.deepEqual(await test(provider), {ok: false, error: 'consent-required'});
    assert.equal(calls.length, count);

    grants.add(host);
    assert.equal((await test(provider)).value.providers[provider].lastCheck.error, undefined, provider);
    const call = calls.at(-1);
    assert.equal(call.url, endpoint);
    assert.equal(call.options.headers.Authorization, 'Bearer ' + apiKey);
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    const {messages, ...body} = JSON.parse(call.options.body);
    assert.deepEqual(body, {model, stream, ...options});
    assert.deepEqual(JSON.parse(messages[1].content), {
      source: '英语', target: '简体中文', items: [{index: 0, text: 'Hello, world!'}],
    });

    const switched = await request({type: 'switch-provider', tabId, provider}, 'popup');
    assert.equal(switched.value.settings.provider, provider);
    assert((await request({type: 'start', tabId, provider, options: reading}, 'popup')).ok);
    const sessionId = session['reader:72'].session.id;
    const batch = () => dispatch({type: 'batch', sessionId, batchId: provider, items: [
      {id: 'first', text: 'First'}, {id: 'second', text: 'Second'},
    ]}, sender);
    assert.deepEqual(await batch(), {ok: true, value: {id: provider, items: [
      {id: 'second', text: '译 Second'}, {id: 'first', text: '译 First'},
    ]}});
    assert((await request({type: 'selection-start', tabId, provider, options: reading}, 'popup')).ok);
    assert.deepEqual(await dispatch({type: 'selection:translate', sessionId: session['selection:72'].session.id,
      requestId: provider, text: 'Selected'}, sender), {ok: true, value: '译 Selected'});

    for (const [mode, error] of [['auth', 'authentication'], ['rate-limit', 'rate-limit'], ['incomplete', 'invalid-response']]) {
      setResponse(mode);
      assert.equal((await test(provider)).value.providers[provider].lastCheck.error, error, provider);
    }
    if (stream) {
      setResponse('truncated-stream');
      assert.equal((await test(provider)).value.providers[provider].lastCheck.error, 'invalid-response');
    }
    setResponse('success');

    const customModel = provider === 'doubao' ? 'ep-example' : 'example-model';
    assert((await save(provider, {...fields, model: customModel})).ok);
    assert.equal((await settings()).providers[provider].lastCheck, null);
    assert.deepEqual(await batch(), {ok: false, error: 'stale'});
    assert.equal((await test(provider)).value.providers[provider].lastCheck.error, undefined);
    const {messages: _messages, ...customBody} = JSON.parse(calls.at(-1).options.body);
    assert.deepEqual(customBody, {model: customModel, stream});
  }

  const snapshot = await settings();
  for (const [provider, [endpoint]] of Object.entries(presets)) {
    assert.equal(snapshot.aiServices[provider].endpoint, endpoint);
    assert(snapshot.providers[provider].hostPermission);
  }
  await request({type: 'reset'});
  assert.equal(grants.size, 0);
  const reset = await settings();
  for (const provider of Object.keys(presets)) assert.equal(reset.aiServices[provider], null);
  console.log('Seven AI presets passed endpoint and key isolation, permissions, request formats, reader, selection, errors, and reset.');
}

module.exports = {checkAiPresets, presets};
