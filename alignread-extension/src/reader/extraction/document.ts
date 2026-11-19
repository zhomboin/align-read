import type { ReadingRange } from '../../shared/reader-messages';
import type { SidebarLayout } from '../layout/sidebar';
import { inlineEmphasis, readInlineAppearance, readSurface, textWhiteSpace, type Surface } from './appearance';

const inlineTags = {
  B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', CODE: 'code', KBD: 'kbd', SAMP: 'samp',
  DEL: 'del', S: 's', INS: 'ins', U: 'u', MARK: 'mark', SUB: 'sub', SUP: 'sup', SMALL: 'small', VAR: 'var',
} as const;
export type Mark = (typeof inlineTags)[keyof typeof inlineTags];
export type Piece = {
  id: string; text: string; translate: boolean; marks: Mark[]; href?: string; lineBreak?: true;
};
export type ReplacementFragment = string | Piece;
export type Block = {
  id: string; tag: 'p' | 'pre' | 'figcaption' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'span' | 'summary';
  pieces: Piece[]; source: HTMLElement; range: Range; ranges: Range[]; snapshots: Map<Text, string>;
  replacements?: Map<Text, ReplacementFragment[]>;
  whiteSpace?: ReturnType<typeof textWhiteSpace>;
  inlineAppearance?: ReturnType<typeof readInlineAppearance>;
};
type BranchTag = 'ul' | 'ol' | 'li' | 'blockquote' | 'table' | 'thead' | 'tbody' | 'tfoot' |
  'tr' | 'td' | 'th' | 'caption' | 'figure' | 'section' | 'div' | 'dl' | 'dt' | 'dd';
type Branch = {
  tag: BranchTag; children: ReadingNode[]; label?: string; span?: number; rowSpan?: number; start?: number;
  side?: SidebarLayout['side']; area?: 'sidebar' | 'content';
  columns?: 'ltr' | 'rtl'; columnWeight?: number; listRow?: true;
  inlineRow?: { direction: 'ltr' | 'rtl'; align: 'start' | 'center' | 'end' | 'left' | 'right' };
  compactRow?: { direction: 'ltr' | 'rtl'; scroll?: true; reverse?: true; rowGap: number; columnGap: number };
  navigation?: NavigationLayout; current?: boolean;
  surface?: Surface; disclosure?: 'open' | 'closed';
  listColumns?: number; marker?: string; reversed?: boolean; listValue?: number;
  scope?: string; align?: 'left' | 'right' | 'center' | 'start' | 'end' | 'justify';
  captionSide?: 'bottom';
  codeCell?: true;
};
type ImagePlaceholder = { tag: 'image'; alt: string; width: number; height: number };
export type ReadingNode = Block | Branch | ImagePlaceholder | { tag: 'hr' };
export type Article = { nodes: ReadingNode[]; blocks: Block[]; scope: HTMLElement };

const excluded = [
  'script', 'style', 'noscript', 'template', 'iframe', 'canvas', 'svg', 'audio', 'video', 'object',
  'input', 'textarea', 'select', 'button:not([role=tablist] [role=tab])', 'form', 'option',
  '[contenteditable]:not([contenteditable=false])',
  '[role=textbox]', '[role=button]', '[role=combobox]', '[role=dialog]', '[aria-hidden=true]', '[hidden]',
  '[data-alignread-host]', '[data-ad-slot]', '[inert]', 'dialog', '.monaco-editor', '.CodeMirror', '.cm-editor',
].join(',');
const codeTextSelector = 'pre,code,kbd,samp,[role~=code]';
const replacementExcluded = [
  excluded, 'button', '[role=searchbox]', '[role=spinbutton]', '[role=slider]',
  codeTextSelector,
  '[translate=no i]', '.notranslate', '[data-alignread-selection]',
].join(',');
const structural = new Set(['UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
  'TR', 'TD', 'TH', 'CAPTION', 'FIGURE', 'DETAILS', 'DL', 'DT', 'DD']);
const surfaceContainers = new Set(['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'NAV', 'HEADER', 'FOOTER',
  'FIGURE', 'DETAILS', 'BLOCKQUOTE', 'LI']);
