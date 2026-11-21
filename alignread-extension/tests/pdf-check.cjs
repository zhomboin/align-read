const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const { fixturePdf } = require('./pdf-fixture.cjs');

function mockViewer(origin) {
  if (location.origin !== origin) return;
  if (location.pathname === '/popup.html') {
    const url = location.origin + '/fixture.pdf';
    chrome.tabs.query = async () => [location.search
      ? { id: 9, pendingUrl: url, status: 'loading' }
      : { id: 9, url, status: 'complete' }];
    chrome.tabs.create = () => { throw new Error('Unexpected new tab'); };
    chrome.sidePanel = {
      setOptions: async options => { window.panelOptions = options; },
      open: async options => { window.panelOpened = options; },
    };
    return;
  }
  if (location.pathname !== '/pdf.html') return;
  window.pdfBatches = [];
  const params = new URLSearchParams(location.search);
  const fileUrl = 'file:///fixture.pdf';
  const fixtureUrl = location.origin + (params.get('path') || '/fixture.pdf');
  const sourceUrl = fixtureUrl + (params.has('start') ? '#page=' + params.get('start') : '');
  let tab = params.has('pending') ? { pendingUrl: fixtureUrl, status: 'loading' } :
    { url: params.has('local') ? fileUrl : sourceUrl, status: 'complete' };
  chrome.tabs.get = async () => tab;
  const tabListeners = new Set();
  window.updatePdfTab = (change, next = {}) => {
    tab = { ...tab, ...change, ...next };
    for (const listener of tabListeners) listener(9, change, tab);
  };
  chrome.tabs.onUpdated = {
    addListener(fn) { tabListeners.add(fn); window.pdfTabWatching = true; },
    removeListener(fn) { tabListeners.delete(fn); },
  };
  chrome.sidePanel = { async setOptions(options) { window.panelOptions = options; } };
  chrome.extension = { async isAllowedFileSchemeAccess() { return params.get('local') === 'allow'; } };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (String(url) === fileUrl) { window.fileRead = true; url = '/whole.pdf'; }
    return open.call(this, method, url, ...args);
  };
  const nativeFetch = window.fetch;
  window.fetch = (input, init) => {
    if (params.has('hold-pdf') && String(input) === fixtureUrl && !window.pdfFetchStarted) {
      window.pdfFetchStarted = true;
      return new Promise((resolve, reject) => {
        window.releasePdfFetch = () => nativeFetch(input, init).then(resolve, reject);
      });
    }
    if (String(input) === fileUrl) {
      window.fileRead = true;
      window.localSlices = (window.localSlices ?? 0) + 1;
      return nativeFetch('/fixture.pdf', init).then(response => new Response(response.body, { status: 200 }));
    }
    return nativeFetch(input, init);
  };
  const settings = {
    ok: true, value: {
      provider: 'google', source: 'en', target: 'zh-CN', disabledSites: params.has('disabled-site') ? [location.hostname] : [],
      providers: { google: { configured: true, consent: true, hostPermission: true } }
    }
  };
  chrome.runtime.sendMessage = async () => {
    if (params.has('hold-settings') && !window.pdfSettingsReleased) {
      await new Promise(resolve => {
        window.releasePdfSettings = () => { window.pdfSettingsReleased = true; resolve(); };
      });
    }
    return settings;
  };
  chrome.storage = { onChanged: { addListener(callback) { window.pdfSettingsChanged = callback; } } };
  chrome.runtime.connect = () => {
    let receive;
    return {
      onDisconnect: { addListener() { } },
      onMessage: { addListener(fn) { receive = fn; } },
      disconnect() { window.pdfDisconnects = (window.pdfDisconnects ?? 0) + 1; },
      postMessage({ id, items }) {
        pdfBatches.push(items);
        const batch = {
          ok: true, value: {
            id, items: items.map(item => ({
              id: item.id,
              text: window.pdfEcho && item.text.includes('Research for AI + Science')
                ? window.pdfEcho === 'repeat' ? '重复译文'.repeat(9) : item.text
                : params.has('reorder') && item.text.startsWith('Let [[ARF0]]') ? '译 先 [[ARF1]]，再 [[ARF0]]'
                  : '译 ' + (params.has('fallback') ? item.text.replace(/\[\[ARF\d+\]\]/g, '') : item.text),
            }))
          },
        };
        if (window.pdfHold === true || items.some(item => item.text === window.pdfHold)) {
          window.pdfRelease = () => receive(batch);
          return;
        }
        if (window.pdfFail) { window.pdfFail = false; receive({ ok: false, error: 'network' }); return; }
        receive(batch);
      }
    };
  };
}

