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
  let sourceViewport = document.body;
  let sidebar = findSidebarLayout(sourceViewport);
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
  mountHost();

  const sheet = new CSSStyleSheet();
  let content = createContentFit(sourceViewport);
  let resizeFrame = 0;
  let appliedWidth = 0;
  let leftWidth = 0;
  let active = false;
  let originalScroll: ReturnType<typeof captureScroll> | undefined;

  function mountHost() {
    const root = document.documentElement;
    // Both overlays share a z-index, so keep the selection overlay above the reader.
    root.insertBefore(host, root.querySelector(':scope > [data-alignread-selection]'));
  }

  function captureScroll() {
    const { scrollLeft, scrollTop } = sourceViewport;
    const bodyScrolls = document.scrollingElement !== sourceViewport &&
      (scrollLeft !== 0 || scrollTop !== 0 ||
        (/^(auto|scroll)$/.test(getComputedStyle(sourceViewport).overflowY) &&
          sourceViewport.scrollHeight > sourceViewport.clientHeight + 2));
    return { windowX: window.scrollX, windowY: window.scrollY, bodyX: scrollLeft, bodyY: scrollTop, bodyScrolls };
  }

  function scrollSource(position: ReturnType<typeof captureScroll>) {
    sourceViewport.scrollTo({
      left: position.bodyScrolls ? position.bodyX : position.windowX,
      top: position.bodyScrolls ? position.bodyY : position.windowY,
      behavior: 'instant',
    });
  }

  function position() {
    const width = viewportWidth();
    const left = Math.round(width * clampRatio(getRatio()));
    if (width === appliedWidth && left === leftWidth) return;
    appliedWidth = width;
    leftWidth = left;
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

  function checkGeometry() {
    if (active) position();
    return verify();
  }

  function restoreContext() {
    const body = document.body;
    const root = document.documentElement;
    if (!root || !body?.isConnected) return false;
    const replacedBody = sourceViewport !== body;
    const movedHost = host.parentNode !== root;
    if (replacedBody) {
      content.close();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((style) => style !== sheet);
      sourceViewport = body;
      originalScroll = active ? captureScroll() : undefined;
      sidebar = findSidebarLayout(body);
      content = createContentFit(body);
    }
    if (movedHost) mountHost();
    const missingSheet = active && !document.adoptedStyleSheets.includes(sheet);
    if (missingSheet) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    if (active && (replacedBody || movedHost || missingSheet)) {
      position();
      content.fit(sidebar);
      if (replacedBody) {
        content.observe();
        if (originalScroll) scrollSource(originalScroll);
      }
    }
    return replacedBody || movedHost || missingSheet;
  }

  function adjust() {
    const error = checkGeometry();
    if (error) onUnsafe(error);
    else content.fit(sidebar);
  }

  function resize() {
    if (!active) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(adjust);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);

  return {
    container, shadow, restoreContext,
    get sourceViewport() { return sourceViewport; },
    get sidebar() { return sidebar; },
    refreshSidebar() {
      if (sidebar && sourceViewport.contains(sidebar.row) && sidebar.row.contains(sidebar.sidebarBranch) &&
          sidebar.row.contains(sidebar.content) && sidebar.sidebarBranch.contains(sidebar.sidebar) &&
          sidebar.content.contains(sidebar.heading) && sidebar.heading.getBoundingClientRect().width &&
          sidebar.sidebar.getBoundingClientRect().width && getComputedStyle(sidebar.sidebar).visibility === 'visible') return;
      const previous = sidebar;
      sidebar = findSidebarLayout(sourceViewport);
      if (active && (previous || sidebar)) content.fit(sidebar);
    },
    activate() {
      if (viewportWidth() < MIN_WIDTH) return 'narrow' as const;
      if (document.fullscreenElement || sourceViewport !== document.body) return 'incompatible' as const;
      originalScroll = captureScroll();
      host.style.setProperty('bottom', '0', 'important');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      position();
      const error = verify();
      if (error) return error;
      content.fit(sidebar);
      content.observe();
      scrollSource(originalScroll);
      active = true;
      return undefined;
    },
    drag() {
      if (active) position();
    },
    checkGeometry,
    verify: adjust,
    close() {
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', resize);
      cancelAnimationFrame(resizeFrame);
      const { scrollLeft, scrollTop } = sourceViewport;
      content.close();
      if (originalScroll) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((style) => style !== sheet);
        const { windowX, windowY, bodyX, bodyY, bodyScrolls } = originalScroll;
        const returnToBody = active && bodyScrolls;
        const returnToWindow = active && !bodyScrolls;
        if (document.body === sourceViewport) {
          sourceViewport.scrollTo({ left: returnToBody ? scrollLeft : bodyX, top: returnToBody ? scrollTop : bodyY, behavior: 'instant' });
          window.scrollTo({ left: returnToWindow ? scrollLeft : windowX, top: returnToWindow ? scrollTop : windowY, behavior: 'instant' });
        }
      }
      host.remove();
    },
  };
}