const markers = /^(none|disc|circle|square|decimal|decimal-leading-zero|lower-(alpha|latin|roman|greek)|upper-(alpha|latin|roman))$/;
const regions = new Map([
  ['HEADER', '页首'], ['NAV', '导航'], ['MAIN', '正文'], ['ARTICLE', '文章'],
  ['ASIDE', '侧栏'], ['FOOTER', '页脚'],
]);
const semanticBlock = /^(P|H[1-6]|FIGCAPTION|SUMMARY)$/;
const protectedText = /(https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b[vV]?\d+(?:\.\d+)+(?:[-+][\w.]+)?\b|(?:^|(?<=\s))--?[a-z][\w-]*|\b[A-Za-z][\w]*(?:_[\w]+|\.[A-Za-z][\w]*|[a-z][A-Z][\w]*)\b|\b[\w.]+@[\w.-]+\.[A-Za-z]+\b)/g;
const word = /\p{L}/u;
const mainExcluded = 'nav,aside,footer,[role=navigation],[role=complementary],[role=banner],[role=contentinfo]';

type TextRun = { node: Text; text: string; translate: boolean; marks: Mark[]; href?: string };
const lineBreak = Symbol('lineBreak');
type Run = TextRun | typeof lineBreak;
type Column = { start: number; end: number; bounds: DOMRect; element: HTMLElement; style: CSSStyleDeclaration };
type NavigationLayout = { style: 'links' | 'tabs'; direction: 'ltr' | 'rtl'; vertical: boolean };
type NavigationItem = { control: HTMLElement; bounds: DOMRect; current: boolean };

export function canReplaceText(node: Text) {
  const parent = node.parentElement;
  return node.getRootNode() === document && parent instanceof HTMLElement &&
    !(parent instanceof HTMLDetailsElement && !parent.open) &&
    replacementAllowed(parent) && visibleContext(parent, true);
}

