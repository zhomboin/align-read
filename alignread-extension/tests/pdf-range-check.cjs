const assert = require('node:assert/strict');

async function checkPdfRange({ navigate, evaluate, until, hasStatus }) {
  const sent = () => evaluate('pdfBatches.flat().map(item => Number(item.text.split(" ").at(-1)))');
  const start = () => evaluate('document.querySelector("#translate").click()');
  const waitIdle = () => until(() => evaluate('document.querySelector("#cancel").textContent === "停止预译"'));
  await navigate('/pdf.html?path=/long.pdf&start=8&ahead=0#9');
  await hasStatus('第 8 页已就绪');
  await start();
  await hasStatus('第 8 页翻译完成');
  await waitIdle();
  assert.deepEqual(await sent(), [8]);
  await evaluate('document.querySelector("#next").click()');
  await hasStatus('第 9 页翻译完成');
  assert.deepEqual(await sent(), [8, 9]);

  await evaluate('window.pdfHold = "Document paragraph 11"; window.setPdfLookAhead(4)');
  await hasStatus('正在预译第 11 页');
  await until(() => evaluate('pdfBatches.flat().at(-1)?.text === "Document paragraph 11"'));
  await evaluate('window.setPdfLookAhead(0)');
  await waitIdle();
  assert.deepEqual(await sent(), [8, 9, 10, 11]);
  await evaluate('window.pdfHold = false; window.setPdfLookAhead(3)');
  await until(() => evaluate('pdfBatches.flat().at(-1).text.endsWith(" 12")'));
  await waitIdle();
  assert.deepEqual(await sent(), [8, 9, 10, 11, 11, 12]);

  await navigate('/pdf.html?path=/long.pdf&start=15&ahead=1000#inplace=9');
  await hasStatus('第 15 页翻译完成');
  await waitIdle();
  assert.deepEqual(await sent(), [15, 16]);
  await navigate('/pdf.html?path=/long.pdf&start=14&ahead=all#inplace=9');
  await hasStatus('全文进度 16/16 页');
  assert.deepEqual(await sent(), [14, 15, 16, ...Array.from({ length: 13 }, (_, index) => index + 1)]);
  assert(await evaluate('document.querySelector("#cancel").hidden && document.querySelector("#translate").disabled'));
}

module.exports = { checkPdfRange };
