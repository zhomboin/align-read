const assert = require('node:assert/strict');

async function checkModeReuse({ evaluate, until }) {
  let session;
  let number = 0;
  const send = (message) => evaluate('readerCommand(' + JSON.stringify(message) + ')');
  const ready = (mode) => until(async () => {
    const state = await send({ type: 'reader:state' });
    if (state?.error) throw new Error(JSON.stringify(state));
    return state?.status === 'ready' && state.mode === mode;
  });
  const resetBatches = () => evaluate('replacementBatches.length = 0');
  const sent = () => evaluate('replacementBatches.flatMap(batch => batch.items.map(item => item.text))');

  async function open(mode, opts = {}, switching = false) {
    const previousSessionId = session?.id;
    session = {
      source: 'en', target: 'zh-CN', range: 'main', ratio: .5, highlight: true, syncScroll: true,
      cache: true, ...opts, id: 'reuse-' + ++number, mode, pageUrl: await evaluate('location.href')
    };
    const result = await send({ type: switching ? 'reader:switch-mode' : 'reader:start', previousSessionId, session });
    assert(result.ok, JSON.stringify(result));
    await ready(mode);
  }

  await evaluate(`history.replaceState(null, '', '/article'); document.body.innerHTML = '<main></main>';
    for (let n = 0; n < 780; n++) {
      const line = document.createElement('p');
      line.textContent = 'Paragraph number ' + n;
      document.querySelector('main').append(line);
    }`);
  await resetBatches();
  await open('dual');
  assert.equal((await sent()).length, 780);
  await resetBatches();
  await open('replace', {}, true);
  assert.deepEqual(await sent(), []);
  assert.equal(await evaluate('document.querySelector("main p").textContent'), '译 Paragraph number 0');
  await open('dual', {}, true);
  assert.deepEqual(await sent(), []);
  assert.equal(await evaluate('document.querySelector("main p").textContent'), 'Paragraph number 0');
  await send({ type: 'reader:stop' });

  // Dual merges adjacent plain text nodes. In-place mode keeps their insertion points.
  await evaluate(`document.querySelector('main p').replaceChildren(document.createTextNode('Separate parts'), document.createTextNode(' in one sentence'))`);
  await open('dual');
  await resetBatches();
  await open('replace', {}, true);
  assert.deepEqual((await sent()).sort(), ['Separate parts', 'in one sentence'].sort());
  await resetBatches();
  await open('dual', {}, true);
  assert.deepEqual(await sent(), []);
  await send({ type: 'reader:stop' });

  const fixture = '<main><p>Stable text</p><p id="changed">Old text</p><pre><code class="language-js">// Explain this line</code></pre></main>';
  await evaluate('document.body.innerHTML = ' + JSON.stringify(fixture));
  await open('dual');
  await resetBatches();
  await evaluate('document.querySelector("#changed").textContent = "Changed text"');
  await open('replace', { replaceComments: true }, true);
  assert.deepEqual((await sent()).sort(), ['Changed text', 'Explain this line'].sort());
  assert.equal(await evaluate('document.querySelector("code").textContent'), '// 译 Explain this line');

  await resetBatches();
  await open('dual', { target: 'ja' }, true);
  assert.deepEqual((await sent()).sort(), ['Changed text', 'Stable text'].sort());
  await send({ type: 'reader:clear-cache' });
  await resetBatches();
  await open('replace', { target: 'ja' }, true);
  assert.deepEqual((await sent()).sort(), ['Changed text', 'Stable text'].sort());
  await resetBatches();
  await open('dual', { target: 'ja', cache: false }, true);
  assert.deepEqual((await sent()).sort(), ['Changed text', 'Stable text'].sort());
  await send({ type: 'reader:stop' });

  await evaluate('document.body.innerHTML = "<main><p>Completed text</p></main>"');
  await open('dual');
  await evaluate(`replacementHeld.add('Unfinished text');
    document.querySelector('main').insertAdjacentHTML('beforeend','<p id="pending">Unfinished text</p>')`);
  const heldId = await until(() => evaluate('replacementBatches.find(b => b.items.some(i => i.text === "Unfinished text"))?.batchId'));
  await resetBatches();
  await open('replace', {}, true);
  assert.deepEqual(await sent(), ['Unfinished text']);
  await evaluate('replacementRelease.get(' + JSON.stringify(heldId) + ')()');
  assert.equal(await evaluate('document.querySelector("#pending").textContent'), '译 Unfinished text');
  await send({ type: 'reader:stop' });

  await evaluate('document.body.innerHTML = "<main><p>Same words</p></main>"');
  await open('dual');
  await resetBatches();
  await evaluate("history.pushState(null, '', '/different-article'); document.querySelector('main').innerHTML = '<p>Same words</p>'");
  await open('replace', {}, true);
  assert.deepEqual(await sent(), ['Same words']);
  await send({ type: 'reader:stop' });

  await evaluate("history.replaceState(null, '', '/signin')");
  await open('dual');
  await resetBatches();
  await open('replace', {}, true);
  assert.deepEqual(await sent(), ['Same words']);
  await send({ type: 'reader:stop' });

  console.log('Mode reuse passed: 780 completed paragraphs switched both ways without requests; only new, changed or unfinished text was sent.');
}

module.exports = { checkModeReuse };