export async function extractArticle(
  range: ReadingRange, signal: AbortSignal, sidebar?: SidebarLayout, skipText?: (node: Text) => boolean,
  replacement?: { readText(node: Text): string },
): Promise<Article> {
  const mainOnly = range === 'main';
  const scope = (mainOnly ? mainContent(replacement ? replacementAllowed : undefined) : undefined) ?? document.body;
  const blocks: Block[] = [];
  let visited = 0;

  async function pulse() {
    if (++visited % 140 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal.throwIfAborted();
  }

  function readableStyle(element: HTMLElement) {
    if (replacement ? !replacementAllowed(element) : element.matches(excluded)) return undefined;
    if (mainOnly && (element === sidebar?.sidebarBranch ||
        element.matches(mainExcluded) && !element.matches('[role=tablist]'))) return undefined;
    const style = getComputedStyle(element);
    return visible(element, style) ? style : undefined;
  }

  function sourceText(node: Text) {
    return replacement?.readText(node) ?? node.data;
  }

  function block(source: HTMLElement, tag: Block['tag'], runs: Run[]) {
    if (skipText) runs = runs.filter((run) => run === lineBreak || !skipText(run.node));
    const textRuns = runs.filter((run) => run !== lineBreak);
    if (!textRuns.some((run) => run.text.trim())) return undefined;
    const id = 'b' + (blocks.length + 1);
    const whiteSpace = tag === 'pre' ? undefined : textWhiteSpace(getComputedStyle(source));
    const mapped = replacement ? replacementPieces(id, textRuns) : undefined;
    const pieces = mapped?.pieces ?? readingPieces(id, tag, whiteSpace, runs);
    const range = new Range();
    range.setStart(textRuns[0]!.node, 0);
    const last = textRuns.at(-1)!.node;
    range.setEnd(last, last.length);
    const ranges = textRuns.map(({ node }) => {
      const highlight = new Range();
      highlight.selectNodeContents(node);
      return highlight;
    });
    const snapshots = new Map(textRuns.map(({ node, text }) => [node, replacement ? text : node.data]));
    const entry: Block = { id, tag, pieces, source, range, ranges, snapshots, whiteSpace };
    if (mapped) entry.replacements = mapped.replacements;
    blocks.push(entry);
    return entry;
  }

  async function inline(
    node: Node, runs: Run[], marks: Mark[] = [], href?: string, locked = false, codeLines = false,
  ) {
    await pulse();
    if (node instanceof Text) {
      const text = sourceText(node);
      if (text) runs.push({ node, text, translate: !locked, marks, href });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const style = readableStyle(node);
    if (!style) return;
    if (node.tagName === 'BR') {
      runs.push(lineBreak);
      return;
    }
    const mark: Mark | undefined = inlineTags[node.tagName as keyof typeof inlineTags] ??
      (node.matches('[role~=code]') ? 'code' : undefined);
    const newMarks = (mark ? [mark] : inlineEmphasis(node)).filter((item) => !marks.includes(item));
    const nextMarks = newMarks.length ? [...marks, ...newMarks] : marks;
    const preserveCode = locked || node.matches(codeTextSelector) || isCodeBlock(node, style);
    if (replacement && preserveCode) return;
    const link = node instanceof HTMLAnchorElement ? safeLink(node.getAttribute('href')) : href;
    const first = runs.length;
    let previousWasBlock = false;
    for (const child of displayedChildren(node)) {
      if (codeLines && child instanceof Text && /^(normal|nowrap)$/.test(style.whiteSpace) &&
          /[\r\n]/.test(child.data) && !child.data.trim()) continue;
      const index = runs.length;
      await inline(child, runs, nextMarks, link, preserveCode, codeLines);
      if (!codeLines || runs.length === index) continue;
      const childIsBlock = child instanceof HTMLElement && isBlockDisplay(getComputedStyle(child).display);
      if (index > first && (previousWasBlock || childIsBlock)) {
        const previous = runs[index - 1]!;
        if (previous !== lineBreak && !/[\r\n]$/.test(previous.text)) runs.splice(index, 0, lineBreak);
      }
      previousWasBlock = childIsBlock;
    }
  }

  async function copyCode(element: HTMLElement) {
    if (replacement) return undefined;
    const runs: Run[] = [];
    await inline(element, runs, [], undefined, true, true);
    return block(element, 'pre', runs);
  }

  async function readNavigation(element: HTMLElement): Promise<ReadingNode | undefined> {
    const explicit = element.matches('[role=tablist]');
    if (!explicit && !element.matches('ul,ol')) return undefined;
    const items: NavigationItem[] = [];
    for (const child of element.children) {
      await pulse();
      if (!(child instanceof HTMLElement) || !readableStyle(child)) continue;
      const control = explicit
        ? child.matches('[role=tab]') ? child : child.querySelector<HTMLElement>('[role=tab]')
        : listLink(child);
      if (!control || !readableStyle(control) || !visibleContext(control, true) ||
          explicit && control.closest('[role=tablist]') !== element) {
        const visibleRuns: Run[] = [];
        await inline(child, visibleRuns);
        if (visibleRuns.some((run) => run !== lineBreak && run.text.trim())) return undefined;
        continue;
      }
      const bounds = control.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) items.push({
        control, bounds, current: isCurrent(control) || isCurrent(child),
      });
    }
    if (!items.length || !explicit && !items.some(({ bounds }, index) => {
      if (index === 0) return false;
      const previous = items[index - 1]!.bounds;
      return sameRow(previous, bounds) && (previous.right <= bounds.left + 1 || bounds.right <= previous.left + 1);
    })) return undefined;

    const direction = getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr';
    const vertical = explicit && element.getAttribute('aria-orientation') === 'vertical';
    const style = explicit || element.matches('.tabs,.tab-list,.nav-tabs,[data-tabs]') || items.some((item) => item.current)
      ? 'tabs' : 'links';
    if (!vertical && items.every(({ bounds }) => sameRow(items[0]!.bounds, bounds))) {
      items.sort((a, b) => direction === 'rtl' ? b.bounds.right - a.bounds.right : a.bounds.left - b.bounds.left);
    }
    const children: ReadingNode[] = [];
    for (const { control, current } of items) {
      const group: Run[] = [];
      await inline(control, group);
      const entry = block(control, 'span', group);
      if (entry) children.push({ tag: 'li', children: [entry], current });
    }
    if (children.length) return {
      tag: element.tagName === 'OL' ? 'ol' : 'ul',
      children, label: element.getAttribute('aria-label') ?? undefined, navigation: { style, direction, vertical },
    };
  }

  async function readInlineRow(parent: HTMLElement, layout: CSSStyleDeclaration): Promise<Branch | undefined> {
    if (!/^(block|flow-root)$/.test(layout.display)) return undefined;
    const items: { element: HTMLElement; style: CSSStyleDeclaration }[] = [];
    let atomic = false;
    for (const child of parent.childNodes) {
      if (child instanceof Text && child.data.trim()) return undefined;
      if (!(child instanceof HTMLElement)) continue;
      await pulse();
      const style = readableStyle(child);
      if (!style) continue;
      if (!child.matches('span,a') || child.firstElementChild || !child.textContent?.trim()) return undefined;
      if (!/^inline(?:-(?:block|flex|grid))?$/.test(style.display) ||
          !/^(static|relative)$/.test(style.position) || style.cssFloat !== 'none') return undefined;
      atomic ||= style.display !== 'inline';
      items.push({ element: child, style });
    }
    if (items.length < 2 || !atomic) return undefined;

    let previous: DOMRect | undefined;
    for (const { element } of items) {
      const rects = element.getClientRects();
      const bounds = rects[0];
      if (rects.length !== 1 || !bounds?.width || !bounds.height) return undefined;
      if (previous && (!sameRow(previous, bounds) ||
          (previous.right > bounds.left + 1 && bounds.right > previous.left + 1))) return undefined;
      previous = bounds;
    }

    const children: Block[] = [];
    for (const { element, style } of items) {
      const group: Run[] = [];
      await inline(element, group);
      const entry = block(element, 'span', group);
      if (entry) {
        entry.inlineAppearance = readInlineAppearance(style, layout);
        children.push(entry);
      }
    }
    const { textAlign, direction } = layout;
    const align = textAlign === 'center' || textAlign === 'end' || textAlign === 'left' || textAlign === 'right'
      ? textAlign : 'start';
    return { tag: 'div', children, inlineRow: { align, direction: direction === 'rtl' ? 'rtl' : 'ltr' } };
  }

  async function visit(parent: HTMLElement): Promise<ReadingNode[]> {
    const result: ReadingNode[] = [];
    const columns: Column[] = [];
    const structuralParent = structural.has(parent.tagName);
    const listItem = !replacement && parent.tagName === 'LI';
    const layout = parent.children.length > 1 && parent !== sidebar?.row && (!structuralParent || listItem)
      ? getComputedStyle(parent) : undefined;
    const inlineRow = !replacement && !structuralParent && layout && await readInlineRow(parent, layout);
    if (inlineRow) return [inlineRow];
    const flexOrGrid = /^(inline-)?(flex|grid)$/.test(layout?.display ?? '');
    const listRow = listItem && flexOrGrid;
    const keepEmptyCells = listRow && layout?.display.endsWith('grid');
    let runs: Run[] = [];
    const flush = () => {
      const entry = block(parent, parent.matches('li,td,th,caption,dt,dd') ? 'span' : 'p', runs);
      if (entry) result.push(entry);
      runs = [];
    };
    for (const child of displayedChildren(parent)) {
      await pulse();
      if (child instanceof Text) {
        const text = sourceText(child);
        if (text) runs.push({ node: child, text, translate: true, marks: [] });
        continue;
      }
      if (!(child instanceof HTMLElement)) continue;
      const style = readableStyle(child);
      if (!style) continue;
      const tag = child.tagName;
      const bounds = layout && (!structuralParent || listRow) && columnBounds(child, style, flexOrGrid, keepEmptyCells);
      if (bounds) flush();
      const start = result.length;
      const area = !mainOnly && sidebar?.row === parent
        ? child === sidebar.sidebarBranch ? 'sidebar' : child === sidebar.content ? 'content' : undefined
        : undefined;
      const couldBeNavigation = !replacement && !area && child.matches('ul,ol,[role=tablist]');
      if (couldBeNavigation) flush();
      const navigation = couldBeNavigation ? await readNavigation(child) : undefined;
      const image = !area && placeholderFor(child);
      if (area) {
        flush();
        const children = await visit(child);
        if (children.length) result.push({ tag: 'section', children, area, label: area === 'sidebar' ? '导航' : '正文' });
      } else if (navigation) {
        result.push(navigation);
      } else if (image || tag === 'HR') {
        flush();
        result.push(image || { tag: 'hr' });
      } else if (isCodeBlock(child, style)) {
        flush();
        if (replacement) continue;
        const entry = await copyCode(child);
        if (structural.has(tag)) {
          const branch = structure(child, entry ? [entry] : [], style);
          if (child instanceof HTMLTableCellElement) branch.codeCell = true;
          result.push(branch);
        } else if (entry) {
          result.push(entry);
        }
      } else if (semanticBlock.test(tag)) {
        flush();
        const group: Run[] = [];
        await inline(child, group);
        const entry = block(child, tag.toLowerCase() as Block['tag'], group);
        if (entry) result.push(entry);
      } else if (structural.has(tag) || regions.has(tag) || isContainer(child, style.display)) {
        flush();
        const children = await visit(child);
        if (children.length || !replacement && child instanceof HTMLTableCellElement) {
          const surface = surfaceContainers.has(tag) && style.display !== 'contents' ? readSurface(style) : undefined;
          if (structural.has(tag)) {
            result.push(structure(child, children, style, surface));
          } else if (regions.has(tag)) {
            result.push({ tag: 'section', children, label: regions.get(tag), surface });
          } else if (surface || child.parentElement?.tagName === 'DL') {
            result.push({ tag: 'div', children, surface });
          } else {
            result.push(...children);
          }
        }
      } else if (bounds || tag === 'A' && isBlockDisplay(style.display)) {
        flush();
        const group: Run[] = [];
        await inline(child, group);
        const entry = block(child, 'p', group);
        if (entry) result.push(entry);
      } else {
        await inline(child, runs);
      }
      if (bounds && (start < result.length || keepEmptyCells)) {
        columns.push({ start, end: result.length, bounds, element: child, style });
      }
    }
    flush();
    if (!mainOnly && sidebar?.row === parent) {
      const menu = result.find((node) => 'area' in node && node.area === 'sidebar');
      const content = result.find((node) => 'area' in node && node.area === 'content');
      if (menu && content) {
        const children = sidebar.side === 'left' ? [menu, content] : [content, menu];
        const row: ReadingNode = { tag: 'section', children, side: sidebar.side };
        return result.filter((node) => node !== menu).map((node) => node === content ? row : node);
      }
    }
    const compact = !replacement && !structuralParent && layout && compactFlexRow(parent, result, columns, layout);
    return compact ? [compact] : arrangeColumns(result, columns, layout?.direction === 'rtl' ? 'rtl' : 'ltr', listRow);
  }

  let nodes: ReadingNode[] = [];
  if (visibleContext(scope, Boolean(replacement)) && (!replacement || replacementAllowed(scope))) {
    if (scope.matches(codeTextSelector) || isCodeBlock(scope, getComputedStyle(scope))) {
      const entry = await copyCode(scope);
      if (entry) nodes.push(entry);
    } else {
      nodes = await visit(scope);
    }
  }
  return { nodes, blocks, scope };
}

function readingPieces(id: string, tag: Block['tag'], whiteSpace: Block['whiteSpace'], runs: Run[]) {
  const pieces: Piece[] = [];
  const appendBreak = () => {
    pieces.push({ id: id + 'p' + pieces.length, text: '', translate: false, marks: [], lineBreak: true });
  };
  for (const run of runs) {
    if (run === lineBreak) {
      appendBreak();
      continue;
    }
    // Keep actual line boundaries local so a provider cannot collapse them.
    const segments = tag !== 'pre' && whiteSpace
      ? run.text.split(/(\r\n|\r|\n)/) : [run.text];
    for (const [segmentIndex, segment] of segments.entries()) {
      if (segmentIndex % 2) {
        appendBreak();
        continue;
      }
      for (const [index, text] of (run.translate ? segment.split(protectedText) : [segment]).entries()) {
        if (!text) continue;
        const translate = run.translate && index % 2 === 0 && word.test(text);
        const previous = pieces.at(-1);
        if (previous && !previous.lineBreak && previous.translate === translate && previous.href === run.href &&
            previous.marks.join() === run.marks.join()) {
          previous.text += text;
        } else {
          pieces.push({ id: id + 'p' + pieces.length, text, translate, marks: run.marks, href: run.href });
        }
      }
    }
  }

  return tag !== 'pre' && whiteSpace !== 'pre-wrap'
    ? pieces.map((piece) => ({ ...piece, text: piece.text.replace(/\s+/g, ' ') }))
    : pieces;
}

function replacementPieces(id: string, runs: TextRun[]) {
  const pieces: Piece[] = [];
  const replacements = new Map<Text, ReplacementFragment[]>();
  for (const run of runs) {
    if (!run.translate) continue;
    const fragments: ReplacementFragment[] = [];
    const previousLength = pieces.length;
    for (const [lineIndex, line] of run.text.split(/(\r\n|\r|\n)/).entries()) {
      if (lineIndex % 2) {
        fragments.push(line);
        continue;
      }
      for (const [index, text] of line.split(protectedText).entries()) {
        if (!text) continue;
        if (index % 2 || !word.test(text)) {
          fragments.push(text);
          continue;
        }
        const source = text.trim();
        const start = text.indexOf(source);
        const end = start + source.length;
        if (start > 0) fragments.push(text.slice(0, start));
        const piece: Piece = {
          id: id + 'p' + pieces.length, text: source, translate: true, marks: run.marks, href: run.href,
        };
        pieces.push(piece);
        fragments.push(piece);
        if (end < text.length) fragments.push(text.slice(end));
      }
    }
    if (pieces.length !== previousLength) replacements.set(run.node, fragments);
  }
  return { pieces, replacements };
}

function replacementAllowed(element: HTMLElement) {
  return document.designMode !== 'on' && !element.closest(replacementExcluded);
}

function mainContent(allowed?: (element: HTMLElement) => boolean) {
  for (const selector of ['main, [role=main]', 'article']) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!element.closest(mainExcluded) && (!allowed || allowed(element)) && visibleContext(element)) return element;
    }
  }
}

