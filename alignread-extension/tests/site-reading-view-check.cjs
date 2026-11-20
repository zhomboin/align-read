const assert = require('node:assert/strict');

const background = '<main><p>Underlying page only</p></main>';
const paper = '<article><h1>Foreground paper</h1><p>Reader text only</p><p><math><mi>x</mi></math></p>' +
  '<form><p>Private form text</p></form><div role="dialog"><p>Nested dialog text</p></div></article>';

async function checkSiteReadingView({ evaluate, until, page, replaceFixture, startLayout, readerState }) {
  const stop = () => evaluate('readerCommand({type:"reader:stop"})');
  const payload = () => evaluate('readerPayloads.flat()');
  async function ready() {
    return until(async () => {
      const state = await readerState();
      if (state?.error) throw Error(JSON.stringify(state));
      return state?.status === 'ready' && state.total > 0;
    });
  }


  await stop();
  await replaceFixture('<body><nav>Navigation outside the paper</nav>' + paper + '</body>');
  await evaluate('document.documentElement.dataset.readingMode="enabled"; readerPayloads.length=0');
  assert((await startLayout('site-paper', 'visible')).ok);
  await ready();
  assert.deepEqual(await payload(), ['Foreground paper', 'Reader text only']);
  assert(await evaluate('!!pane.querySelector("math")'));
  await evaluate('document.documentElement.dataset.readingMode="disabled"');
  await until(() => evaluate('pane.textContent.includes("译 Navigation outside the paper")'));
  await stop();
  await evaluate('delete document.documentElement.dataset.readingMode');

  for (const variant of ['dialog', 'fixed', 'fullscreen']) {
    const tag = variant === 'dialog' ? 'dialog' : 'div';
    const attributes = variant === 'fixed' ? 'role="dialog" style="position:fixed;inset:0;background:white"' : '';
    await replaceFixture(background + '<' + tag + ' id="reading" aria-label="Reading mode" ' + attributes + '>' +
      paper + '</' + tag + '>');
    if (variant === 'dialog') await evaluate('reading.showModal()');
    if (variant === 'fullscreen') {
      const result = await page('Runtime.evaluate', { expression: 'reading.requestFullscreen()', awaitPromise: true, userGesture: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    }
    await evaluate('readerPayloads.length=0');
    assert((await startLayout('reading-' + variant, 'visible')).ok);
    await ready();
    assert.deepEqual(await payload(), ['Foreground paper', 'Reader text only']);
    const layout = await evaluate(`{
      const host = pane.host;
      const left = document.querySelector('[data-alignread-source]').getBoundingClientRect();
      const right = host.getBoundingClientRect();
      ({ mounted: reading.contains(host) && host.matches(':popover-open'),
        clickable: document.elementFromPoint(right.x + 35, 40) === host,
        adjacent: Math.abs(left.right - right.left) < 2, original: getComputedStyle(document.body).position });
    }`);
    assert.deepEqual(layout, { mounted: true, clickable: true, adjacent: true, original: 'static' }, variant);
    if (variant === 'dialog') {
      await evaluate('reading.close()');
      await until(async () => (await readerState())?.error === 'reading-view-changed');
      assert.deepEqual(await payload(), ['Foreground paper', 'Reader text only']);
    } else {
      await stop();
      if (variant === 'fullscreen') await evaluate('document.exitFullscreen()');
    }
    assert(await evaluate('!document.querySelector("[data-alignread-source]") && !document.adoptedStyleSheets.length'));
  }

  await replaceFixture(background + '<dialog id="reading" aria-labelledby="title"><h2 id="title">Reading mode</h2><iframe></iframe></dialog>');
  await evaluate('reading.showModal(); readerPayloads.length=0');
  const blocked = await startLayout('isolated-reading-view', 'visible');
  assert.equal(blocked.error, 'reading-view-unavailable');
  assert.deepEqual(await payload(), []);
  await evaluate('reading.close()');
  console.log('Website reading modes passed for article pages, modal, fixed and fullscreen readers, protected regions and restoration.');
}

async function checkSiteReadingReplacement({ evaluate, until }) {
  await evaluate("history.replaceState(null, '', '/reading-test')");
  await evaluate('document.body.innerHTML=' + JSON.stringify(background + '<dialog id="reading" aria-label="阅读模式">' + paper + '</dialog>'));
  await evaluate('reading.showModal(); replacementBatches.length=0');
  const result = await evaluate('readerCommand({type:"reader:start",session:{id:"reading-replace",mode:"replace",range:"visible",source:"en",target:"zh-CN",cache:true,pageUrl:location.href}})');
  assert(result.ok, JSON.stringify(result));
  await until(() => evaluate('reading.querySelector("article p").textContent === "译 Reader text only"'));
  assert.equal(await evaluate('document.querySelector("main").textContent'), 'Underlying page only');
  assert.deepEqual(await evaluate('replacementBatches.flatMap(b => b.items.map(i => i.text))'), ['Foreground paper', 'Reader text only']);
  await evaluate('readerCommand({type:"reader:stop"})');
  assert.equal(await evaluate('reading.querySelector("article p").textContent'), 'Reader text only');
  await evaluate('reading.close()');
}

module.exports = { checkSiteReadingView, checkSiteReadingReplacement };
