const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkBilingualReading({ page, evaluate, until, build }) {
  const send = message => evaluate('readerCommand(' + JSON.stringify(message) + ')');
  const ready = mode => until(async () => {
    const state = await send({ type: 'reader:state' });
    return state?.mode === mode && state.status === 'ready';
  });
  const fixture = `<nav>Only navigation</nav><main>
    <p id="manual">Already translated manually.</p><p id="ordinary">First sentence. Another sentence.</p>
    <p id="mixed">Please read <a href="#ordinary">the guide</a> and <code>SELECT</code>.</p>
    <p id="duplicate">Same phrase. Same phrase.</p><p id="ambiguous">Joined text. Different text.</p>
    <p id="formatted"> Leading text. Another   indented   sentence. </p>
    <math><mi>protected equation</mi></math><pre>protected code</pre><p translate="no">protected exclusion</p><p hidden>protected secret</p>
    <div contenteditable>protected editor</div><p id="fail">Retry this paragraph</p></main>`;
  await evaluate(`history.replaceState(null, '', '/bilingual');
    document.body.innerHTML = ${JSON.stringify(fixture)};
    replacementBatches.length = 0;
    const roots = new WeakMap();
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {
      const shadow = attach.call(this, options);
      roots.set(this, shadow);
      return shadow;
    };
    window.row = id => roots.get(document.querySelector('#' + id)?.querySelector('[data-alignread-paragraph]'));
    const previous = chrome.runtime.sendMessage;
    let failOnce = true;
    chrome.runtime.sendMessage = async m => {
      if (m.type === 'paragraph:translate') return {ok:true, value:'手动译文'};
      const result = await previous(m);
      if (m.type === 'batch') {
        result.value.items = result.value.items.flatMap(item => {
          const source = m.items.find(i => i.id === item.id).text;
          if (source === 'Retry this paragraph' && failOnce) { failOnce = false; return []; }
          if (source === 'Joined text.') return [{...item, text:'第一句。第二句。'}];
          return [item];
        }).reverse();
      }
      return result;
    };
    chrome.runtime.onMessage.addListener = listener => {
      window.manualCommand = message => new Promise(resolve => listener(message, {id: chrome.runtime.id}, resolve));
    };`);
  await evaluate(fs.readFileSync(path.join(build, 'paragraph.js'), 'utf8'));
  await evaluate(`manualCommand({type:'paragraph:start', session:{id:'manual',source:'en',target:'zh-CN',shortcut:'F8'}})`);
  await evaluate(`const range = new Range(); range.selectNodeContents(document.querySelector('#manual'));
    getSelection().removeAllRanges(); getSelection().addRange(range);`);
  const f8 = { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119 };
  await page('Input.dispatchKeyEvent', { type: 'keyDown', ...f8 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', ...f8 });
  await until(() => evaluate("!!document.querySelector('#manual + [data-alignread-paragraph]')"));
  await page('Emulation.setDeviceMetricsOverride', { width: 420, height: 700, deviceScaleFactor: 1, mobile: false });
  const session = {
    id: 'full', mode: 'bilingual', range: 'main', source: 'en', target: 'zh-CN',
    ratio: .5, syncScroll: true, highlight: true, cache: true, pageUrl: await evaluate('location.href')
  };
  assert((await send({ type: 'reader:start', session })).ok);
  await until(() => evaluate("row('fail')?.querySelector('.feedback')?.dataset.state === 'error'"));
  assert.equal(await evaluate("row('manual').querySelector('[role=status]').textContent"), '手动译文');
  assert.equal(await evaluate("document.querySelectorAll('[data-alignread-paragraph]').length"), 7);
  const sent = () => evaluate('replacementBatches.flatMap(b => b.items.map(i => i.text))');
  assert(!(await sent()).some(text => /protected|Already translated manually|Only navigation|SELECT/.test(text)));
  assert.equal(await evaluate("document.querySelector('#mixed a').getAttribute('href')"), '#ordinary');
  assert((await evaluate("row('mixed').querySelector('[role=status]').textContent")).includes('SELECT'));
  await evaluate("row('fail').querySelector('button').focus()");
  const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
  await page('Input.dispatchKeyEvent', { type: 'keyDown', ...enter, text: '\r', unmodifiedText: '\r' });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
  await ready('bilingual');
  await evaluate(`replacementBatches.length = 0;
    document.querySelector('#ordinary').firstChild.data = 'Updated first. Another sentence.';
    document.querySelector('main').insertAdjacentHTML('beforeend','<p id="added">Added paragraph</p>');`);
  await until(() => evaluate("row('added')?.querySelector('[role=status]').textContent.includes('译 Added paragraph')"));
  assert.deepEqual((await sent()).sort(), ['Added paragraph', 'Updated first. Another sentence.'].sort());
  await page('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
  assert((await send({ type: 'reader:switch-mode', previousSessionId: 'full', session: { ...session, id: 'sentences', mode: 'dual' } })).ok);
  await ready('dual');
  assert.equal(await evaluate("document.querySelectorAll('[data-alignread-paragraph]').length"), 0);
  const selection = (text, index, last = index) => evaluate(`{
    const scroll = readerControl('.scroll');
    const block = [...scroll.querySelectorAll('p[data-reader-block]')].find(el => el.textContent.includes(${JSON.stringify(text)}));
    const start = block.children[${index}].firstChild;
    const end = block.children[${last}].firstChild;
    const sel = scroll.getRootNode().getSelection();
    sel.setBaseAndExtent(start,0,end,end.length);
    block.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    block.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    ({source:[...CSS.highlights.get('alignread-paragraph')].map(r => r.toString()).join(''), selected:sel.toString()});
  }`);
  const precise = await selection('Updated first', 1);
  assert.equal(precise.source, 'Another sentence.');
  assert(precise.selected.includes('Another sentence.'));
  assert.equal((await selection('Updated first', 0, 1)).source, 'Updated first. Another sentence.');
  assert.equal((await selection('Same phrase', 1)).source, 'Same phrase. Same phrase.');
  assert.equal((await selection('Different text', 0)).source, 'Joined text. Different text.');
  assert.equal((await selection('Leading text', 1)).source, 'Another   indented   sentence.');
  await send({ type: 'reader:stop' });
  await evaluate("getSelection().removeAllRanges(); replacementHeld.add('Held until close'); document.querySelector('main').innerHTML='<p>Held until close</p>'");
  assert((await send({ type: 'reader:start', session: { ...session, id: 'late' } })).ok);
  const batch = await until(() => evaluate("replacementBatches.find(b => b.items.some(i => i.text === 'Held until close'))?.batchId"));
  await send({ type: 'reader:stop' });
  await evaluate('replacementRelease.get(' + JSON.stringify(batch) + ')()');
  assert.equal(await evaluate("document.querySelectorAll('[data-alignread-paragraph],[data-alignread-host]').length"), 0);
  await evaluate("manualCommand({type:'paragraph:stop'})");
  await evaluate(`document.querySelector('main').innerHTML = Array.from({length: 70}, (_, n) =>
    '<p style="min-height:80px" id="part' + n + '">Viewport paragraph ' + n + '</p>').join('');
    document.querySelector('#part50').scrollIntoView();
    replacementBatches.length = 0;`);
  assert((await send({ type: 'reader:start', session: { ...session, id: 'viewport' } })).ok);
  await ready('bilingual');
  const firstBatch = await evaluate('replacementBatches[0].items.map(i => i.text)');
  assert(firstBatch.includes('Viewport paragraph 50') && !firstBatch.includes('Viewport paragraph 0'));
  await evaluate(`history.pushState(null, '', '/new-article');
    document.querySelector('main').innerHTML = '<p id="incoming">New article text</p>';`);
  await until(() => evaluate("row('incoming')?.querySelector('[role=status]').textContent === '译 New article text'"));
  assert.equal(await evaluate("document.querySelectorAll('[data-alignread-paragraph]').length"), 1);
  await evaluate("history.pushState(null, '', '/signin')");
  await until(async () => (await send({ type: 'reader:state' }))?.error === 'sensitive-site');
  assert.equal(await evaluate("document.querySelectorAll('[data-alignread-paragraph]').length"), 0);
  console.log('整页段落双语、选段复用、动态更新、单段重试、迟到响应、句子定位与回退通过。');
}

module.exports = { checkBilingualReading };