function displayedChildren(element: HTMLElement): Iterable<Node> {
  if (element instanceof HTMLDetailsElement && !element.open) {
    const summary = Array.from(element.children).find((child) => child.tagName === 'SUMMARY');
    return summary ? [summary] : [];
  }
  return element.childNodes;
}

function visibleContext(element: HTMLElement, excludeCode = false) {
  if (element.closest(excluded) || (excludeCode && element.closest(codeTextSelector))) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (!visible(ancestor, style) || excludeCode && isCodeBlock(ancestor, style)) return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open && ancestor !== element) {
      const summary = Array.from(ancestor.children).find((child) => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

function visible(element: HTMLElement, style = getComputedStyle(element)) {
  if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0' ||
      style.contentVisibility === 'hidden') return false;
  if (!element.hasChildNodes() || style.display === 'contents' || style.display === 'inline') return true;
  const clipX = style.overflowX === 'hidden' || style.overflowX === 'clip';
  const clipY = style.overflowY === 'hidden' || style.overflowY === 'clip';
  if (!clipX && !clipY) return true;
  // A collapsed drawer or visually hidden label can still have visible computed styles.
  return !(clipX && element.clientWidth <= 1 || clipY && element.clientHeight <= 1);
}

function isContainer(element: HTMLElement, display: string) {
  if (element.matches('a,b,strong,i,em,code,kbd,samp,br')) return false;
  return display === 'contents' || element.tagName !== 'SPAN' && isBlockDisplay(display);
}

function isBlockDisplay(display: string) {
  return /^(block|flex|grid|inline-flex|inline-grid|flow-root|table|list-item)/.test(display);
}

function isCodeBlock(element: HTMLElement, style: CSSStyleDeclaration) {
  if (element.tagName === 'PRE') return true;
  if (element.matches('ul,ol,dl,table,thead,tbody,tfoot,tr')) return false;
  const explicit = element.matches(codeTextSelector);
  if (style.display === 'contents') return explicit;
  if (style.display !== 'inline-block' && !isBlockDisplay(style.display)) return false;
  return explicit ||
    /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace) &&
    /(?:^|,)\s*(?:ui-)?monospace\s*(?:,|$)/i.test(style.fontFamily);
}

