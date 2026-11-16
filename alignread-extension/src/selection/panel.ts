import { LANGUAGES } from '../shared/reader-messages';
import type { SelectionSession } from '../shared/selection-messages';
import css from './panel.css?inline';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(className: string, text: string, label: string) {
  const node = element('button', className, text);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  return node;
}

export function createPanel(session: SelectionSession) {
  const host = element('div', '');
  host.setAttribute('data-alignread-selection', '');
  host.style.setProperty('all', 'initial', 'important');
  for (const [property, value] of Object.entries({
    position: 'fixed', inset: '0', display: 'block', 'pointer-events': 'none', 'z-index': '2147483647',
  })) host.style.setProperty(property, value, 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];

  const trigger = button('trigger', '译', '翻译选中文本');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'selection-card');
  const card = element('section', 'card');
  card.id = 'selection-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', '选词翻译');
  const head = element('div', 'head');
  const sourceLabel = session.source === 'auto' ? '自动检测' : LANGUAGES[session.source];
  const languages = element('span', 'languages', `${sourceLabel} → ${LANGUAGES[session.target]}`);
  const close = button('close', '×', '关闭选词卡片');
  head.append(languages, close);

  const source = element('p', 'source');
  const result = element('p', 'result');
  source.dir = result.dir = 'auto';
  source.setAttribute('aria-label', '原文');
  result.setAttribute('aria-label', '译文');
  const status = element('p', 'status');
  status.setAttribute('role', 'status');
  const actions = element('div', 'actions');
  const retry = button('retry', '重试', '重试选词翻译');
  const copy = button('copy', '复制', '复制译文');
  actions.append(retry, copy);
  card.append(head, source, result, status, actions);
  shadow.append(trigger, card);
  document.documentElement.append(host);

  shadow.addEventListener('mousedown', (event) => {
    if (event.target instanceof HTMLButtonElement) event.preventDefault();
  });

  function position(range: Range | undefined, open: boolean) {
    const rect = range && Array.from(range.getClientRects()).reverse().find(({ top, bottom, left, right, width, height }) =>
      width > 0 && height > 0 && bottom > 0 && top < innerHeight && right > 0 && left < innerWidth);
    trigger.hidden = !rect || open;
    card.hidden = !rect || !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (!rect) return;

    const node = open ? card : trigger;
    const gap = 7;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.max(gap, Math.min(rect.right - (open ? 20 : width), innerWidth - width - gap));
    const below = rect.bottom + gap;
    const above = rect.top - height - gap;
    const top = below + height <= innerHeight - gap || above < gap ? below : above;
    node.style.left = `${left}px`;
    node.style.top = `${Math.max(gap, Math.min(top, innerHeight - height - gap))}px`;
  }

  function render(original: string, translation: string, message: string, canRetry: boolean) {
    source.textContent = original;
    source.hidden = !original;
    result.textContent = translation;
    result.hidden = !translation;
    status.textContent = message;
    retry.hidden = !canRetry;
    copy.hidden = !translation;
    actions.hidden = !canRetry && !translation;
  }

  position(undefined, false);
  return { host, shadow, trigger, close, retry, copy, position, render };
}
