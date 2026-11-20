const assert = require('node:assert/strict');

async function checkPaper({ evaluate, until, replaceFixture, readerState, mode = 'dual' }) {
  const code = 'const value = "// literal"; // Explain the output\n/* Another note */\n';
  const python = 'print("# literal")  # Python note';
  const formula = '<math alttext="fraction"><mfrac><mi>x</mi><msup><mi>y</mi><mn>2</mn></msup></mfrac></math>';
  const svg = '<mjx-container><svg><g data-mml-node="math"><g data-mml-node="mi"><use data-c="1D465"></use></g></g></svg></mjx-container>';
  const tex = '\\(private_variable + q\\)';
  await replaceFixture('<main><p>Introductory prose ' + formula + ' after ' + svg + tex + '.</p>' +
    '<pre><code class="language-js">' + code + '</code></pre><pre><code class="language-python">' + python +
    '</code></pre><pre><code>foo // Ambiguous note</code></pre></main>');
  const stop = () => evaluate('readerCommand({type:"reader:stop"})');
  const original = await evaluate('document.querySelector("main").innerHTML');
  const pageUrl = mode === 'replace' ? await evaluate('location.href') : undefined;
  for (const enabled of [false, true]) {
    await evaluate(mode === 'dual' ? 'readerPayloads.length = 0' : 'replacementBatches.length = 0');
    const session = {
      id: 'paper-' + mode + enabled, source: 'en', target: 'zh-CN', range: 'main',
      mode, pageUrl, cache: false, ratio: .5, highlight: true, syncScroll: true,
      dualComments: mode === 'dual' && enabled, replaceComments: mode === 'replace' && enabled
    };
    const started = await evaluate('readerCommand(' + JSON.stringify({ type: 'reader:start', session }) + ')');
    assert(started.ok, mode + '/' + enabled + ' ' + JSON.stringify(started));
    await until(async () => (await readerState())?.status === 'ready');
    const texts = await evaluate(mode === 'dual' ? 'readerPayloads.flat()' : 'replacementBatches.flatMap(b => b.items.map(i => i.text))');
    assert(texts.includes('Introductory prose'));
    for (const note of ['Explain the output', 'Another note', 'Python note']) assert.equal(texts.includes(note), enabled);
    assert(!texts.some(text => /literal|const |foo|Ambiguous|private_variable|fraction|\/\*|\/\//.test(text)));
    const scope = mode === 'dual' ? 'pane.querySelector("article")' : 'document.querySelector("main")';
    assert(await evaluate(scope + '.querySelector("math mfrac msup") !== null'));
    if (mode === 'dual') assert(await evaluate(scope + '.textContent.includes("𝑥")'));
    assert((await evaluate(scope + '.textContent')).includes(tex));
    const result = await evaluate(scope + '.querySelector("pre").textContent');
    assert.equal(result, enabled ? code.replace('Explain the output', '译 Explain the output').replace('Another note', '译 Another note') : code);
    await stop();
    assert.equal(await evaluate('document.querySelector("main").innerHTML'), original);
  }
  console.log('Paper markup, literal TeX, code, optional comments, and exact restoration passed.');
}
module.exports = { checkPaper };
