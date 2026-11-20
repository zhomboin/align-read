import { failure, success, type Result } from '../../shared/reader-messages';

const enabled = '[data-reading-mode="enabled" i], [data-reading-mode="true" i]';
const dialog = 'dialog[open], [role=dialog]';
const textRegion = 'article, main, [role=main]';
const readingLabel = /\b(reader|reading)\s+(mode|view)\b|阅读模式|阅读视图/i;

function displayed(element: HTMLElement) {
  return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
    !element.closest('[hidden],[inert],[aria-hidden=true]') && element.getBoundingClientRect().width > 0;
}

function articleIn(container: HTMLElement) {
  if (container.matches(textRegion)) return container;
  const dialog = container.closest('dialog,[role=dialog]');
  for (const selector of ['article', 'main, [role=main]']) {
    const article = [...container.querySelectorAll<HTMLElement>(selector)].find(element =>
      displayed(element) && element.closest('dialog,[role=dialog]') === dialog);
    if (article) return article;
  }
}

export type ReadingLayer = { element: HTMLElement; article: HTMLElement };

export function findReadingLayer(): Result<ReadingLayer | undefined> {
  const fullscreen = document.fullscreenElement;
  if (fullscreen instanceof HTMLElement && fullscreen !== document.documentElement && fullscreen !== document.body) {
    // 全屏媒体和应用也会占满窗口。只有带独立正文区域的阅读视图才交给双栏。
    if (fullscreen instanceof HTMLIFrameElement) return failure('reading-view-unavailable');
    const article = articleIn(fullscreen);
    if (article && article !== fullscreen && displayed(article)) return success({ element: fullscreen, article });
    return article === fullscreen ? failure('reading-view-unavailable') : success(undefined);
  }
  const candidates = document.querySelectorAll<HTMLElement>(dialog + ', iframe[title], iframe[aria-label], ' + enabled);
  for (const element of [...candidates].reverse()) {
    if (element === document.documentElement || element === document.body || !displayed(element)) continue;
    if (!element.matches(enabled)) {
      const labelledBy = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
        .map(id => id && document.getElementById(id)?.textContent).join(' ');
      const label = element.getAttribute('aria-label') ?? labelledBy.trim();
      if (!readingLabel.test(label || element.title)) continue;
    }
    if (!element.matches(':modal') && getComputedStyle(element).position !== 'fixed') continue;
    const article = articleIn(element);
    if (article && displayed(article)) return success({ element, article });
    if (element.querySelector('iframe') || element instanceof HTMLIFrameElement || element.shadowRoot) return failure('reading-view-unavailable');
    return success({ element, article: element });
  }
  return success(undefined);
}

export function readingLayerChange(layer?: ReadingLayer) {
  const current = findReadingLayer();
  if (!current.ok) return current.error;
  if (current.value?.element !== layer?.element || current.value?.article !== layer?.article) return 'reading-view-changed';
}

export function pageReadingArticle() {
  const body = document.body;
  if (body && (document.documentElement.matches(enabled) || body.matches(enabled))) return articleIn(body);
}

export function layerIsOpen(layer: ReadingLayer) {
  return layer.element.isConnected && displayed(layer.element) && layer.article.isConnected &&
    layer.element.contains(layer.article) && (!(layer.element instanceof HTMLDialogElement) || layer.element.open);
}