function listLink(item: HTMLElement) {
  if (item.tagName !== 'LI' || item.querySelector('ul,ol')) return undefined;
  const links = item.querySelectorAll<HTMLAnchorElement>('a[href]');
  const link = links[0];
  if (links.length === 1 && item.textContent?.trim() === link?.textContent?.trim()) return link;
}

function isCurrent(element: HTMLElement) {
  const current = element.getAttribute('aria-current');
  return (current !== null && current !== 'false' && current !== '') ||
    element.matches('[aria-selected=true],[data-state=active],.active,.is-active,.selected,.is-selected,.current');
}

function sameRow(first: DOMRect, second: DOMRect) {
  const overlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return overlap >= Math.min(first.height, second.height) / 2;
}

function structure(source: HTMLElement, children: ReadingNode[], style: CSSStyleDeclaration, surface?: Surface): Branch {
  const tag = source.tagName.toLowerCase();
  const branch: Branch = { tag: tag === 'details' ? 'div' : tag as BranchTag, children, surface };
  if (source instanceof HTMLDetailsElement) branch.disclosure = source.open ? 'open' : 'closed';
  if (tag === 'table' && style.captionSide === 'bottom') branch.captionSide = 'bottom';
  if (source instanceof HTMLTableCellElement) {
    branch.span = source.colSpan;
    branch.rowSpan = source.rowSpan;
    if (/^(row|col|rowgroup|colgroup)$/.test(source.scope)) branch.scope = source.scope;
    if (/^(left|right|center|start|end|justify)$/.test(style.textAlign)) branch.align = style.textAlign as Branch['align'];
  }
  if (source instanceof HTMLOListElement) {
    branch.start = source.hasAttribute('start') ? source.start : undefined;
    branch.reversed = source.reversed || undefined;
  }
  if (source instanceof HTMLLIElement && source.hasAttribute('value')) branch.listValue = source.value;
  if (/^(ul|ol|li)$/.test(tag) && markers.test(style.listStyleType)) branch.marker = style.listStyleType;
  if (tag === 'ul' || tag === 'ol') branch.listColumns = listColumnCount(source);
  return branch;
}

