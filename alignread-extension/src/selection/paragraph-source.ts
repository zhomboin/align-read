import { readableText, selectedTextNodes, selectionRange } from './source';

const excluded = 'pre,[role=button],[translate=no i],.notranslate,[data-alignread-selection]';
const inlineCode = 'code,kbd,samp,[role=code]';
const protectedHost = 'a,button,label,summary,[role=button],[contenteditable]:not([contenteditable=false])';
const paragraphTags = 'p,li,blockquote,dt,dd,td,th,figcaption,h1,h2,h3,h4,h5,h6,[role=paragraph]';

export type Paragraph = {
  owner: HTMLElement;
  first: Text;
  text: string;
  parent: Element;
  anchor: Node | null;
  after: boolean;
};

function isBlock(element: HTMLElement) {
  const display = getComputedStyle(element).display;
  return element.matches(paragraphTags) ||
    /^(block|flow-root|flex|grid|table|list-item)/.test(display) ||
    (element.tagName === 'DIV' && display.startsWith('inline-'));
}

function ownerOf(node: Text) {
  for (let element = node.parentElement; element; element = element.parentElement) {
    if (element instanceof HTMLElement && isBlock(element)) return element;
  }
}

function placement(owner: HTMLElement, boundary?: Element) {
  if (boundary?.parentElement) {
    if (boundary.parentElement.closest(protectedHost)) return;
    return { parent: boundary.parentElement, anchor: boundary, after: boundary.tagName === 'BR' };
  }
  const parent = owner.parentElement;
  if (!parent || owner.closest(protectedHost)) return;
  if (owner.matches('body,li,dt,dd,td,th,caption') || /flex|grid/.test(getComputedStyle(parent).display)) {
    return { parent: owner, anchor: null, after: false };
  }
  return { parent, anchor: owner, after: true };
}

function paragraphsIn(owner: HTMLElement, readable: ReturnType<typeof readableText>, touched?: Set<Text>) {
  const result: Paragraph[] = [];
  let first: Text | undefined;
  let parts: string[] = [];
  let selected = false;
  let hasProse = false;

  function finish(boundary?: Element) {
    if (first && hasProse && (selected || !touched)) {
      const position = placement(owner, boundary);
      if (position) result.push({ owner, first, text: parts.join('').replace(/\s+/gu, ' ').trim(), ...position });
    }
    first = undefined;
    parts = [];
    selected = false;
    hasProse = false;
  }

  function visit(node: Node) {
    if (node instanceof Text) {
      if (!readable(node)) return;
      if (node.data.trim()) {
        first ??= node;
        if (!hasProse) hasProse = !node.parentElement?.closest(inlineCode);
      }
      parts.push(node.data);
      if (touched?.has(node)) selected = true;
    } else if (node instanceof HTMLElement && !node.hasAttribute('data-alignread-paragraph') &&
      getComputedStyle(node).display !== 'none') {
      if (node.tagName === 'BR' || isBlock(node)) finish(node);
      else if (!node.matches(excluded)) node.childNodes.forEach(visit);
    }
  }

  owner.childNodes.forEach(visit);
  finish();
  return result;
}

export function selectedParagraphs() {
  const range = selectionRange();
  if (!range) return [];
  const readable = readableText(excluded);
  const owners = new Map<HTMLElement, Set<Text>>();
  for (const { node, start, end } of selectedTextNodes(range)) {
    if (!readable(node, start, end)) continue;
    const owner = ownerOf(node);
    if (!owner) continue;
    const touched = owners.get(owner) ?? new Set<Text>();
    touched.add(node);
    owners.set(owner, touched);
  }
  return Array.from(owners).flatMap(([owner, touched]) => paragraphsIn(owner, readable, touched))
    .sort((a, b) => (a.first.compareDocumentPosition(b.first) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
}

export function matchesParagraph(source: Paragraph) {
  if (!source.first.isConnected || ownerOf(source.first) !== source.owner) return false;
  return paragraphsIn(source.owner, readableText(excluded), new Set([source.first])).some(current =>
    current.first === source.first && current.text === source.text && current.parent === source.parent &&
    current.anchor === source.anchor && current.after === source.after);
}
