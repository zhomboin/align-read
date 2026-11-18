const assert = require('node:assert/strict');
const {config: aiConfig, host: aiHost, deepseek, minimax, minimaxGlobal} = require('./ai-check.cjs');
const {presets} = require('./ai-presets-check.cjs');

async function checkSettings({page, evaluate, until, manifest, request, local, grants, setPermission, setResponse}) {
  const resize = (width) => page('Emulation.setDeviceMetricsOverride', {width, height: 850, deviceScaleFactor: 1, mobile: false});
  const noOverflow = () => evaluate('document.documentElement.scrollWidth <= innerWidth');
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const nav = async (category) => {
    const link = `.settings-nav a[href="#${category}"]`;
    await click(link);
    await until(() => evaluate(`document.querySelector(${JSON.stringify(link)}).getAttribute('aria-current') === 'page'`));
  };
  const provider = '#provider-editor';
  const status = 'document.querySelector(".connection-status")';
  const providerForm = 'document.querySelector(".provider-layout form")';
  const testButton = `${providerForm}.querySelector('button[type="button"]')`;
  const statusIncludes = (text) => evaluate(`${status}?.textContent.includes(${JSON.stringify(text)})`);
  const editProvider = (id) => evaluate(`fill(document.querySelector('${provider}'), ${JSON.stringify(id)}, 'change')`);
  const currentProvider = (name) => evaluate(`document.querySelector('.provider-current')?.textContent.includes(${JSON.stringify(name)})`);

  await request({type: 'reset'});
  await resize(220);
  await page('Page.navigate', {url: 'http://alignread.test/popup.html'});
  await until(() => evaluate('document.querySelector("header button")?.textContent === "设置"'));
  assert.equal(await evaluate('document.body.getBoundingClientRect().width'), 440);
  await resize(440);
  assert(await noOverflow());
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('body, .language-fields select'),
    (element) => getComputedStyle(element).backgroundColor)`), Array(4).fill('rgb(255, 255, 255)'));
  assert(await evaluate(`document.querySelector('header button').getBoundingClientRect().height < 50`));
  assert(await evaluate(`Array.from(document.querySelectorAll('.language-fields select'), (select) => select.offsetWidth)
    .every((width) => width >= 190)`));
  await click('header button');
  assert.equal(await evaluate('openedOptions'), 1);

  await resize(1200);
  await page('Page.navigate', {url: 'http://alignread.test/options.html'});
  await until(() => evaluate(`document.querySelector('header small')?.textContent.includes(${JSON.stringify(manifest.version)})`));
  await until(() => evaluate(`document.querySelector('${provider}')?.disabled === false`));
  assert(await evaluate('document.querySelector("main").getBoundingClientRect().width > 700'));
  assert(await evaluate('document.querySelector("main").offsetLeft > document.querySelector("header").getBoundingClientRect().right'));
  assert(await noOverflow());
  assert.equal(await evaluate('document.querySelectorAll("main select").length'), 1);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('body, .panel, .status-panel, ${provider}, input[type=password]'),
    (element) => getComputedStyle(element).backgroundColor)`), Array(5).fill('rgb(255, 255, 255)'));
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundImage'), 'none');
  assert(await statusIncludes('API 密钥'));
  assert(await evaluate('document.querySelector(".set-current-provider").disabled'));

  await editProvider('youdao');
  assert(await statusIncludes('应用 ID'));
  assert(await statusIncludes('未保存'));
  assert(await currentProvider('Google Cloud'));
  assert.equal(local.providerSettings.provider, 'google');
  await evaluate(`fill(${providerForm}.querySelector('input[type=text]'), 'ui-test-789012')`);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), 'ui-secret')`);
  await editProvider('google');
  assert(await statusIncludes('API 密钥'));
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), '');
  await editProvider('youdao');
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), 'ui-secret');
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => statusIncludes('尾号 9012'));
  assert(await statusIncludes('未授予'));
  assert(await evaluate(`${testButton}.disabled`));
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), '');
  assert.equal(local.providerSettings.youdao.appSecret, 'ui-secret');

  setPermission(true);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => evaluate(`!${testButton}.disabled`));
  await evaluate(`${testButton}.click()`);
  await until(() => statusIncludes('通过'));
  assert(await evaluate(`${status}.querySelector('time').dateTime !== ''`));
  await page('Page.reload');
  await until(() => evaluate(`document.querySelector('${provider}')?.disabled === false`));
  assert.equal(await evaluate(`document.querySelector('${provider}').value`), 'google');
  await editProvider('youdao');
  await until(() => statusIncludes('通过'));
  assert.equal(local.providerSettings.provider, 'google');
  await click('.set-current-provider');
  await until(() => currentProvider('有道智云'));
  assert.equal(local.providerSettings.provider, 'youdao');
  assert(await evaluate('document.querySelector(".set-current-provider").disabled'));

  setResponse('auth');
  await until(() => evaluate(`!${testButton}.disabled`));
  await evaluate(`${testButton}.click()`);
  await until(() => statusIncludes('翻译服务拒绝了请求'));
  await page('Page.reload');
  await until(() => statusIncludes('翻译服务拒绝了请求'));
  assert(!(await evaluate('document.body.textContent.includes("ui-secret")')));

  await resize(320);
  assert(await noOverflow());
  await nav('reading');
  await evaluate(`fill(document.querySelector('.language-fields label:nth-child(2) select'), 'ja', 'change')`);
  await evaluate('document.querySelector("#original-width").focus()');
  await page('Input.dispatchKeyEvent', {type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39});
  await page('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39});
  assert.equal(await evaluate('document.querySelector("#original-width").getAttribute("aria-valuetext")'), '51%');
  assert(await noOverflow());

  await nav('sites');
  await evaluate(`fill(document.querySelector('#disabled-sites'), 'example.test')`);
  await click('.cache-panel input');
  await click('button[type=submit]');
  await until(() => evaluate('document.querySelector("footer [role=status]").textContent.includes("已保存")'));
  assert.deepEqual(local.providerSettings.disabledSites, ['example.test']);
  assert.equal(local.providerSettings.cache, false);
  assert.equal(local.providerSettings.target, 'zh-CN');
  assert.equal(local.providerSettings.ratio, .5);
  assert(await noOverflow());

  await evaluate(`fill(document.querySelector('#disabled-sites'), 'draft.example.test')`);
  await nav('reading');
  assert.equal(await evaluate('document.querySelector(".language-fields label:nth-child(2) select").value'), 'ja');
  await click('button[type=submit]');
  await until(() => evaluate('document.querySelector("footer [role=status]").textContent.includes("已保存")'));
  assert.equal(local.providerSettings.target, 'ja');
  assert.equal(local.providerSettings.ratio, .51);
  assert.deepEqual(local.providerSettings.disabledSites, ['example.test']);
  await nav('sites');
  assert.equal(await evaluate('document.querySelector("#disabled-sites").value'), 'draft.example.test');

  await evaluate('window.confirm = () => false');
  await click('.reset');
  assert.equal(local.providerSettings.target, 'ja');
  await evaluate('window.confirm = () => true');
  await click('.reset');
  await until(() => evaluate('document.querySelector("footer [role=status]").textContent.includes("已恢复默认设置")'));
  assert.equal(await evaluate('document.querySelector("#disabled-sites").value'), '');
  assert.equal(local.providerSettings.target, 'zh-CN');
  assert.equal(local.providerSettings.youdao, null);
  setResponse('success');

  await nav('translation');
  await editProvider('ai');
  await evaluate(`fill(${providerForm}.querySelector('[name=endpoint]'), ${JSON.stringify(aiConfig.endpoint)})`);
  await evaluate(`fill(${providerForm}.querySelector('[name=model]'), ${JSON.stringify(aiConfig.model)})`);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), ${JSON.stringify(aiConfig.apiKey)})`);
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => statusIncludes('已保存'));
  assert.deepEqual([...grants], [aiHost]);
  assert(await noOverflow());
  await evaluate(`${testButton}.click()`);
  await until(() => statusIncludes('通过'));
  assert(await currentProvider('Google Cloud'));
  await click('.set-current-provider');
  await until(() => currentProvider('AI 翻译'));
  assert.equal(local.providerSettings.provider, 'ai');
  await page('Page.reload');
  await until(() => statusIncludes('通过'));
  assert.equal(await evaluate(`${providerForm}.querySelector('[name=endpoint]').value`), aiConfig.endpoint);
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), '');
  await click('button.destructive');
  await until(() => statusIncludes('未保存'));
  assert(!grants.has(aiHost));

  await editProvider('deepseek');
  assert(await evaluate(`${providerForm}.querySelector('[name=endpoint]').readOnly`));
  assert.equal(await evaluate(`${providerForm}.querySelector('[name=endpoint]').value`), deepseek.endpoint);
  assert.equal(await evaluate(`${providerForm}.querySelector('[name=model]').value`), deepseek.model);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), ${JSON.stringify(deepseek.apiKey)})`);
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => statusIncludes('已保存'));
  await editProvider('minimax');
  assert.equal(await evaluate(`${providerForm}.querySelector('[name=endpoint]').value`), minimax.endpoint);
  assert.equal(await evaluate(`${providerForm}.querySelector('[name=model]').value`), minimax.model);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), ${JSON.stringify(minimax.apiKey)})`);
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`fill(${providerForm}.querySelector('[name=endpoint]'), ${JSON.stringify(minimaxGlobal)}, 'change')`);
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), '');
  assert.equal(await evaluate(`${providerForm}.querySelector('input[type=checkbox]').checked`), false);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), ${JSON.stringify(minimax.apiKey)})`);
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => statusIncludes('已保存'));
  assert.deepEqual([...grants], ['https://api.deepseek.com/*', 'https://api.minimax.io/*']);
  for (const [provider, [endpoint, model]] of Object.entries(presets)) {
    await editProvider(provider);
    assert(await evaluate(`${providerForm}.querySelector('[name=endpoint]').readOnly`));
    assert.equal(await evaluate(`${providerForm}.querySelector('[name=endpoint]').value`), endpoint);
    assert.equal(await evaluate(`${providerForm}.querySelector('[name=model]').value`), model);
    assert.equal(await evaluate(`${providerForm}.querySelector('input[type=password]').value`), '');
  }
  await editProvider('doubao');
  await evaluate(`fill(${providerForm}.querySelector('[name=model]'), 'ep-example')`);
  await evaluate(`fill(${providerForm}.querySelector('input[type=password]'), 'sample-doubao-ui-key')`);
  await evaluate(`${providerForm}.querySelector('input[type=checkbox]').click()`);
  await evaluate(`${providerForm}.querySelector('button[type=submit]').click()`);
  await until(() => statusIncludes('已保存'));
  assert(grants.has(new URL(presets.doubao[0]).origin + '/*'));
  assert.equal(local.providerSettings.aiServices.doubao.model, 'ep-example');
  await evaluate(`${testButton}.click()`);
  await until(() => statusIncludes('通过'));
  await click('.set-current-provider');
  await until(() => currentProvider('豆包'));
  assert.equal(local.providerSettings.provider, 'doubao');
  assert(await noOverflow());
  await request({type: 'reset'});
  console.log('Built settings passed popup entry, desktop and narrow layouts, permission and connection feedback, scoped saves, keyboard input, and reset.');
}

module.exports = {checkSettings};
