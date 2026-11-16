import type { Block } from '../extraction/document';

type Side = 'source' | 'target';
function scrollRoot(blocks: Block[], sourceViewport: HTMLElement) {
  const scrollable = new WeakMap<HTMLElement, boolean>();
  const counts = new Map<HTMLElement, number>();
  for (const block of blocks) {
    for (let element = block.source; element !== sourceViewport && element.parentElement; element = element.parentElement) {
      let overflow = scrollable.get(element);
      if (overflow === undefined) {
        overflow = /auto|scroll|overlay/.test(getComputedStyle(element).overflowY) &&
          element.scrollHeight > element.clientHeight + 2;
        scrollable.set(element, overflow);
      }
      if (!overflow) continue;
      const count = (counts.get(element) ?? 0) + 1;
      if (count > blocks.length / 2) return element;
      counts.set(element, count);
      break;
    }
  }
  return sourceViewport;
}

function atEnd(root: HTMLElement) {
  return root.scrollHeight > root.clientHeight &&
    Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop) < 3;
}

export function connectAlignment({
  blocks, primary, targets, sourceViewport, targetRoot, syncEnabled, highlightEnabled, showHighlight, signal,
}: {
  blocks: Block[]; primary: Block[]; targets: Map<string, HTMLElement>; sourceViewport: HTMLElement; targetRoot: HTMLElement;
  syncEnabled: () => boolean; highlightEnabled: () => boolean;
  showHighlight: (id: string | null) => void; signal: AbortSignal;
}) {
  const sourceRoot = scrollRoot(primary, sourceViewport);
  const sourceHeaders = Array.from(sourceViewport.querySelectorAll<HTMLElement>('header,nav,[role=banner],[role=navigation]'))
    .filter((element) => /^(fixed|sticky)$/.test(getComputedStyle(element).position));
  const sourceById = new Map(blocks.map((block) => [block.id, block]));
  const primaryIds = new Set(primary.map((block) => block.id));
  const sourceElements = new WeakMap<HTMLElement, Block[]>();
  const visible = { source: new Set<string>(), target: new Set<string>() };
  for (const block of blocks) {
    const entries = sourceElements.get(block.source) ?? [];
    entries.push(block);
    sourceElements.set(block.source, entries);
  }
  const style = new CSSStyleSheet();
  style.replaceSync('::highlight(alignread-paragraph) { background: #f7dd8c; color: #17211c; text-decoration: underline solid #866226; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];
  let highlightTimer = 0;
  let frame = 0;
  let suppression: { side: Side; expires: number } | undefined;
  const events = new AbortController();
  const registry = typeof Highlight !== 'undefined' ? CSS.highlights : undefined;

  const sourceObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      for (const block of sourceElements.get(entry.target as HTMLElement) ?? []) {
        if (!primaryIds.has(block.id)) continue;
        if (entry.isIntersecting) visible.source.add(block.id);
        else visible.source.delete(block.id);
      }
    }
  }, { root: sourceRoot, rootMargin: '120px 0px' });
  const targetObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.readerBlock!;
      if (entry.isIntersecting) visible.target.add(id);
      else visible.target.delete(id);
    }
  }, { root: targetRoot, rootMargin: '120px 0px' });
  for (const block of primary) {
    sourceObserver.observe(block.source);
    const target = targets.get(block.id);
    if (target) targetObserver.observe(target);
  }

  function rect(side: Side, id: string): DOMRect | undefined {
    if (side === 'target') return targets.get(id)?.getBoundingClientRect();
    const block = sourceById.get(id);
    if (block?.range.startContainer.isConnected) return block.range.getBoundingClientRect();
  }

  function anchorTop(root: HTMLElement, side: Side) {
    const bounds = root.getBoundingClientRect();
    if (side === 'target') return bounds.top + 12;
    let edge = bounds.top;
    for (const header of sourceHeaders) {
      const rect = header.getBoundingClientRect();
      const overlap = Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left);
      if (rect.top <= bounds.top + 12 && rect.bottom > bounds.top && rect.height <= root.clientHeight / 3 && overlap >= bounds.width / 2) {
        edge = Math.max(edge, rect.bottom);
      }
    }
    return edge + 12;
  }

  function scrollTo(side: Side, id: string, adjustment = 0) {
    const bounds = rect(side, id);
    if (!bounds) return;
    const block = sourceById.get(id);
    const root = side === 'target' ? targetRoot : block && sourceRoot.contains(block.source) ? sourceRoot : sourceViewport;
    const y = root.scrollTop + bounds.top - anchorTop(root, side) + adjustment;
    if (Math.abs(y - root.scrollTop) < 2) return;
    suppression = { side, expires: performance.now() + 180 };
    root.scrollTo({ top: y, behavior: 'instant' });
  }

  function anchor(side: Side) {
    const root = side === 'source' ? sourceRoot : targetRoot;
    if (atEnd(root)) return { id: primary.at(-1)?.id, fraction: 0 };
    const viewportTop = anchorTop(root, side);
    let chosen: string | undefined;
    let nearest = Infinity;
    let fraction = 0;
    function compare(ids: Iterable<string>) {
      for (const id of ids) {
        const bounds = rect(side, id);
        if (!bounds || bounds.height <= 0) continue;
        const distance = Math.max(bounds.top - viewportTop, viewportTop - bounds.bottom, 0);
        if (distance >= nearest) continue;
        chosen = id;
        nearest = distance;
        fraction = Math.max(0, Math.min(.95, (viewportTop - bounds.top) / bounds.height));
      }
    }
    compare(visible[side]);
    // Scrollbar jumps can outrun IntersectionObserver's last delivered viewport.
    if (nearest > 48) compare(primaryIds);
    return { id: chosen, fraction };
  }

  function follow(side: Side) {
    if (!syncEnabled() || selecting()) return;
    if (suppression?.side === side && suppression.expires > performance.now()) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!syncEnabled() || selecting()) return;
      const { id, fraction } = anchor(side);
      if (!id) return;
      const other = side === 'source' ? 'target' : 'source';
      scrollTo(other, id, (rect(other, id)?.height ?? 0) * fraction);
    });
  }

  function selecting() {
    const selection = document.getSelection();
    return selection?.isCollapsed === false;
  }

  function paint(id: string | null, force = false) {
    clearTimeout(highlightTimer);
    registry?.delete('alignread-paragraph');
    const ranges = id ? sourceById.get(id)?.ranges : undefined;
    if (id && ranges && (force || highlightEnabled()) && ranges.every((range) => range.startContainer.isConnected)) {
      registry?.set('alignread-paragraph', new Highlight(...ranges));
      showHighlight(id);
    } else showHighlight(null);
  }

  function locate(side: Side, id: string) {
    paint(id, true);
    if (side === 'target') revealHorizontalTarget(id);
    if (primaryIds.has(id)) scrollTo(side, id);
    else {
      const element = side === 'source' ? sourceById.get(id)?.source : targets.get(id);
      suppression = { side, expires: performance.now() + 180 };
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    highlightTimer = window.setTimeout(() => paint(null), 1500);
  }

  function revealHorizontalTarget(id: string) {
    const element = targets.get(id);
    const viewport = element?.closest<HTMLElement>('.table-scroll,[data-reading-navigation=tabs]');
    if (!element || !viewport || viewport.scrollWidth <= viewport.clientWidth) return;
    const bounds = element.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    if (bounds.left < visible.left) viewport.scrollBy({ left: bounds.left - visible.left, behavior: 'instant' });
    else if (bounds.right > visible.right) viewport.scrollBy({ left: bounds.right - visible.right, behavior: 'instant' });
  }

  function sourcePointer(event: MouseEvent) {
    if (event.composedPath().some((element) => element instanceof HTMLElement && element.hasAttribute('data-alignread-host'))) return;
    for (const element of event.composedPath()) {
      if (!(element instanceof HTMLElement)) continue;
      const candidates = sourceElements.get(element);
      if (!candidates) continue;
      const match = candidates.find((block) => Array.from(block.range.getClientRects())
        .some((bounds) => event.clientY >= bounds.top && event.clientY <= bounds.bottom));
      paint((match ?? candidates[0])?.id ?? null);
      return;
    }
    paint(null);
  }

  function sourceClick(event: MouseEvent) {
    if (selecting() || event.defaultPrevented || event.button !== 0 || event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof HTMLElement) ||
        event.target.closest('a,button,input,textarea,summary,select,label,[contenteditable],[role=button],[data-alignread-host]')) return;
    for (const element of event.composedPath()) {
      const candidates = element instanceof HTMLElement ? sourceElements.get(element) : undefined;
      if (!candidates) continue;
      const match = candidates.find((block) => Array.from(block.range.getClientRects())
        .some((bounds) => event.clientY >= bounds.top && event.clientY <= bounds.bottom));
      if (match) locate('target', match.id);
      return;
    }
  }

  const listener = { signal: events.signal, passive: true };
  sourceRoot.addEventListener('scroll', () => follow('source'), listener);
  targetRoot.addEventListener('scroll', () => follow('target'), listener);
  for (const name of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
    sourceRoot.addEventListener(name, (event) => {
      if (!event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute('data-alignread-host'))) {
        suppression = undefined;
      }
    }, listener);
    targetRoot.addEventListener(name, () => { suppression = undefined; }, listener);
  }
  document.addEventListener('pointerover', sourcePointer, listener);
  document.addEventListener('click', sourceClick, listener);
  document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) paint(null); }, listener);
  signal.addEventListener('abort', () => {
    events.abort();
    sourceObserver.disconnect();
    targetObserver.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(highlightTimer);
    registry?.delete('alignread-paragraph');
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== style);
  }, { once: true });

  return { paint, locate };
}
