const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkRepositoryLayout({evaluate, until, page, replaceFixture, startLayout, readerState}) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'repository-layout.html'), 'utf8');
  await replaceFixture(html);
  await evaluate('readerPayloads.length = 0');
  assert((await startLayout('repository-layout', 'visible')).ok);
  await until(async () => (await readerState())?.status === 'ready');

  const files = '[href^="https://example.com/repository/files/"]';
  const rows = await evaluate(`{
    const article = pane.querySelector('article');
    [...article.querySelectorAll(${JSON.stringify(files)})].map((link) => {
      const row = link.closest('li');
      const commit = row?.querySelector('a[href*="/commit/"]');
      if (!row || !commit) return null;
      const texts = row.textContent;
      const commitRect = commit.getBoundingClientRect();
      const fileRect = link.getBoundingClientRect();
      const time = texts.includes('One day ago') ? 'One day ago' : 'Seven days ago';
      const textRect = (text) => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && !node.data.includes(text)) {}
        if (!node) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };
      const hasSize = !link.pathname.endsWith('/directory');
      const sizeRect = hasSize ? textRect(texts.includes('12.5') ? '12.5' : '40.6') : null;
      const timeRect = textRect(time);
      if (!timeRect || (hasSize && !sizeRect)) return null;
      const columns = sizeRect ? [fileRect, sizeRect, commitRect, timeRect] : [fileRect, commitRect, timeRect];
      return {
        file: link.textContent, href: link.href, target: link.target,
        top: row.getBoundingClientRect().top, commitLeft: commitRect.left,
        aligned: columns.slice(1).every((cell, index) => columns[index].right < cell.left) &&
          fileRect.top < timeRect.bottom && timeRect.top < fileRect.bottom,
        text: texts,
      };
    });
  }`);
  assert.equal(rows.length, 3);
  assert(rows.every(row => row?.aligned), 'Each file row should retain separately positioned cells.');
  assert(rows.slice(1).every((row, index) => rows[index].top < row.top && Math.abs(rows[0].commitLeft - row.commitLeft) < 2),
    'The directory should reserve the empty file size column so commit links align.');
  assert.deepEqual(rows.map(row => [row.file, row.href, row.target]), [
    ['scheduler_v2', 'https://example.com/repository/files/directory', '_blank'],
    ['README.md', 'https://example.com/repository/files/readme', '_blank'],
    ['large_repository_snapshot_weights_for_the_code_browser.safetensors', 'https://example.com/repository/files/model', '_blank'],
  ]);
  assert.match(rows[1].text, /12\.5 (?:译 )?kB.*译 Refresh repository guidance.*译 One day ago/);
  assert.match(rows[2].text, /40\.6 (?:译 )?MB.*译 Add model weights.*译 Seven days ago/);

  const panes = await evaluate(`{
    const article = pane.querySelector('article');
    ({
      code: [...article.querySelectorAll('pre:not(td pre)')].map(pre => pre.innerText),
      codeLines: [...article.querySelectorAll('table tr')].map(row => [...row.cells].map(cell => cell.innerText)),
      inlineCode: [...article.querySelectorAll('p code')].map(code => code.textContent),
      hidden: /Hidden menu instructions|hidden_example|Clipped drawer instructions|Inactive tool instructions/.test(article.textContent),
      payload: readerPayloads.flat(),
    });
  }`);
  assert.deepEqual(panes.code, [
    'function visible_example() {\n    return "Semantic code example";\n}',
    'def build_sample():\n    return "Rendered code example"',
    'if ready:\n    log("Role code example")',
  ]);
  assert.deepEqual(panes.codeLines, [
    ['1', 'if value:'],
    ['2', '    return "Code cell should stay unchanged"'],
    ['3', ''],
    ['4', '# Code cell closing comment'],
  ]);
  assert.deepEqual(panes.inlineCode, ['Inline code example']);
  assert.equal(panes.hidden, false);
  assert(panes.payload.includes('Repository usage notes'));
  assert(panes.payload.includes('Refresh repository guidance'));
  assert(!panes.payload.some(text =>
    /visible_example|hidden_example|Hidden menu instructions|Clipped drawer instructions|Inactive tool instructions/.test(text)));
  assert(!panes.payload.some(text => /code example|Code cell (?:should stay unchanged|closing comment)/.test(text)));

  await page('Emulation.setDeviceMetricsOverride', {width: 1024, height: 900, deviceScaleFactor: 1, mobile: false});
  await until(() => evaluate('pane.querySelector(".scroll").clientWidth <= 512'));
  assert(await evaluate(`{
    const scroll = pane.querySelector('.scroll');
    const links = [...pane.querySelectorAll(${JSON.stringify(files)})];
    const bounds = links.map(link => link.closest('li').getBoundingClientRect());
    links.length === 3 && bounds.slice(1).every((row, index) => bounds[index].bottom <= row.top) &&
      scroll.scrollWidth <= scroll.clientWidth + 1;
  }`), 'Narrow panes should keep separate rows and avoid article-level overflow.');

  await evaluate('document.querySelector(".tools-panel").dataset.state = "open"');
  await until(() => evaluate('pane.querySelector("article").textContent.includes("译 Hidden menu instructions")'));
  assert.equal(await evaluate('pane.querySelectorAll("article pre:not(td pre)").length'), panes.code.length + 1);
  assert(!await evaluate('readerPayloads.flat().some(text => text.includes("hidden_example"))'));
  await evaluate('document.querySelector(".tools-panel").dataset.state = "closed"');
  await until(() => evaluate('!pane.querySelector("article").textContent.includes("Hidden menu instructions")'));
  await evaluate('document.querySelector(".inert-tools").inert = false');
  await until(() => evaluate('pane.querySelector("article").textContent.includes("译 Inactive tool instructions")'));
  await evaluate('document.querySelector(".inert-tools").inert = true');
  await until(() => evaluate('!pane.querySelector("article").textContent.includes("Inactive tool instructions")'));

  await evaluate('readerCommand({type:"reader:stop"})');
  await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});

  const codeOnly = 'def example():\n    # Preserve this comment\n\n    return "example"';
  await replaceFixture('<!doctype html><html lang="en"><body><main><pre><code>' +
    codeOnly + '</code></pre></main></body></html>');
  await evaluate('readerPayloads.length = 0');
  assert((await startLayout('code-only', 'visible')).ok);
  const ready = await until(async () => {
    const state = await readerState();
    return state?.status === 'ready' && state;
  });
  assert.equal(ready.total, 0);
  assert.deepEqual(await evaluate('readerPayloads'), []);
  assert.equal(await evaluate('pane.querySelector("article pre").innerText'), codeOnly);
  assert.equal(await evaluate('pane.querySelector(".toolbar .status").textContent'), '已显示原文');
  await evaluate('readerCommand({type:"reader:stop"})');
  console.log('Repository rows, links, code formatting, code-only previews, and clipped menu visibility passed.');
}

module.exports = {checkRepositoryLayout};
