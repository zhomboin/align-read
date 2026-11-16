const excluded = [
  'form', 'input', 'textarea', 'select', 'button', '[contenteditable]:not([contenteditable=false])',
  '[role=textbox]', '[role=combobox]', '[role=spinbutton]', '[role=searchbox]',
  '.monaco-editor', '.CodeMirror', '.cm-editor', 'script', 'style', 'noscript', 'template',
  'iframe', 'canvas', 'svg', 'object', '[hidden]', '[inert]', '[aria-hidden=true]', '[data-alignread-host]',
].join(',');

export type SelectedText = { range: Range; text: string };

export function readSelection(): SelectedText | undefined {
  const selection = document.getSelection();
  if (document.designMode === 'on' || !selection || selection.isCollapsed || selection.rangeCount !== 1 ||
      document.activeElement?.closest(excluded)) return;
  const range = selection.getRangeAt(0);
  if (!document.body?.contains(range.commonAncestorContainer) ||
      range.startContainer.getRootNode() !== document || range.endContainer.getRootNode() !== document) return;
  const text = selection.toString().trim();
  if (!text) return;

  const visibility = new Map<Element, boolean>();
  const textRange = document.createRange();
  function allowed(element: Element | null): boolean {
    if (!element) return true;
    const known = visibility.get(element);
    if (known !== undefined) return known;
    const style = getComputedStyle(element);
    const visible = !element.matches(excluded) && style.display !== 'none' && style.visibility === 'visible' &&
      style.opacity !== '0' && style.contentVisibility !== 'hidden' && allowed(element.parentElement);
    visibility.set(element, visible);
    return visible;
  }
  function readable(node: Text) {
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.length;
    if (!node.data.slice(start, end).trim()) return true;
    if (!allowed(node.parentElement)) return false;
    textRange.setStart(node, start);
    textRange.setEnd(node, end);
    return Array.from(textRange.getClientRects()).some(({ width, height }) => width > 0 && height > 0);
  }

  const root = range.commonAncestorContainer;
  if (root instanceof Text) {
    if (!readable(root)) return;
  } else {
    const nodes = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      if (node instanceof Text && !readable(node)) return;
    }
  }
  return { text, range: range.cloneRange() };
}

export function sameSelection(first: SelectedText, second?: SelectedText) {
  return Boolean(second && first.text === second.text &&
    first.range.compareBoundaryPoints(Range.START_TO_START, second.range) === 0 &&
    first.range.compareBoundaryPoints(Range.END_TO_END, second.range) === 0);
}