async function checkPdfBrowser({ page, evaluate, until, build }) {
  const root = path.resolve(build);
  const pdf = Buffer.from(fixturePdf());
  const ranges = [];
  const fullReads = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (['/fixture.pdf', '/bad.pdf', '/range-rejected.pdf', '/unreadable.pdf'].includes(route)) {
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
        if (!range) {
          fullReads.set(route, (fullReads.get(route) ?? 0) + 1);
          if (route === '/unreadable.pdf') res.writeHead(503).end();
          else res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf);
          return;
        }
        if (route === '/range-rejected.pdf') {
          res.writeHead(416, { 'Content-Range': 'bytes */' + pdf.length }).end();
          return;
        }
        const start = Number(range[1]), end = Math.min(pdf.length - 1, Number(range[2]));
        ranges.push([start, end]);
        const body = pdf.subarray(start, end + 1);
        res.writeHead(206, {
          'Content-Type': 'application/pdf',
          'Content-Range': 'bytes ' + (['/bad.pdf', '/unreadable.pdf'].includes(route) && start ? 0 : start) + '-' + end + '/' + pdf.length,
          'Content-Length': body.length,
        }).end(body);
        return;
      }
      if (route === '/whole.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length }).end(pdf); return; }
      const file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
      const body = await fs.readFile(file);
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    await page('Page.addScriptToEvaluateOnNewDocument', { source: '(' + mockViewer + ')(' + JSON.stringify(base) + ')' });
    const navigate = suffix => page('Page.navigate', { url: base + suffix });
    const hasStatus = async message => {
      try { await until(() => evaluate('document.querySelector("#status")?.textContent.includes(' + JSON.stringify(message) + ')')); }
      catch { throw new Error('Expected ' + message + ', got ' + await evaluate('document.querySelector("#status")?.textContent')); }
    };
    const pageNumberAligned = (label, direction) => evaluate(`(() => {
      const number = document.querySelector('.pdf-sheet[aria-current] .pdf-page-number');
      const ink = number?.querySelector('canvas');
      if (ink?.ariaLabel !== ${JSON.stringify(label)} || getComputedStyle(number).textAlign !== '${direction}') return false;
      const line = number.getBoundingClientRect();
      const glyph = ink.getBoundingClientRect();
      if ('${direction}' === 'left') return Math.abs(line.left - glyph.left) < 1;
      if ('${direction}' === 'right') return Math.abs(line.right - glyph.right) < 1;
      return Math.abs(line.left + line.right - glyph.left - glyph.right) < 2;
    })()`);
    const wheelToward = async (number, lead = 0) => {
      const location = await evaluate(`(() => {
        const viewer = document.querySelector('#viewer');
        const target = document.querySelector('.pdf-sheet[data-page="${number}"]');
        const rect = viewer.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
          deltaY: target.offsetTop - viewer.scrollTop - viewer.clientHeight * ${lead}
        };
      })()`);
      await page('Input.dispatchMouseEvent', { type: 'mouseWheel', ...location, deltaX: 0 });
    };
    for (const suffix of ['', '?pending=1']) {
      await navigate('/popup.html' + suffix);
      const action = 'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "在此页对照翻译")';
      await until(() => evaluate('window.panelOptions?.path === "pdf.html#9" && (' + action + ')?.disabled === false'));
      await evaluate(action + '.click()');
      assert.deepEqual(await evaluate('window.panelOpened'), { tabId: 9 });
    }
    await navigate('/pdf.html?hold-pdf=1#9');
    await until(() => evaluate('window.pdfFetchStarted'));
    await evaluate('updatePdfTab({ status: "loading" }, { pendingUrl: location.origin + "/other" }); releasePdfFetch()');
    await hasStatus('第 1 页已就绪');
    assert(await evaluate('!document.querySelector("#viewer").hidden && !window.panelOptions'));
    await navigate('/pdf.html?pending=1&hold-settings=1&hold-pdf=1#9');
    await until(() => evaluate('window.pdfTabWatching && window.releasePdfSettings !== undefined'));
    await evaluate('updatePdfTab({ url: location.origin + "/fixture.pdf", status: "loading" }, { pendingUrl: undefined })');
    await until(() => evaluate('window.pdfFetchStarted'));
    await evaluate('updatePdfTab({ url: location.origin + "/fixture.pdf#page=4" }); releasePdfFetch()');
    await hasStatus('第 4 页已就绪');
    assert(await evaluate('document.querySelector("#translate").disabled && pdfBatches.length === 0'));
    await evaluate('releasePdfSettings()');
    await until(() => evaluate('!document.querySelector("#translate").disabled'));
    await navigate('/pdf.html?hold-settings=1&disabled-site=1#9');
    await hasStatus('第 1 页已就绪');
    await evaluate('releasePdfSettings()');
    await hasStatus('此站点已在设置中禁用');
    assert(await evaluate('document.querySelector("#translate").disabled && pdfBatches.length === 0'));
    await evaluate('updatePdfTab({ status: "loading" }, { url: undefined })');
    assert(await evaluate('!document.querySelector("#viewer").hidden && !window.panelOptions'));
    await evaluate('updatePdfTab({ status: "complete" })');
    await hasStatus('标签页已更新');
    assert(await evaluate('document.querySelector("#viewer").hidden && window.panelOptions.enabled === false'));
    ranges.length = 0;
    await navigate('/pdf.html#9');
    await until(() => evaluate('document.querySelector("#status")?.textContent.includes("第 1 页已就绪")'));
    assert.equal(await evaluate('document.querySelector("#total").textContent'), '/ 5');
    assert(await evaluate('!document.querySelector(".pdf-original canvas") && !!document.querySelector(".pdf-sheet[aria-current] .pdf-translation canvas[aria-label=\\"x = 2\\"]")'));
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation p > canvas")].map(canvas => canvas.ariaLabel)'),
      ['x = 2', '公式 (1.1)', '1']);
    assert(await pageNumberAligned('1', 'center'));
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation .pdf-inline-math")].map(node=>node.textContent || node.querySelector("canvas")?.ariaLabel)'),
      ['f(x)', '102', 'a + b', 'c + d']);
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-equation canvas[aria-label=\\"公式 (1.1)\\"]").height > 60 && !document.querySelector(".pdf-sheet[aria-current] .pdf-translation .pdf-columns")'));
    assert.deepEqual(await evaluate('pdfBatches'), []);
    assert(ranges.length >= 2 && ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0) < pdf.length / 2, JSON.stringify(ranges));
    await evaluate('window.pdfHold = true; document.querySelector("#translate").click()');
    await until(() => evaluate('pdfBatches.length === 1'));
    await evaluate('document.querySelector("#cancel").click(); window.pdfRelease(); window.pdfHold = false');
    await hasStatus('已停止');
    assert(!(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("译 ")')));
    await evaluate('window.pdfFail = true; document.querySelector("#translate").click()');
    await until(() => evaluate('pdfBatches.length === 2 && !document.querySelector("#translate").disabled'));
    await evaluate('document.querySelector("#translate").click()');
    const left = 'Inside the left column continues here.';
    const right = 'Inside the right column finishes here.';
    const caption = 'Figure 1: Comparison of both columns.';
    await until(() => evaluate('pdfBatches.length === 4 && document.querySelector("#cancel").textContent === "停止预译"'));
    const firstPage = ['function [[ARF0]] is smooth on this interval.', 'function parametrized as a spline.', 'Research for AI + Science remains useful.',
      'The result is [[ARF0]] with modest error.', 'Ordinary prose', 'Let [[ARF0]] and [[ARF1]] be positive'];
    assert.deepEqual(await evaluate('pdfBatches.map(b => b.map(i => i.text))'), [
      ...Array(3).fill(firstPage), ['2 Article title', left, right, '2.1 Closing note', caption],
    ]);
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("译 Ordinary prose")'));
    await evaluate('window.pdfHold = "Fourth page prose above the enclosed table."');
    await until(() => evaluate('Boolean(document.querySelector(".pdf-sheet[data-page=\\"2\\"] .pdf-translation"))'));
    await wheelToward(2, .42);
    await until(() => evaluate(`(() => {
      const viewer = document.querySelector('#viewer').getBoundingClientRect();
      const one = document.querySelector('.pdf-sheet[data-page="1"]').getBoundingClientRect();
      const two = document.querySelector('.pdf-sheet[data-page="2"]').getBoundingClientRect();
      return one.bottom > viewer.top && two.top < viewer.bottom;
    })()`));
    assert.equal(await evaluate('document.querySelector("#page").value'), '1');
    await wheelToward(2);
    await hasStatus('OCR');
    assert.equal(await evaluate('document.querySelector("#page").value'), '2');
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-page-number") === null'));
    await hasStatus('正在预译第 4 页');
    await evaluate('document.querySelector("#next").click()');
    await hasStatus('第 3 页翻译完成');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation .pdf-columns > div")].map(el => el.textContent)'), ['译 ' + left, '译 ' + right]);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-columns > div")].map(el => el.querySelector(".pdf-equation canvas")?.ariaLabel)'),
      ['公式 (2.1)', '公式 (2.2)']);
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation > div:first-child").textContent.includes("译 2 Article title")'));
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation .pdf-section")].map(node => [node.tagName, node.textContent, getComputedStyle(node).fontWeight])'),
      [['H3', '译 2 Article title', '700'], ['H4', '译 2.1 Closing note', '700']]);
    assert(await evaluate('document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation .pdf-figure canvas").length === 1'));
    assert(await evaluate('(() => { const blocks = [...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation p")]; const i = blocks.findIndex(block => block.matches(".pdf-figure")); return blocks[i + 1]?.textContent.includes("译 Figure 1"); })()'));
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-columns > div:nth-child(2)").getBoundingClientRect().left > document.querySelector(".pdf-sheet[aria-current] .pdf-columns > div").getBoundingClientRect().right'));
    await evaluate('document.querySelector("#page").value = "5"; document.querySelector("#page").dispatchEvent(new Event("change"))');
    await hasStatus('第 5 页翻译完成');
    assert(await pageNumberAligned('v', 'right'));
    const placements = await evaluate(`(() => {
      const equations = [...document.querySelectorAll('.pdf-sheet[aria-current] .pdf-equation canvas')];
      return equations.map(canvas => {
        const row = canvas.parentElement.getBoundingClientRect();
        const box = canvas.getBoundingClientRect();
        return { label: canvas.ariaLabel, height: canvas.height, start: (box.left - row.left) / row.width, end: (box.right - row.left) / row.width };
      });
    })()`);
    assert.deepEqual(placements.map(equation => equation.label), ['x = 7', '公式 (5.1)', 'z = 3', '公式 (5.2)']);
    assert(placements[0].start < .03 && placements[1].start > .32 && placements[1].start < .42 &&
      placements[1].end > .95 && placements[2].start > .85, JSON.stringify(placements));
    assert(placements[3].start < .03 && placements[3].end > .93 && placements[3].height > 80, JSON.stringify(placements[3]));
    const fractionParagraph = await evaluate(`(() => {
      const paragraph = [...document.querySelectorAll('.pdf-sheet[aria-current] .pdf-translation p')]
        .find(node => node.textContent.includes('Before the fraction'));
      const canvases = [...paragraph?.querySelectorAll('.pdf-inline-math canvas') ?? []];
      const canvas = canvases[0];
      const pixels = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data ?? [];
      let neighboringInk = 0;
      let denominatorInk = 0;
      let barInk = 0;
      let darkRun = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const row = Math.floor(i / (4 * canvas.width));
        const column = i / 4 % canvas.width;
        const dark = pixels[i + 3] > 200 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 160;
        darkRun = dark ? (column === 0 ? 1 : darkRun + 1) : 0;
        barInk = Math.max(barInk, darkRun);
        if (pixels[i + 3] <= 200) continue;
        if (pixels[i] > 220 && pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) > 125) neighboringInk++;
        if (row > canvas.height * .76 && column > canvas.width * .45 && dark) denominatorInk++;
      }
      const after = canvases[0]?.parentElement.nextSibling;
      const range = document.createRange();
      let continuesInline = false;
      if (after?.nodeType === Node.TEXT_NODE && after.textContent.includes('and')) {
        const start = after.textContent.indexOf('and');
        range.setStart(after, start);
        range.setEnd(after, start + 3);
        const text = range.getBoundingClientRect();
        const formula = canvases[0].getBoundingClientRect();
        continuesInline = text.top < formula.bottom && text.bottom > formula.top;
      }
      return { text: paragraph?.textContent, formulas: canvases.map(canvas => canvas.ariaLabel), continuesInline, neighboringInk, denominatorInk, barInk };
    })()`);
    assert.equal(fractionParagraph.formulas.length, 1);
    assert(fractionParagraph.formulas[0].includes('u + v') && fractionParagraph.formulas[0].includes('1 + uv'), JSON.stringify(fractionParagraph));
    assert(fractionParagraph.text.includes('and its value stays finite. The explanation continues in the same paragraph.'));
    assert(fractionParagraph.continuesInline);
    assert.equal(fractionParagraph.neighboringInk, 0);
    assert(fractionParagraph.denominatorInk > 8);
    assert(fractionParagraph.barInk >= 47);
    await evaluate('window.pdfRelease()');
    await wheelToward(1);
    await hasStatus('第 1 页翻译完成');
    assert.equal(await evaluate('pdfBatches.length'), 6);
    await evaluate('document.querySelector("#target").value = "ja"; document.querySelector("#target").dispatchEvent(new Event("change"))');
    await hasStatus('语言已更新');
    assert(!(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("译 ")')));
    assert.equal(await evaluate('pdfBatches.length'), 6);
    await evaluate('window.pdfHold = false; document.querySelector("#page").value = "4"; document.querySelector("#page").dispatchEvent(new Event("change"))');
    await hasStatus('第 4 页已就绪');
    assert(await pageNumberAligned('4', 'left'));
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-equation canvas")].map(canvas => canvas.ariaLabel)'),
      ['公式 (4.1)', '公式 (4.2)']);
    assert(await evaluate('!document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("r = limit")'));
    assert(await evaluate('document.querySelectorAll(".pdf-sheet[aria-current] .pdf-translation .pdf-figure canvas").length === 2'));
    assert(await evaluate('(() => { const node = document.querySelector(".pdf-sheet[aria-current] .pdf-caption"); return node?.textContent === "Table 1: Centered data" && getComputedStyle(node).textAlign === "center"; })()'));
    assert(!(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("Labels inside the table")')));
    await evaluate('window.pdfHold = true; document.querySelector("#translate").click()');
    await until(() => evaluate('pdfBatches.length === 7'));
    assert.deepEqual(await evaluate('pdfBatches.at(-1).map(i => i.text)'), [
      'Table 1: Centered data',
      'Use [[ARF0]] and [[ARF1]] below.',
      'Fourth page prose above the enclosed table.',
      '[[ARF0]]First source note has a superscript.',
      '[[ARF0]]Second source note must stay separate.',
    ]);
    assert.deepEqual(await evaluate(`(() => {
      const prose = [...document.querySelectorAll('.pdf-sheet[aria-current] .pdf-translation p')]
        .find(node => node.textContent.startsWith('Use '));
      return Array.from(prose.querySelectorAll('.pdf-inline-math canvas'), canvas => canvas.ariaLabel);
    })()`), ['AG i', 'BG i,j,k']);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".pdf-sheet[aria-current] .pdf-footnote")].map(note => note.textContent)'), [
      '2First source note has a superscript.', '3Second source note must stay separate.',
    ]);
    await evaluate('updatePdfTab({ url: location.origin + "/different.html", status: "loading" }); window.pdfRelease()');
    await hasStatus('标签页已更新');
    assert(await evaluate('document.querySelector("#viewer").hidden && window.panelOptions.enabled === false'));
    await navigate('/pdf.html?local=deny#9');
    await hasStatus('允许访问文件网址');
    assert.equal(await evaluate('Boolean(window.fileRead)'), false);
    await navigate('/pdf.html?local=allow#9');
    await hasStatus('第 1 页已就绪');
    assert(await evaluate('window.fileRead && window.localSlices >= 2'));
    await navigate('/pdf.html?fallback=1#9');
    await hasStatus('第 1 页已就绪');
    await evaluate('document.querySelector("#translate").click()');
    await hasStatus('第 1 页翻译完成');
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.replace(/\\s+/g, " ").includes("译 Let a + b 译 and c + d 译 be positive")'));
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation .pdf-inline-math sup")?.textContent === "2" && !document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("ARF")'));
    assert.deepEqual(await evaluate('pdfBatches[1].map(item => item.text.trim())'),
      ['function', 'is smooth on this interval.', 'The result is', 'with modest error.', 'Let', 'and', 'be positive']);
    await navigate('/pdf.html?reorder=1#9');
    await hasStatus('第 1 页已就绪');
    await evaluate('document.querySelector("#translate").click()');
    await hasStatus('第 1 页翻译完成');
    assert(await evaluate('document.querySelector(".pdf-sheet[aria-current] .pdf-translation").textContent.includes("译 先 c + d，再 a + b")'));
    await navigate('/pdf.html#9');
    await hasStatus('第 1 页已就绪');
    await evaluate('window.pdfEcho = true; document.querySelector("#translate").click()');
    await hasStatus('翻译服务返回了未翻译的原文');
    await evaluate('window.pdfEcho = "repeat"; document.querySelector("#translate").click()');
    await hasStatus('翻译服务返回了异常重复的译文');
    await evaluate('window.pdfEcho = false; document.querySelector("#translate").click()');
    await hasStatus('第 1 页翻译完成');
    assert.deepEqual(await evaluate('pdfBatches[1].map(item => item.text)'), ['Research for AI + Science remains useful.']);
    await navigate('/pdf.html?path=/bad.pdf&start=4#9');
    await hasStatus('第 4 页已就绪');
    assert.equal(fullReads.get('/bad.pdf'), 1);
    assert.equal(await evaluate('document.querySelector("#page").value'), '4');
    await navigate('/pdf.html?path=/unreadable.pdf#9');
    await hasStatus('分段读取和完整读取均失败');
    assert.equal(fullReads.get('/unreadable.pdf'), 1);
    await navigate('/pdf.html?path=/whole.pdf#9');
    await hasStatus('第 1 页已就绪');
    await navigate('/pdf.html?path=/range-rejected.pdf#9');
    await hasStatus('第 1 页已就绪');
    assert.equal(fullReads.get('/range-rejected.pdf'), 1);
    for (const suffix of ['', '?pending=1#9']) {
      await navigate('/pdf.html' + suffix);
      await until(() => evaluate('Boolean(document.querySelector("#file")?.onchange)'));
      await evaluate(`(async () => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([await (await fetch('/whole.pdf')).blob()], 'sample.pdf'));
        const file = document.querySelector('#file');
        file.files = transfer.files;
        file.dispatchEvent(new Event('change'));
        updatePdfTab({ url: location.origin + '/fixture.pdf', status: 'complete' }, { pendingUrl: undefined });
      })()`);
      await hasStatus('第 1 页已就绪');
      assert(await evaluate('!!document.querySelector(".pdf-original canvas")'));
    }
    console.log('PDF opening, range reads, continuous wheel navigation, column order, figures, prefetch, cancellation and retry passed.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkPdfBrowser };
