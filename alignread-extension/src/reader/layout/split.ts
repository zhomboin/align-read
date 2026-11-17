import { clampRatio } from '../../shared/reader-messages';
import { createContentFit } from './fit-content';
import { findSidebarLayout } from './sidebar';

export const MIN_WIDTH = 960;

export function viewportWidth() {
  return window.innerWidth;
}

export function createSplit(
  getRatio: () => number,
  onUnsafe: (why: 'narrow' | 'incompatible') => void,
) {
  const sourceViewport = document.body;
  const sidebar = findSidebarLayout(sourceViewport);
  const documentRoot = document.documentElement;
  const host = document.createElement('div');
  host.setAttribute('data-alignread-host', '');
  host.style.setProperty('all', 'initial', 'important');
  for (const [property, value] of Object.entries({
    position: 'fixed', inset: '0 0 auto auto', display: 'block', 'z-index': '2147483647',
    'box-sizing': 'border-box', margin: '0', padding: '0', border: '0', 'min-width': '0',
    'max-width': 'none', 'pointer-events': 'auto', visibility: 'visible', width: 'min(380px, 100vw)',
  })) host.style.setProperty(property, value, 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  const container = document.createElement('div');
  shadow.append(container);
  // Both overlays share the same z-index, so keep an existing selection overlay above the reader.
  documentRoot.insertBefore(host, documentRoot.querySelector(':scope > [data-alignread-selection]'));

  const sheet = new CSSStyleSheet();
  const content = createContentFit(sourceViewport);
  let resizeFrame = 0;
  let leftWidth = 0;
  let active = false;
  let originalScroll: { windowX: number; windowY: number; bodyX: number; bodyY: number; bodyScrolls: boolean } | undefined;

  function position() {
    const width = viewportWidth();
    leftWidth = Math.round(width * clampRatio(getRatio()));
    host.style.setProperty('width', (width - leftWidth) + 'px', 'important');
    // The fixed body isolates its stacking order without re-anchoring fixed descendants.
    sheet.replaceSync(`
      :root { overflow: hidden !important; }
      :root > body {
        position: fixed !important;
        inset: 0 auto auto 0 !important;
        width: ${leftWidth}px !important;
        height: 100dvh !important;
        min-width: 0 !important;
        max-width: none !important;
        min-height: 0 !important;
        max-height: none !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        overflow: auto !important;
        overscroll-behavior: contain !important;
      }
    `);
  }

  function verify() {
    if (viewportWidth() < MIN_WIDTH) return 'narrow';
    if (document.fullscreenElement || sourceViewport !== document.body) return 'incompatible';
    const left = sourceViewport.getBoundingClientRect();
    const right = host.getBoundingClientRect();
    const css = getComputedStyle(sourceViewport);
    if (Math.abs(left.left) > 4 || Math.abs(left.right - leftWidth) > 4 ||
        Math.abs(right.left - left.right) > 4 || Math.abs(right.right - viewportWidth()) > 4 ||
        Math.abs(left.top) > 4 || Math.abs(left.bottom - window.innerHeight) > 4 ||
        css.position !== 'fixed' || !/^(auto|scroll)$/.test(css.overflowX) || !/^(auto|scroll)$/.test(css.overflowY)) {
      return 'incompatible';
    }
    return undefined;
  }

  function adjust() {
    const error = verify();
    if (error) onUnsafe(error);
    else content.fit(sidebar);
  }

  function resize() {
    if (!active) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      position();
      adjust();
    });
  }

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);

  return {
    container, shadow, sourceViewport, sidebar,
    activate() {
      if (viewportWidth() < MIN_WIDTH) return 'narrow' as const;
      if (document.fullscreenElement || sourceViewport !== document.body) return 'incompatible' as const;
      const { scrollLeft, scrollTop } = sourceViewport;
      const bodyScrolls = document.scrollingElement !== sourceViewport &&
        (scrollLeft !== 0 || scrollTop !== 0 ||
          (/^(auto|scroll)$/.test(getComputedStyle(sourceViewport).overflowY) &&
            sourceViewport.scrollHeight > sourceViewport.clientHeight + 2));
      originalScroll = { windowX: window.scrollX, windowY: window.scrollY, bodyX: scrollLeft, bodyY: scrollTop, bodyScrolls };
      host.style.setProperty('bottom', '0', 'important');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      position();
      const error = verify();
      if (error) return error;
      content.fit(sidebar);
      content.observe();
      sourceViewport.scrollTo({
        left: bodyScrolls ? scrollLeft : originalScroll.windowX,
        top: bodyScrolls ? scrollTop : originalScroll.windowY,
        behavior: 'instant',
      });
      active = true;
      return undefined;
    },
    drag() {
      if (active) position();
    },
    verify: adjust,
    close() {
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
      cancelAnimationFrame(resizeFrame);
      if (originalScroll) {
        const { scrollLeft, scrollTop } = sourceViewport;
        content.close();
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((style) => style !== sheet);
        const { windowX, windowY, bodyX, bodyY, bodyScrolls } = originalScroll;
        const returnToBody = active && bodyScrolls;
        const returnToWindow = active && !bodyScrolls;
        sourceViewport.scrollTo({ left: returnToBody ? scrollLeft : bodyX, top: returnToBody ? scrollTop : bodyY, behavior: 'instant' });
        window.scrollTo({ left: returnToWindow ? scrollLeft : windowX, top: returnToWindow ? scrollTop : windowY, behavior: 'instant' });
      }
      host.remove();
    },
  };
}
