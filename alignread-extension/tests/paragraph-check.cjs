const assert = require('node:assert/strict');

async function checkParagraphPage({ page, evaluate, until, pick, command, enable }) {
  await evaluate(`(() => {
    const fixture = document.createElement('section');
    fixture.id = 'dialogue';
    fixture.innerHTML = '<p id="line1">First <strong>speaker</strong> asks a question.</p>' +
      '<div id="line2">Second speaker <span hidden>private</span>answers.</div>' +
      '<p id="line3"><a href="#third">Third speaker</a> agrees.</p>' +
      '<p id="breaks">Hello!<br>How are you?<br>Very well.</p>' +
      '<p id="longLine"></p><pre id="codeLine">Private code</pre>' +
      '<p id="codeOnly"><code>SELECT 1</code></p>' +
      '<p id="sqlProse">Use <code id="term">SELECT</code> to read <code>items</code>.</p>';
    document.querySelector('article').append(fixture);
    document.querySelector('#longLine').textContent = 'long paragraph '.repeat(240).trim();
    window.selectDialogue = () => getSelection().setBaseAndExtent(
      document.querySelector('#line1 strong').firstChild, 2, document.querySelector('#line3 a').firstChild, 3);
    window.paragraphReplies = () => Array.from(fixture.querySelectorAll('[data-alignread-paragraph]'),
      node => paragraphShadows.get(node).querySelector('[role=status]').textContent);
    window.paragraphCalls = () => selectionMessages.filter(message => message.type === 'paragraph:translate')
      .map(message => message.text);
    selectDialogue();
  })()`);
  const event = (type, key, code, windowsVirtualKeyCode, modifiers = 0) =>
    page('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode, modifiers,
      ...(type === 'keyDown' && key === 'Enter' && { text: '\r', unmodifiedText: '\r' })
    });
  const down = () => event('keyDown', 'Control', 'ControlLeft', 17, 2);
  const up = () => event('keyUp', 'Control', 'ControlLeft', 17);
  const tap = async () => { await down(); await up(); };
  const count = () => evaluate('paragraphCalls().length');

  await down();
  await event('keyDown', 'c', 'KeyC', 67, 2);
  await event('keyUp', 'c', 'KeyC', 67, 2);
  await up();
  await down();
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x: 1, y: 1, modifiers: 2 });
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x: 1, y: 1, modifiers: 2 });
  await evaluate('selectDialogue()');
  await up();
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Control",bubbles:true}));' +
    'document.dispatchEvent(new KeyboardEvent("keyup",{key:"Control",bubbles:true}))');
  assert.equal(await count(), 0);
  await evaluate('selectionMode = "slow"');
  await tap();
  await until(async () => await count() === 1);
  assert.deepEqual(await evaluate('paragraphReplies()'), ['正在翻译…', '等待翻译…', '等待翻译…']);
  const spinner = `(() => {
    const root = paragraphShadows.get(document.querySelector('#line1').nextSibling);
    const feedback = root.querySelector('.feedback');
    const style = getComputedStyle(feedback, '::before');
    const box = feedback.getBoundingClientRect();
    return { animation: style.animationName, visible: box.height > 0 && box.width > 0 && parseFloat(style.width) > 0 };
  })()`;
  assert.deepEqual(await evaluate(spinner), { animation: 'spin', visible: true });
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.deepEqual(await evaluate(spinner), { animation: 'none', visible: true });
  await page('Emulation.setEmulatedMedia', { features: [] });
  await tap();
  assert.equal(await count(), 1);
  await evaluate('getSelection().removeAllRanges(); finishSelection({ok:true,value:"第一句译文"})');
  await until(async () => await count() === 2);
  assert.deepEqual(await evaluate('paragraphReplies()'), ['第一句译文', '正在翻译…', '等待翻译…']);
  await evaluate('selectionMode = "success"; finishSelection({ok:false,error:"timeout"})');
  await until(async () => await count() === 3);
  const lines = ['First speaker asks a question.', 'Second speaker answers.', 'Third speaker agrees.'];
  assert.deepEqual(await evaluate('paragraphCalls()'), lines);
  const replies = ['第一句译文', '译 ' + lines[1], '译 ' + lines[2]];
  const retry = 'paragraphShadows.get(document.querySelector("#line2").nextSibling).querySelector("button")';
  const partial = await evaluate('paragraphReplies()');
  assert.equal(partial[0], replies[0]);
  assert.match(partial[1], /翻译失败.*超时/);
  assert.equal(partial[2], replies[2]);
  assert(await evaluate(retry + '.getBoundingClientRect().width > 0'));
  await evaluate('selectionMode = "slow";' + retry + '.focus()');
  await event('keyDown', 'Enter', 'Enter', 13);
  await event('keyUp', 'Enter', 'Enter', 13);
  await until(async () => await count() === 4);
  assert.deepEqual(await evaluate('paragraphReplies()'), [replies[0], '正在翻译…', replies[2]]);
  assert(await evaluate(retry + '.hidden'));
  await evaluate('selectionMode = "success"; finishSelection({ok:true,value:' + JSON.stringify(replies[1]) + '})');
  assert.deepEqual(await evaluate('paragraphReplies()'), replies);
  assert.deepEqual(await evaluate(`['line1','line2','line3'].map(id => {
    const original = document.getElementById(id);
    const host = original.nextElementSibling;
    return host.hasAttribute('data-alignread-paragraph') &&
      host.getBoundingClientRect().top >= original.getBoundingClientRect().bottom;
  })`), [true, true, true]);
  await evaluate('selectDialogue()');
  await tap();
  assert.deepEqual(await evaluate('paragraphReplies()'), []);
  assert.equal(await count(), 4);

  await pick('breaks');
  await tap();
  const brokenLines = ['Hello!', 'How are you?', 'Very well.'];
  assert.deepEqual(await evaluate('paragraphCalls().slice(4)'), brokenLines);
  assert.deepEqual(await evaluate(`(() => {
    const p = document.querySelector('#breaks');
    const hosts = [...p.querySelectorAll('br')].map(br => br.nextSibling).concat(p.nextSibling);
    return hosts.map(host => paragraphShadows.get(host).querySelector('[role=status]').textContent);
  })()`), brokenLines.map(line => '译 ' + line));

  await pick('longLine', 1, 3);
  const beforeLong = await count();
  await tap();
  const chunks = await evaluate('paragraphCalls().slice(' + beforeLong + ')');
  assert(chunks.length > 1);
  assert(chunks.every(chunk => chunk.length <= 1500));
  assert.equal(chunks.join(''), await evaluate('document.querySelector("#longLine").textContent'));
  assert.equal((await evaluate('paragraphReplies()')).at(-1), chunks.map(chunk => '译 ' + chunk).join(''));

  const beforePrivate = await count();
  for (const id of ['editable', 'editor', 'codeLine', 'codeOnly']) {
    await pick(id);
    await tap();
  }
  assert.equal(await count(), beforePrivate);
  await pick('term');
  await tap();
  assert.equal((await evaluate('paragraphCalls()')).at(-1), 'Use SELECT to read items.');
  assert(await evaluate('document.querySelector("#sqlProse").nextSibling.hasAttribute("data-alignread-paragraph")'));
  await tap();
  await evaluate('selectionMode = "error"');
  await pick('line2', 0, 4);
  await tap();
  await until(() => evaluate('!' + retry + '.hidden'));
  assert.match((await evaluate('paragraphReplies()'))[0], /翻译失败.*网络/);
  await evaluate('selectionMode = "success";' + retry + '.focus()');
  await event('keyDown', 'Enter', 'Enter', 13);
  await event('keyUp', 'Enter', 'Enter', 13);
  await until(() => evaluate(retry + '.hidden'));
  assert.equal((await evaluate('paragraphCalls()')).at(-1), lines[1]);
  await evaluate('selectionMode = "slow"');
  await pick('line1', 1, 2);
  await tap();
  await evaluate('document.querySelector("#line1").textContent = "Changed."; finishSelection({ok:true,value:"过期"})');
  await until(() => evaluate('!document.querySelector("#line1").nextElementSibling.hasAttribute("data-alignread-paragraph")'));
  assert(!(await evaluate('paragraphReplies()')).includes('过期'));
  await evaluate('document.querySelector("#line2").remove()');
  await until(async () => !(await evaluate('paragraphReplies()')).includes('译 ' + lines[1]));
  await pick('line3');
  await tap();
  const pending = await evaluate('selectionMessages.filter(m => m.type === "paragraph:translate").at(-1).requestId');
  await command('paragraph:stop');
  assert(await evaluate(`selectionMessages.some(m => m.type === 'paragraph:cancel' && m.requestId === ${JSON.stringify(pending)})`));
  await evaluate('finishSelection({ok:true,value:"过期"})');
  assert.deepEqual(await evaluate('paragraphReplies()'), []);
  await pick('line1');
  await tap();
  assert.equal(await evaluate('!!document.querySelector("[data-alignread-paragraph]")'), false);
  await evaluate('selectionMode = "success"');
  await enable('first');
  await evaluate('selectionCommand({type:"paragraph:shortcut",sessionId:"first",shortcut:"Alt+K"})');
  await pick('line3');
  const beforeRebind = await count();
  await tap();
  const k = async modifiers => {
    await event('keyDown', 'k', 'KeyK', 75, modifiers);
    await event('keyUp', 'k', 'KeyK', 75, modifiers);
  };
  await k(0);
  await k(1 | 8);
  assert.equal(await count(), beforeRebind);
  await event('keyDown', 'Alt', 'AltLeft', 18, 1);
  await k(1);
  await event('keyUp', 'Alt', 'AltLeft', 18);
  assert.deepEqual(await evaluate('paragraphReplies()'), [replies[2]]);
  await evaluate('selectionCommand({type:"paragraph:shortcut",sessionId:"first",shortcut:"F8"})');
  await event('keyDown', 'F8', 'F8', 119);
  await event('keyUp', 'F8', 'F8', 119);
  assert.deepEqual(await evaluate('paragraphReplies()'), []);
  assert.equal(await count(), beforeRebind + 1);
  await evaluate('selectionCommand({type:"paragraph:shortcut",sessionId:"first",shortcut:"Ctrl+Shift"})');
  await down();
  await event('keyDown', 'Shift', 'ShiftLeft', 16, 10);
  await event('keyUp', 'Shift', 'ShiftLeft', 16, 2);
  await up();
  assert.deepEqual(await evaluate('paragraphReplies()'), [replies[2]]);
  await evaluate('document.querySelector("#dialogue").remove()');
  await enable('first');
  console.log('Paragraph translation passed partial and cross-paragraph selections, inline breaks, shortcuts, chunking, retry and cleanup.');
}

module.exports = { checkParagraphPage };
