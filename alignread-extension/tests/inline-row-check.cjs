const assert = require('node:assert/strict');

async function checkInlineRow({evaluate, until}) {
  const layout = await evaluate(`{
    const row = pane.querySelector('[data-reading-inline-row]');
    const [badge, separator, linkBlock] = row.children;
    const link = linkBlock.querySelector('a');
    const items = [badge, separator, linkBlock].map(item => item.getBoundingClientRect());
    const bounds = row.getBoundingClientRect();
    ({
      aligned: items.every(item => Math.abs((item.top + item.bottom) - (bounds.top + bounds.bottom)) < 2),
      centered: Math.abs(items[0].left + items[2].right - bounds.left - bounds.right) < 2,
      ordered: items[0].right < items[1].left && items[1].right < items[2].left,
      label: badge.textContent,
      background: getComputedStyle(badge).backgroundColor,
      radius: getComputedStyle(badge).borderRadius,
      separator: separator.textContent,
      link: link.href,
      color: getComputedStyle(link).color,
    });
  }`);
  assert.deepEqual(layout, {
    aligned: true, centered: true, ordered: true, label: '译 News', background: 'rgb(0, 102, 204)',
    radius: '12px', separator: '|', link: 'https://example.com/course', color: 'rgb(8, 109, 195)',
  });
  assert.equal(await evaluate('readerPayloads.flat().includes("|")'), false);
  assert.equal(await evaluate(`{
    pane.querySelector('[data-reading-inline-row] strong').click();
    CSS.highlights.get('alignread-paragraph')?.values().next().value?.startContainer.parentElement.textContent;
  }`), 'News');

  // Narrow the pane with the same controls used during a reading session.
  const setNarrow = (narrow) => evaluate(`{
    const divider = pane.querySelector('[role=separator]');
    for (let index = 0; index < 9; index++) {
      divider.dispatchEvent(new KeyboardEvent('keydown', {key: ${JSON.stringify(narrow ? 'ArrowRight' : 'ArrowLeft')}, bubbles: true}));
    }
  }`);
  await setNarrow(true);
  await until(() => evaluate('pane.querySelector(".scroll").clientWidth <= 460'));
  assert(await evaluate(`{
    const row = pane.querySelector('[data-reading-inline-row]');
    const [badge, separator, linkBlock] = row.children;
    const link = linkBlock.querySelector('a');
    const bounds = linkBlock.getBoundingClientRect();
    const divider = separator.getBoundingClientRect();
    const scroll = pane.querySelector('.scroll');
    link.getClientRects().length > 1 && divider.top >= bounds.top && divider.bottom <= bounds.bottom &&
      badge.getBoundingClientRect().right < divider.left && scroll.scrollWidth <= scroll.clientWidth + 1;
  }`), 'The link should wrap next to the label and separator without overflowing the pane.');
  await setNarrow(false);
  await until(() => evaluate('pane.querySelector(".scroll").clientWidth >= 680'));
  console.log('Inline announcement grouping, styling, source mapping, and narrow wrapping passed.');
}

module.exports = {checkInlineRow};
