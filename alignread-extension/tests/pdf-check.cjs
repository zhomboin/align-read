const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const { fixturePdf } = require('./pdf-fixture.cjs');

function mockViewer(origin) {
  if (location.origin !== origin) return;
  if (location.pathname === '/popup.html') {
    chrome.tabs.query = async () => [{ id: 9, url: location.origin + '/fixture.pdf' }];
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
  chrome.tabs.get = async () => ({ url: params.has('local') ? fileUrl : location.origin + (params.get('path') || '/fixture.pdf') });
  chrome.tabs.onUpdated = { addListener(fn) { window.tabUpdated = fn; } };
  chrome.sidePanel = { async setOptions(options) { window.panelOptions = options; } };
  chrome.extension = { async isAllowedFileSchemeAccess() { return params.get('local') === 'allow'; } };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (String(url) === fileUrl) { window.fileRead = true; url = '/whole.pdf'; }
    return open.call(this, method, url, ...args);
  };
  const nativeFetch = window.fetch;
  window.fetch = (input, init) => {
    if (String(input) === fileUrl) {
      window.fileRead = true;
      window.localSlices = (window.localSlices ?? 0) + 1;
      return nativeFetch('/fixture.pdf', init).then(response => new Response(response.body, { status: 200 }));
    }
    return nativeFetch(input, init);
  };
  chrome.runtime.sendMessage = async () => ({
    ok: true, value: {
      provider: 'google', source: 'en', target: 'zh-CN', disabledSites: [],
      providers: { google: { configured: true, consent: true, hostPermission: true } }
    }
  });
  chrome.runtime.connect = () => {
    let receive;
    return {
      onDisconnect: { addListener() { } }, onMessage: { addListener(fn) { receive = fn; } }, disconnect() { },
      postMessage({ id, items }) {
        pdfBatches.push(items);
        if (window.pdfHold) return;
        if (window.pdfFail) { window.pdfFail = false; receive({ ok: false, error: 'network' }); return; }
        receive({ ok: true, value: { id, items: items.map(item => ({ id: item.id, text: '译 ' + item.text })) } });
      }
    };
  };
}

async function checkPdfBrowser({ page, evaluate, until, build }) {
  const root = path.resolve(build);
  const pdf = Buffer.from(fixturePdf());
  const ranges = [];
  const server = http.createServer(async (req, res) => {
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (route === '/fixture.pdf' || route === '/bad.pdf') {
        const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
        if (!range) { res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(pdf); return; }
        const start = Number(range[1]), end = Math.min(pdf.length - 1, Number(range[2]));
        ranges.push([start, end]);
        const body = pdf.subarray(start, end + 1);
        res.writeHead(206, {
          'Content-Type': 'application/pdf',
          'Content-Range': 'bytes ' + (route === '/bad.pdf' && start ? 0 : start) + '-' + end + '/' + pdf.length,
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
    await navigate('/popup.html');
    await until(() => evaluate('window.panelOptions?.path === "pdf.html#9"'));
    await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "在此页对照翻译").click()');
    assert.deepEqual(await evaluate('window.panelOpened'), { tabId: 9 });
    await navigate('/pdf.html#9');
    await until(() => evaluate('document.querySelector("#status")?.textContent.includes("第 1 页已就绪")'));
    assert.equal(await evaluate('document.querySelector("#total").textContent'), '/ 3');
    assert(await evaluate('!document.querySelector("#original canvas") && !!document.querySelector("#lines canvas[aria-label=\\"x = 2\\"]")'));
    assert.deepEqual(await evaluate('pdfBatches'), []);
    assert(ranges.length >= 2 && ranges.reduce((sum, [a, b]) => sum + b - a + 1, 0) < pdf.length / 2);
    await evaluate('window.pdfHold = true; document.querySelector("#translate").click()');
    await until(() => evaluate('pdfBatches.length === 1'));
    await evaluate('document.querySelector("#cancel").click(); window.pdfHold = false; window.pdfFail = true; document.querySelector("#translate").click()');
    await until(() => evaluate('pdfBatches.length === 2 && !document.querySelector("#translate").disabled'));
    await evaluate('document.querySelector("#translate").click()');
    await until(() => evaluate('document.querySelector("#status").textContent.includes("完成")'));
    assert.deepEqual(await evaluate('pdfBatches.map(b=>b.map(i=>i.text))'), Array(3).fill(['Ordinary prose']));
    assert(await evaluate('document.querySelector("#lines").textContent.includes("译 Ordinary prose")'));
    await evaluate('document.querySelector("#next").click()');
    await until(() => evaluate('document.querySelector("#status").textContent.includes("OCR")'));
    assert(await evaluate('document.querySelector("#translate").disabled && pdfBatches.length === 3'));
    await evaluate('document.querySelector("#prev").click()');
    await until(() => evaluate('document.querySelector("#status").textContent.includes("第 1 页已就绪")'));
    assert(!(await evaluate('document.querySelector("#lines").textContent.includes("译 ")')));
    await evaluate('document.querySelector("#page").value = "3"; document.querySelector("#page").dispatchEvent(new Event("change"))');
    await hasStatus('第 3 页已就绪');
    const left = 'Inside the left column continues here.';
    const right = 'Inside the right column finishes here.';
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#lines .pdf-columns > div")].map(el => el.textContent)'), [left, right]);
    assert(await evaluate('document.querySelector("#lines > div:first-child").textContent.includes("Article title")'));
    assert(await evaluate('document.querySelector("#lines > div:last-child").textContent.includes("Closing note")'));
    await evaluate('document.querySelector("#translate").click()');
    await hasStatus('完成');
    assert.deepEqual(await evaluate('pdfBatches.at(-1).map(item => item.text)'), ['Article title', left, right, 'Closing note']);
    assert(await evaluate('document.querySelector(".pdf-columns > div:nth-child(2)").getBoundingClientRect().left > document.querySelector(".pdf-columns > div").getBoundingClientRect().right'));
    await evaluate('tabUpdated(9, { status: "loading" })');
    await hasStatus('标签页已更新');
    assert(await evaluate('document.querySelector(".columns").hidden && window.panelOptions.enabled === false'));
    await navigate('/pdf.html?local=deny#9');
    await hasStatus('允许访问文件网址');
    assert.equal(await evaluate('Boolean(window.fileRead)'), false);
    await navigate('/pdf.html?local=allow#9');
    await hasStatus('第 1 页已就绪');
    assert(await evaluate('window.fileRead && window.localSlices >= 2'));
    await navigate('/pdf.html?path=/bad.pdf#9');
    await hasStatus('分段读取失败');
    await navigate('/pdf.html?path=/whole.pdf#9');
    await hasStatus('第 1 页已就绪');
    await navigate('/pdf.html');
    await until(() => evaluate('Boolean(document.querySelector("#file")?.onchange)'));
    await evaluate(`(async () => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([await (await fetch('/whole.pdf')).blob()], 'sample.pdf'));
      const file = document.querySelector('#file');
      file.files = transfer.files;
      file.dispatchEvent(new Event('change'));
    })()`);
    await hasStatus('第 1 页已就绪');
    assert(await evaluate('!!document.querySelector("#original canvas")'));
    console.log('PDF panel, range and whole reads, local permissions, column ordering, math, cancellation and retry passed.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkPdfBrowser };
