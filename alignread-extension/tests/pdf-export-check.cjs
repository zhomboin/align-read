const assert = require('node:assert/strict');

async function longPdf() {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  for (let index = 1; index <= 16; index++) {
    doc.addPage([300, 300]).drawText('Document paragraph ' + index, { x: 25, y: 220, size: 14 });
  }
  return Buffer.from(await doc.save());
}

async function checkInplaceExport({ navigate, evaluate, until, hasStatus }) {
  await navigate('/popup.html');
  const action = 'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "在新标签页原位翻译")';
  await until(() => evaluate('Boolean(' + action + ')'));
  await evaluate(action + '.click()');
  assert(await evaluate('window.openedPdf.endsWith("/pdf.html#inplace=9")'));

  await navigate('/pdf.html?export=1&start=3#inplace=9');
  await hasStatus('第 3 页翻译完成');
  await until(() => evaluate('document.querySelector("#cancel").textContent === "停止预译"'));
  assert.equal(await evaluate('document.querySelector("#page").value'), '3');
  await evaluate('updatePdfTab({url: location.origin + "/other.html", status: "complete"})');
  assert(await evaluate('!document.querySelector("#viewer").hidden'));
  await evaluate('document.querySelector("#original").click()');
  assert(await evaluate('getComputedStyle(document.querySelector(".pdf-overlays")).visibility === "hidden"'));
  await evaluate('document.querySelector("#original").click()');
  assert.equal(await evaluate('document.querySelector("#page").value'), '3');
  await evaluate('window.pdfFail = true; document.querySelector("#download").click()');
  await until(() => evaluate('document.querySelector("#export-status").textContent.includes("可重新下载")'));
  assert.equal(await evaluate('Boolean(window.downloadData)'), false);
  await evaluate('window.pdfHold = true; document.querySelector("#download").click()');
  await until(() => evaluate('Boolean(window.pdfRelease)'));
  await evaluate('document.querySelector("#cancel").click(); window.pdfHold = false');
  assert.equal(await evaluate('Boolean(window.downloadData)'), false);
  const beforeRetry = await evaluate('pdfBatches.length');
  await evaluate('document.querySelector("#download").click()');
  try { await until(() => evaluate('Boolean(window.downloadData)')); }
  catch { throw Error('PDF download failed: ' + await evaluate('document.querySelector("#export-status").textContent')); }
  assert.equal(await evaluate('window.downloadName'), 'fixture-中文译本.pdf');
  const sent = await evaluate('pdfBatches.slice(' + beforeRetry + ').flat().map(item => item.text)');
  assert(sent.includes('Ordinary prose'));
  assert(!sent.some(text => text.includes('Inside the left column')));
  await evaluate('const input = document.querySelector("#page"); input.value = "1"; input.onchange()');
  const first = 'document.querySelector(".pdf-sheet[data-page=\'1\'] .pdf-overlays")';
  await until(() => evaluate(first + '?.textContent.includes("普通正文")'));
  await evaluate(first + '.querySelector(".pdf-note").dispatchEvent(new MouseEvent("click"))');
  assert(await evaluate('document.querySelector("#detail").open && Boolean(document.querySelector("#detail p").textContent)'));

  const bytes = Buffer.from(await evaluate('window.downloadData'), 'base64');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const doc = await task.promise;
  try {
    assert(doc.numPages > 5);
    const texts = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      texts.push(content.items.map(item => item.str).join(''));
    }
    assert(texts[0].includes('普通正文'));
    const appendix = texts.slice(5).join('');
    assert(appendix.includes('原第 1 页'));
    assert(appendix.includes('放入文末附录以便离线阅读。'));
    assert(!appendix.includes('[[ARF'));
    if (process.env.ALIGNREAD_PDF_TEST_OUTPUT) {
      await require('node:fs/promises').writeFile(process.env.ALIGNREAD_PDF_TEST_OUTPUT, bytes);
    }
  } finally { await task.destroy(); }

  await navigate('/pdf.html?export=1&path=/long.pdf#inplace=9');
  await hasStatus('第 1 页翻译完成');
  await evaluate('document.querySelector("#download").click()');
  await until(() => evaluate('Boolean(window.downloadData)'));
  const completed = await evaluate('pdfBatches.flat().map(item => item.text)');
  assert.equal(new Set(completed).size, 16);
  await evaluate('window.downloadData = undefined; document.querySelector("#download").click()');
  await until(() => evaluate('Boolean(window.downloadData)'));
  assert.equal(await evaluate('pdfBatches.flat().length'), completed.length);
}

module.exports = { checkInplaceExport, longPdf };
