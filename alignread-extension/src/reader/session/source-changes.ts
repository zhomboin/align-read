import type { Article } from '../extraction/document';

const mainSelector = 'main,article,[role=main]';
const pageChrome = 'header,nav,aside,footer,[role=banner],[role=navigation],[role=complementary],[role=contentinfo]';
const extensionUi = '[data-alignread-host],[data-alignread-selection]';
const ignored = 'script,style,noscript,template,iframe,canvas,svg,form,input,textarea,select,option';
const attributes = [
  'aria-current', 'aria-hidden', 'aria-selected', 'aria-orientation', 'class', 'contenteditable', 'data-state',
  'hidden', 'inert', 'href', 'id', 'open', 'role', 'style', 'dir', 'start', 'reversed', 'value', 'colspan', 'rowspan', 'scope',
  'alt', 'src', 'width', 'height', 'data-ad-slot',
];
const fittedStyles = new Set([
  'min-width', 'max-width', 'width', 'box-sizing', 'padding-left', 'padding-right', 'left', 'right',
  'white-space', 'overflow-wrap', 'word-break', 'flex-shrink',
]);

export function watchSourceChanges(
  body: () => HTMLElement | null,
  scope: () => HTMLElement | undefined,
  signal: AbortSignal,
  checkPage: () => boolean,
  changed: () => void,
  replacement?: { isSourceMutation: (record: MutationRecord) => boolean },
) {
  const prior = document.createElement('span').style;
  function meaningful(record: MutationRecord) {
    const element = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!element || element.closest(extensionUi) || element.closest(ignored)) return false;
    if (element !== document.documentElement && !body()?.contains(element)) return false;
    const current = scope();
    if (current?.isConnected && !current.contains(element) && !element.contains(current)) {
      const candidates = record.type === 'attributes' ? [element] : Array.from(record.addedNodes);
      if (!candidates.some((node) => node instanceof Element &&
          (node.matches(mainSelector) || node.querySelector(mainSelector)))) return false;
    }
    if (!replacement && record.attributeName === 'style' && element instanceof HTMLElement) {
      prior.cssText = record.oldValue ?? '';
      const properties = new Set([...Array.from(prior), ...Array.from(element.style)]);
      return [...properties].some((property) => !fittedStyles.has(property) &&
        (prior.getPropertyValue(property) !== element.style.getPropertyValue(property) ||
          prior.getPropertyPriority(property) !== element.style.getPropertyPriority(property)));
    }
    if (record.type !== 'childList') return true;
    if (element === document.documentElement) return false;
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      node instanceof Text || node instanceof Element && !node.matches(extensionUi + ',' + ignored));
  }
  function process(records: MutationRecord[]) {
    const sourceRecords = replacement ? records.filter(replacement.isSourceMutation) : records;
    if (checkPage() && sourceRecords.some(meaningful)) changed();
  }
  const observer = new MutationObserver(process);
  observer.observe(document, {
    childList: true, characterData: true, attributes: true, attributeOldValue: true,
    characterDataOldValue: Boolean(replacement), subtree: true,
    attributeFilter: replacement ? [...attributes, 'translate'] : attributes,
  });
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  const flush = () => process(observer.takeRecords());
  const onNavigate = replacement ? flush : checkPage;
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('currententrychange', onNavigate, { signal });
  window.addEventListener('popstate', onNavigate, { signal });
  window.addEventListener('hashchange', onNavigate, { signal });
  return flush;
}

export function routeText(article: Article) {
  const text = new Map<Text, string>();
  for (const block of article.blocks) {
    if (block.source.closest(pageChrome)) continue;
    for (const [node, value] of block.snapshots) text.set(node, value);
  }
  return text;
}
