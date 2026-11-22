import { errors, type ErrorCode, type Language } from '../shared/reader-messages';
import css from './paragraph-feedback.css?inline';

let sheet: CSSStyleSheet | undefined;

export function createParagraphFeedback(target: Language) {
  const host = document.createElement('span');
  host.setAttribute('data-alignread-paragraph', '');
  host.translate = false;
  host.style.setProperty('display', 'block', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  shadow.adoptedStyleSheets = [sheet];

  const wrapper = document.createElement('span');
  wrapper.className = 'feedback';
  const status = document.createElement('span');
  status.dir = 'auto';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-atomic', 'true');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.lang = 'zh-CN';
  retry.textContent = '重试';
  retry.setAttribute('aria-label', '重试本段翻译');
  wrapper.append(status, retry);
  shadow.append(wrapper);

  function show(state: 'queued' | 'loading' | 'done' | 'error', text: string, canRetry = false) {
    wrapper.dataset.state = state;
    status.lang = state === 'done' ? target : 'zh-CN';
    status.textContent = text;
    retry.hidden = !canRetry;
  }

  return {
    host, retry,
    get pending() { return wrapper.dataset.state === 'queued' || wrapper.dataset.state === 'loading'; },
    queued() { show('queued', '等待翻译…'); },
    loading() { show('loading', '正在翻译…'); },
    done(text: string) { show('done', text); },
    failed(error: ErrorCode) { show('error', '翻译失败。' + errors[error], error !== 'stale'); },
  };
}
