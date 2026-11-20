import type { SidebarLayout } from './sidebar';

const readingSelector = 'main,article,[role=main],h1';
const edgeCandidates = 'header,footer,[role=banner],[role=contentinfo],[role=dialog],:scope > *,:scope > div > *';

type Property = { original: string; priority: string; applied: string };
type ElementStyles = { hadAttribute: boolean; properties: Map<string, Property> };

export function createContentFit(body: HTMLElement) {
  const overridden = new Map<HTMLElement, ElementStyles>();

  function set(element: HTMLElement, styles: Record<string, string>) {
    let entry = overridden.get(element);
    if (!entry) {
      entry = { hadAttribute: element.hasAttribute('style'), properties: new Map() };
      overridden.set(element, entry);
    }
    const { properties } = entry;
    for (const [name, value] of Object.entries(styles)) {
      const prior = properties.get(name);
      const property = prior ?? {
        original: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name), applied: '',
      };
      element.style.setProperty(name, value, 'important');
      property.applied = element.style.getPropertyValue(name);
      properties.set(name, property);
    }
  }

  function restoreElement(element: HTMLElement, { hadAttribute, properties }: ElementStyles) {
    for (const [name, { original, priority, applied }] of properties) {
      if (element.style.getPropertyValue(name) !== applied || element.style.getPropertyPriority(name) !== 'important') continue;
      if (original) element.style.setProperty(name, original, priority);
      else element.style.removeProperty(name);
    }
    if (!hadAttribute && element.getAttribute('style') === '') element.removeAttribute('style');
    overridden.delete(element);
  }

  function restore() {
    for (const [element, saved] of overridden) restoreElement(element, saved);
  }

  function fitSidebar(layout: SidebarLayout, width: number) {
    const { row, sidebar, sidebarBranch, content, heading, side } = layout;
    if (!row.isConnected) return;
    const rowRect = row.getBoundingClientRect();
    const rowWidth = Math.min(width, row.clientWidth);
    if (!rowWidth) return;

    const limit = Math.floor(rowWidth * .38);
    if (sidebar.getBoundingClientRect().width > limit + 4) {
      set(sidebar, { 'min-width': '0', 'max-width': limit + 'px', 'box-sizing': 'border-box' });
      if (sidebarBranch !== sidebar && sidebarBranch.getBoundingClientRect().width > limit + 4) {
        set(sidebarBranch, { 'min-width': '0', 'max-width': limit + 'px', 'box-sizing': 'border-box' });
      }
    }

    const menu = sidebar.getBoundingClientRect();
    const column = content.getBoundingClientRect();
    const stylesheet = getComputedStyle(content);
    const onLeft = side === 'left';
    const gap = 8;
    const edge = onLeft ? menu.right + gap : menu.left - gap;
    const bounds = { left: rowRect.left, right: rowRect.left + rowWidth };
    const available = onLeft ? bounds.right - Math.max(edge, column.left) : Math.min(edge, column.right) - bounds.left;
    if (column.width > available + gap && available > 0) {
      const separated = onLeft ? column.left >= menu.right - 2 : column.right <= menu.left + 2;
      set(content, { 'min-width': '0', 'max-width': Math.floor(separated ? available : rowWidth) + 'px',
        'box-sizing': 'border-box' });
    }

    const title = new Range();
    title.selectNodeContents(heading);
    const text = title.getBoundingClientRect();
    const area = content.getBoundingClientRect();
    const padding = 'padding-' + side;
    const inset = parseFloat(stylesheet.getPropertyValue(padding)) || 0;
    const overlap = onLeft ? menu.right - text.left : area.right - inset - menu.left;
    if (overlap > 2 && available > 0) {
      set(content, { [padding]: Math.ceil(inset + overlap + gap) + 'px', 'box-sizing': 'border-box' });
    }
  }

  function fixedWithin(root: HTMLElement, elements: Set<HTMLElement>) {
    function collect(element: Element) {
      if (element !== body && !element.hasAttribute('data-alignread-host') && element instanceof HTMLElement && getComputedStyle(element).position === 'fixed' &&
          element.offsetParent === null && element.offsetWidth > 0) elements.add(element);
    }
    collect(root);
    for (const element of root.querySelectorAll('*')) collect(element);
  }

  function fitEdgeBars(candidates: Set<HTMLElement>) {
    if (!candidates.size) return;
    const pane = body.getBoundingClientRect();
    const width = body.clientWidth;
    const right = pane.left + width;
    for (const element of candidates) {
      const original = element.getBoundingClientRect();
      if (original.width > width + 2) {
        set(element, { 'min-width': '0', 'max-width': width + 'px', 'box-sizing': 'border-box' });
      }
      const rect = element.getBoundingClientRect();
      if (getComputedStyle(element).position === 'fixed' && element.offsetParent === null) {
        const viewportGap = window.innerWidth - original.right;
        const gap = viewportGap > 0 && viewportGap <= 32 && rect.width + viewportGap <= width ? viewportGap : 0;
        const left = Math.max(pane.left, Math.min(rect.left, right - rect.width - gap));
        if (Math.abs(left - rect.left) > 1) {
          const margin = parseFloat(getComputedStyle(element).marginLeft) || 0;
          set(element, { left: Math.round(element.offsetLeft - margin + left - rect.left) + 'px',
            right: 'auto', width: element.offsetWidth + 'px', 'box-sizing': 'border-box' });
        }
      }
      if (rect.width < width * .55 || rect.bottom < pane.bottom - 24) continue;
      for (const button of element.querySelectorAll('button,[role=button],input[type=button]')) {
        if (button instanceof HTMLElement) {
          set(button, { 'white-space': 'nowrap', 'overflow-wrap': 'normal', 'word-break': 'normal',
            'min-width': 'max-content', 'flex-shrink': '0' });
        }
      }
    }
  }

  const observer = new MutationObserver((records) => {
    for (const [element, saved] of overridden) {
      if (!body.contains(element)) restoreElement(element, saved);
    }
    const candidates = new Set<HTMLElement>();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && body.contains(node)) fixedWithin(node, candidates);
      }
    }
    fitEdgeBars(candidates);
  });

  function fit(layout?: SidebarLayout) {
    restore();
    const width = body.clientWidth;
    const reading = new Set<HTMLElement>();
    for (const element of body.querySelectorAll<HTMLElement>(readingSelector)) {
      for (let parent: HTMLElement | null = element; parent && parent !== body; parent = parent.parentElement) {
        if (!layout?.sidebarBranch.contains(parent)) reading.add(parent);
      }
    }
    for (const element of reading) {
      if (element.getBoundingClientRect().width > width + 4) {
        set(element, { 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box' });
      }
    }
    const candidates = new Set<HTMLElement>();
    fixedWithin(body, candidates);
    for (const element of body.querySelectorAll(edgeCandidates)) {
      if (element instanceof HTMLElement && getComputedStyle(element).position === 'sticky') candidates.add(element);
    }
    fitEdgeBars(candidates);
    if (layout) fitSidebar(layout, width);
  }

  return {
    fit,
    observe() { observer.observe(body, { childList: true, subtree: true }); },
    close() { observer.disconnect(); restore(); },
  };
}
