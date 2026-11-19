const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

function fixturePdf() {
  const lines = 'BT /F1 14 Tf 20 150 Td (Ordinary prose) Tj 0 -25 Td (x = 2) Tj ET';
  const pages = '/Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >>';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< ' + pages + ' /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + lines.length + ' >>\nstream\n' + lines + '\nendstream', '<< ' + pages + ' >>'];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, obj] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  }
  const start = pdf.length;
  pdf += 'xref\n0 7\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return pdf + 'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
}

function mockViewer() {
  if (location.pathname !== '/pdf.html') return;
  window.pdfBatches = [];
  chrome.tabs.get = async () => ({ url: location.origin + '/fixture.pdf' });
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
  const server = http.createServer(async (req, res) => {
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (route === '/fixture.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(fixturePdf()); return; }
      const file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
      const body = await fs.readFile(file);
      const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await page('Page.addScriptToEvaluateOnNewDocument', { source: '(' + mockViewer + ')()' });
    await page('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/pdf.html#9' });
    await until(() => evaluate('document.querySelector("#status")?.textContent.includes("第 1 页已就绪")'));
    assert.equal(await evaluate('document.querySelector("#total").textContent'), '/ 2');
    assert(await evaluate('!!document.querySelector("#original canvas") && !!document.querySelector("#lines canvas[aria-label=\\"x = 2\\"]")'));
    assert.deepEqual(await evaluate('pdfBatches'), []);
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
    console.log('Built PDF viewer opened a PDF URL, kept math local, isolated pages, canceled and retried translation.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkPdfBrowser };
