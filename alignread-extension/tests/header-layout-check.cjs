const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkHeaderLayout({evaluate, until, page, replaceFixture, startLayout, readerState}) {
  await replaceFixture(fs.readFileSync(path.join(__dirname, 'fixtures', 'header-layout.html'), 'utf8'));
  await evaluate('readerPayloads.length = 0');
  assert((await startLayout('compact-header', 'visible')).ok);
  await until(async () => {
    const state = await readerState();
    if (state?.status === 'error') throw new Error(JSON.stringify(state));
    return state?.status === 'ready';
  });

  const destinations = {
    navigation: ['/catalog/home', '/catalog/guides', '/catalog/tools', '/catalog/kits'],
    tags: ['/topics/signal', '/topics/terrain', '/topics/catalog', '/topics/systems', '/topics/field'],
    tabs: ['/field/overview', '/field/versions', '/field/community'],
    metadata: ['/metadata/branch', '/metadata/revision', '/metadata/history'],
  };
  const measure = () => evaluate(`{
    const article = pane.querySelector('article');
    const scroll = pane.querySelector('.scroll');
    const groups = ${JSON.stringify(destinations)};
    const link = (urlPath) => article.querySelector('a[href="https://example.com' + urlPath + '"]');
    const bounds = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().toJSON();
    };
    const tags = groups.tags.map(link);
    const tabs = groups.tabs.map(link);
    const pill = (anchor) => {
      for (let node = anchor; node && node !== article; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (parseFloat(style.borderRadius) >= 8 && style.borderInlineStartStyle === 'solid') {
          return style.backgroundColor;
        }
      }
      return null;
    };
    let tabsScroll = false;
    for (let node = tabs[0]?.parentElement; node && node !== article; node = node.parentElement) {
      if (tabs.every(item => node.contains(item)) && ['auto', 'scroll'].includes(getComputedStyle(node).overflowX) &&
          node.scrollWidth > node.clientWidth + 1) tabsScroll = true;
    }
    ({
      rows: Object.fromEntries(Object.entries(groups).map(([name, urls]) => [name, urls.map(url => bounds(link(url)))])),
      tagColors: tags.map(pill),
      safeLinks: [...Object.values(groups).flat(), '/terms'].every(url => {
        const anchor = link(url);
        return anchor?.target === '_blank' && anchor.relList.contains('noopener');
      }),
      activeTab: !!tabs[1]?.closest('[aria-current]:not([aria-current="false"])'),
      title: bounds(article.querySelector('h1')),
      license: bounds(link('/terms')),
      bodyColumns: [bounds(link('/notes/fixtures')), bounds(link('/notes/measurements'))],
      hidden: /Browser query controls|fixture-search|Hidden menu control|Inactive menu item/.test(
        article.textContent + readerPayloads.flat().join(' ')),
      tabsScroll,
      articleOverflow: scroll.scrollWidth > scroll.clientWidth + 1,
    });
  }`);
  const wide = await measure();
  for (const [name, row] of Object.entries(wide.rows)) {
    assert(row.every(Boolean), 'Missing link in ' + name);
    assert(row.slice(1).every((rect, index) => {
      const previous = row[index];
      return rect.left >= previous.right - 1 && rect.left - previous.right <= 32 &&
        rect.top < previous.bottom && previous.top < rect.bottom;
    }), name + ' should stay together, in order, with compact gaps: ' + JSON.stringify(row));
  }
  assert(wide.tagColors.every(color => color === 'rgb(224, 239, 231)'), 'Chips should retain their rounded border and color.');
  assert(wide.title && wide.license && wide.title.bottom <= wide.rows.tags[0].top &&
    wide.rows.tags.at(-1).bottom <= wide.license.top && wide.license.bottom <= wide.rows.tabs[0].top,
  'The title, chips, license, and tabs should preserve their source order.');
  assert(wide.activeTab && wide.safeLinks && !wide.hidden && !wide.articleOverflow);
  assert(wide.bodyColumns[1].left - wide.bodyColumns[0].right > 64,
    'Content cards intended to share available width should retain their columns.');
  assert.equal(await evaluate(`{
    const block = pane.querySelector('a[href="https://example.com/topics/signal"]').closest('[data-reader-block]');
    block.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    CSS.highlights.get('alignread-paragraph')?.values().next().value?.toString();
  }`), 'Signal processing');

  await page('Emulation.setDeviceMetricsOverride', {width: 1024, height: 900, deviceScaleFactor: 1, mobile: false});
  await evaluate(`{
    const divider = pane.querySelector('[role=separator]');
    for (let index = 0; index < 10; index++) divider.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  }`);
  await until(() => evaluate('pane.querySelector(".scroll").clientWidth <= 350'));
  const narrow = await measure();
  assert(narrow.rows.tags.at(-1).top > narrow.rows.tags[0].bottom, 'Chips should wrap when the pane is narrow.');
  assert(narrow.tabsScroll && narrow.activeTab && !narrow.articleOverflow,
    'Tabs should scroll inside their row without overflowing the article.');
  await evaluate('readerCommand({type:"reader:stop"})');
  await page('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  console.log('Compact header navigation, chip styles, tabs, source links, and narrow wrapping passed.');
}

module.exports = {checkHeaderLayout};