function listColumnCount(source: HTMLElement) {
  let maximum = 1;
  let count = 1;
  let previous: DOMRect | undefined;
  for (const child of source.children) {
    if (!(child instanceof HTMLLIElement) || child.matches(excluded) || !visible(child)) continue;
    const bounds = child.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const beside = previous && sameRow(previous, bounds) &&
      (previous.right <= bounds.left + 1 || bounds.right <= previous.left + 1);
    count = beside ? count + 1 : 1;
    maximum = Math.max(maximum, count);
    previous = bounds;
  }
  return maximum > 1 ? maximum : undefined;
}

function placeholderFor(element: HTMLElement): ImagePlaceholder | undefined {
  const image = element instanceof HTMLImageElement ? element :
    element.firstElementChild && element.matches('a,p,picture') &&
    !element.textContent?.trim() && element.querySelector('img');
  if (!image || !visibleContext(image)) return undefined;
  const { width, height } = image.getBoundingClientRect();
  if (width < 48 || height < 32 || !image.closest('figure') && width < 96) return undefined;
  return { tag: 'image', alt: image.alt, width: Math.round(width), height: Math.round(height) };
}

function columnBounds(element: HTMLElement, style: CSSStyleDeclaration, flexOrGrid: boolean, keepEmptyCells?: boolean) {
  if (style.position !== 'static' && style.position !== 'relative') return undefined;
  if (!flexOrGrid && style.cssFloat === 'none' && !/^inline-(block|flex|grid)$/.test(style.display)) return undefined;
  const bounds = element.getBoundingClientRect();
  if (bounds.width <= 1) return undefined;
  if (bounds.height > 1) return bounds;
  // A centered empty grid item still occupies a horizontal track.
  if (keepEmptyCells) return new DOMRect(bounds.x, bounds.y - 1, bounds.width, 2);
}

function compactFlexRow(
  parent: HTMLElement, nodes: ReadingNode[], columns: Column[], layout: CSSStyleDeclaration,
): Branch | undefined {
  if (!/^(inline-)?flex$/.test(layout.display) || !layout.flexDirection.startsWith('row') ||
      columns.length < 2 || columns.length !== nodes.length) return undefined;
  if (!parent.closest('header,nav,[role=banner],[role=navigation],[role=tablist]') &&
      columns.some(({ element, style }) => style.flexGrow !== '0' && !element.matches('a,span,small,time,kbd'))) return undefined;

  const maxHeight = Math.max(48, Number.parseFloat(layout.fontSize) * 4);
  if (!columns.every(({ start, end, bounds }, index) =>
    start === index && end === index + 1 && bounds.height <= maxHeight && compactContent(nodes[index]!))) return undefined;

  const ordered = [...columns].sort((a, b) => Number(a.style.order) - Number(b.style.order));
  return {
    tag: 'div',
    compactRow: {
      direction: layout.direction === 'rtl' ? 'rtl' : 'ltr',
      scroll: /^(auto|scroll)$/.test(layout.overflowX) || undefined,
      reverse: layout.flexDirection === 'row-reverse' || undefined,
      rowGap: compactGap(layout.rowGap, 5),
      columnGap: compactGap(layout.columnGap, 7),
    },
    children: ordered.map((column) => {
      const node = nodes[column.start]!;
      if ('pieces' in node && !node.inlineAppearance) node.inlineAppearance = compactAppearance(column, layout);
      return { tag: 'div', current: isCurrent(column.element), children: [node] };
    }),
  };
}

