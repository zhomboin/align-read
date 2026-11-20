const assert = require('node:assert/strict');

async function moveModeSlider(page, evaluate, input, mode, drag = false) {
  const bounds = await evaluate(`{
    const slider = ${input};
    slider.scrollIntoView({block: 'nearest'});
    const rect = slider.getBoundingClientRect();
    ({left: rect.left + 5, right: rect.right - 5, y: rect.top + rect.height / 2});
  }`);
  const x = mode === 'dual' ? bounds.left : bounds.right;
  const start = drag ? bounds.left + bounds.right - x : x;
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y: bounds.y, button: 'left', buttons: 1, clickCount: 1 });
  if (drag) {
    for (let step = 1; step <= 5; step++) {
      const position = start + (x - start) * step / 5;
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: position, y: bounds.y, button: 'left', buttons: 1 });
    }
  }
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: bounds.y, button: 'left', clickCount: 1 });
}

async function checkProgressBrowser({ page, evaluate, until }) {
  await page('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: false });
  await evaluate(`history.replaceState(null, '', '/progress');
    document.body.innerHTML = '<main></main>';
    for (let n = 0; n < 35; n++) {
      const p = document.createElement('p');
      p.textContent = 'Progress line ' + n;
      document.querySelector('main').append(p);
    }
    replacementBatches.length = 0;
    replacementHeld.add('Progress line 34');`);
  const command = type => evaluate(`readerCommand({type:'reader:${type}'})`);
  const read = () => evaluate(`{
    const root = readerControl('.replacement-controls');
    const bar = root.querySelector('progress');
    ({label:root.querySelector('.status [role=status]').textContent, count:root.querySelector('.progress-count')?.textContent,
      value:bar?.getAttribute('value'), max:bar?.max, fits:root.getBoundingClientRect().left >= 0 &&
        root.getBoundingClientRect().right <= innerWidth && root.scrollWidth <= root.clientWidth});
  }`);
  assert((await evaluate(`readerCommand({type:'reader:start',session:{id:'progress',mode:'replace',range:'main',
    source:'en',target:'zh-CN',cache:true,ratio:.5,pageUrl:location.href}})`)).ok);
  try {
    const batch = await until(() => evaluate('replacementBatches.find(b => b.items.some(i => i.text === "Progress line 34"))?.batchId'));
    const phase = await command('state');
    assert(phase.done > 0 && phase.done < phase.total);
    assert.deepEqual(await read(), { label: '正在翻译', count: phase.done + '/35 段', value: String(phase.done), max: 35, fits: true });
    await command('pause');
    assert.equal((await read()).label, '已暂停');
    await command('resume');
    await evaluate('replacementRelease.get(' + JSON.stringify(batch) + ')()');
    await until(async () => (await read()).label === '翻译完成');
    assert.deepEqual(await read(), { label: '翻译完成', count: '35/35 段', value: '35', max: 35, fits: true });

    await evaluate("history.pushState(null, '', '/next-article')");
    await until(async () => (await read()).label === '正在提取页面内容');
    assert.equal((await read()).value, null);
    await evaluate(`const originalSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = m => m.type === 'batch' ? Promise.resolve({ok:false,error:'network'}) : originalSend(m);
      window.restoreProgressMock = () => { chrome.runtime.sendMessage = originalSend; };
      document.querySelector('main').innerHTML = '<p>New route paragraph</p>';`);
    await until(async () => (await command('state'))?.status === 'error');
    const error = await read();
    assert.equal(error.value, '0');
    assert.equal(error.count, '0/1 段 · 失败 1');
    assert(error.label.includes('网络') || error.label.includes('连接'), error.label);
    assert(error.fits);
    await evaluate('restoreProgressMock(); delete window.restoreProgressMock');
    await command('retry');
    await until(async () => (await read()).label === '翻译完成');
    await evaluate(`const sendMixed = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async m => {
        const result = await sendMixed(m);
        const omitted = m.items?.find(i => i.text === 'Mixed part 0');
        if (omitted) result.value.items = result.value.items.filter(i => i.id !== omitted.id);
        return result;
      };
      window.restoreProgressMock = () => { chrome.runtime.sendMessage = sendMixed; };
      replacementHeld.add('Mixed part 34');
      document.querySelector('main').innerHTML = '<p>' + Array.from({length:35}, (_,n) => '<em>Mixed part ' + n + '</em>').join(' ') + '</p>';
    `);
    const last = await until(() => evaluate('replacementBatches.find(b => b.items.some(i => i.text === "Mixed part 34"))?.batchId'));
    assert.equal((await read()).label, '正在翻译');
    assert.equal((await read()).count, '0/1 段 · 失败 1');
    await evaluate('replacementRelease.get(' + JSON.stringify(last) + ')()');
    await until(async () => (await read()).label === '翻译失败');
  } finally {
    await evaluate('window.restoreProgressMock?.(); delete window.restoreProgressMock');
    await command('stop');
  }
  console.log('In-place progress matched partial, paused, completed, navigation, network failure and retry states at 320px.');
}

module.exports = { moveModeSlider, checkProgressBrowser };