function compactContent(node: ReadingNode): boolean {
  if ('pieces' in node) {
    return /^(p|span|h[1-6])$/.test(node.tag) && !node.pieces.some((piece) => piece.lineBreak) &&
      node.pieces.reduce((size, piece) => size + piece.text.length, 0) <= 120;
  }
  if (!('children' in node)) return false;
  if (node.compactRow || node.inlineRow || node.navigation) return true;
  return (node.tag === 'div' || node.tag === 'section') && !node.side && !node.area &&
    node.children.length === 1 && compactContent(node.children[0]!);
}

function compactGap(value: string, fallback: number) {
  return value.endsWith('px') ? Math.min(14, Number.parseFloat(value)) : fallback;
}

function compactAppearance(column: Column, layout: CSSStyleDeclaration) {
  let element = column.element;
  let style = column.style;
  // Links can wrap a smaller labeled box that supplies the border and padding.
  for (let depth = 0; depth < 3 && !readSurface(style); depth++) {
    const children = [...element.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.matches(excluded) && visible(child));
    const inner = children[0];
    if (children.length !== 1 || !inner || !inner.textContent?.trim()) break;
    const bounds = inner.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < column.bounds.height * .6) break;
    element = inner;
    style = getComputedStyle(inner);
  }
  return {
    ...readInlineAppearance(style, layout),
    fontWeight: style.fontWeight !== layout.fontWeight ? style.fontWeight : undefined,
  };
}

function arrangeColumns(nodes: ReadingNode[], columns: Column[], direction: 'ltr' | 'rtl', listRow: boolean) {
  if (columns.length < 2) return nodes;
  const result: ReadingNode[] = [];
  let offset = 0;

  for (let index = 0; index < columns.length;) {
    const first = columns[index++]!;
    const row = [first];
    let top = first.bounds.top;
    let bottom = first.bounds.bottom;
    let end = first.end;
    // Keep separate source rows and do not group across intervening content.
    while (index < columns.length) {
      const next = columns[index]!;
      const overlap = Math.min(bottom, next.bounds.bottom) - Math.max(top, next.bounds.top);
      if (next.start !== end || overlap < Math.min(bottom - top, next.bounds.height) / 2) break;
      row.push(next);
      top = Math.max(top, next.bounds.top);
      bottom = Math.min(bottom, next.bounds.bottom);
      end = next.end;
      index++;
    }

    if (row.length < 2 || row.every(({ start, end }) => start === end)) continue;
    row.sort((a, b) => a.bounds.left - b.bounds.left);
    if (row.some(({ bounds }, position) => position > 0 && row[position - 1]!.bounds.right > bounds.left + 1)) continue;
    if (direction === 'rtl') row.reverse();
    result.push(...nodes.slice(offset, first.start), {
      tag: 'div', columns: direction, listRow: listRow || undefined,
      children: row.map(({ start, end, bounds }) => ({
        tag: 'div', columnWeight: bounds.width, children: nodes.slice(start, end),
      })),
    });
    offset = end;
  }
  if (offset === 0) return nodes;
  result.push(...nodes.slice(offset));
  return result;
}

function safeLink(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value, document.baseURI);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
}
