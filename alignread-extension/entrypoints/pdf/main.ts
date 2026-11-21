import { browser } from 'wxt/browser';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { openDocument, type PdfInput } from '../../src/pdf/document';
import { displayPage, readPage, type PageContent } from '../../src/pdf/show-page';
import { PdfTranslationQueue, pdfLookAhead } from '../../src/pdf/translation-queue';
import { PdfContinuousView } from '../../src/pdf/continuous-view';
import { request } from '../../src/shared/extension';
import { currentPdf, pdfAddress } from '../../src/shared/pdf-source';
import {
  LANGUAGES, TRANSLATION_PROVIDERS, errors, isRecord, selectedProviderAccess, type Language, type SourceLanguage,
  type PublicSettings
} from '../../src/shared/reader-messages';
import './pdf.css';

const find = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const file = find<HTMLInputElement>('file');
const input = find<HTMLInputElement>('page');
const prev = find<HTMLButtonElement>('prev');
const next = find<HTMLButtonElement>('next');
const translate = find<HTMLButtonElement>('translate');
const cancel = find<HTMLButtonElement>('cancel');
const source = find<HTMLSelectElement>('source');
const target = find<HTMLSelectElement>('target');
const status = find('status');
const viewport = find('viewer');
const pages = find('pages');
source.add(new Option('自动检测', 'auto'));
for (const [key, label] of Object.entries(LANGUAGES)) {
  source.add(new Option(label, key));
  target.add(new Option(label, key));
}
target.value = 'zh-CN';

let pdf: PDFDocumentProxy | undefined;
let documentLife = new AbortController();
let view: PdfContinuousView | undefined;
let queue: PdfTranslationQueue | undefined;
let hostname = '';
let settings: PublicSettings | undefined;
let settingsRequest = 0;
const models = new Map<number, Promise<{ page: PDFPageProxy; content: PageContent }>>();
let besideOriginal = false;

function controls() {
  const number = view?.page ?? 0;
  const model = view?.current?.result?.model;
  prev.disabled = !pdf || number <= 1;
  next.disabled = !pdf || number >= pdf.numPages;
  input.disabled = !pdf;
  const job = queue?.translatingPage;
  const canStart = model && (model.items.length > 0 || (pdf && number < pdf.numPages));
  translate.disabled = !settings || !canStart || Boolean(queue?.enabled) ||
    Boolean(queue?.result(number)?.complete && !queue.error && !hasPendingPages());
  cancel.hidden = !queue?.enabled;
  cancel.textContent = job ? '停止翻译' : '停止预译';
  translate.textContent = queue?.error ? '重试翻译' : queue?.result(number) ? '继续翻译' : '翻译并预译后两页';
  if (settings) translate.title = TRANSLATION_PROVIDERS[settings.provider].label;
}

function hasPendingPages() {
  if (!pdf || !queue || !view) return false;
  const number = view.page;
  for (let page = number + 1; page <= Math.min(number + pdfLookAhead, pdf.numPages); page++) {
    if (!queue.result(page)?.complete) return true;
  }
  return false;
}

function updateTranslation(showStatus = true) {
  controls();
  if (!view) return;
  view.applyTranslations((page, id) => queue?.result(page)?.values.get(id));
  if (!showStatus) return;
  const number = view.page;
  const model = view.current?.result?.model;
  const job = queue?.translatingPage;
  const result = queue?.result(number);
  let pageStatus = '正在读取第 ' + number + ' 页…';
  if (view.current?.failed) pageStatus = '无法读取第 ' + number + ' 页。';
  if (model) {
    pageStatus = !model.items.length
      ? model.hasText ? '本页仅显示原文。' : '本页没有可提取的文字，扫描件需要先做 OCR。'
      : result?.complete ? '第 ' + number + ' 页翻译完成。'
        : job === number ? '正在翻译第 ' + number + ' 页…' : '第 ' + number + ' 页已就绪。';
  }
  const error = queue?.error ? '第 ' + queue.failedPage + ' 页：' + queue.error : '';
  const message = pageStatus + (job !== undefined && job !== number ? ' 正在预译第 ' + job + ' 页…' : '') +
    (error ? ' ' + error : '');
  if (status.textContent !== message) status.textContent = message;
}

async function readSettings(initial = false, credentialsChanged = false) {
  const sequence = ++settingsRequest;
  const result = await request<PublicSettings>({ type: 'settings' });
  if (sequence !== settingsRequest) return;
  if (result.ok) {
    const next = result.value;
    const reset = settings && (credentialsChanged || settings.provider !== next.provider || !selectedProviderAccess(next).authorized);
    settings = next;
    if (reset) queue?.reset();
    if (next.disabledSites.some(site => hostname === site || hostname.endsWith('.' + site))) queue?.stop();
    if (initial) { source.value = settings.source; target.value = settings.target; }
  } else status.textContent = errors[result.error];
  controls();
}

function getModel(doc: PDFDocumentProxy, pageNumber: number) {
  const cached = models.get(pageNumber);
  if (cached) return cached;
  const entry = doc.getPage(pageNumber).then(async page => {
    const content = await readPage(page);
    if (pdf === doc && !view?.hasMounted(pageNumber)) page.cleanup();
    return { page, content };
  }).catch(error => {
    if (models.get(pageNumber) === entry) models.delete(pageNumber);
    throw error;
  });
  models.set(pageNumber, entry);
  if (models.size > 12) {
    const oldest = [...models.keys()].find(key => key !== view?.page);
    if (oldest !== undefined) models.delete(oldest);
  }
  return entry;
}

function goToPage(value: number) {
  view?.goTo(value);
  if (view) input.value = String(view.page);
}

async function renderPage(doc: PDFDocumentProxy, number: number, signal: AbortSignal, beside: boolean) {
  const { page, content } = await getModel(doc, number);
  signal.throwIfAborted();
  try {
    return { ...await displayPage(page, content, signal, !beside), model: content };
  } finally { page.cleanup(); }
}

function clearDocument() {
  documentLife.abort();
  view?.dispose();
  view = undefined;
  pdf = undefined;
  models.clear();
  queue?.stop();
  queue = undefined;
  viewport.hidden = true;
  find('total').textContent = '';
}

async function load(inputFile: PdfInput, beside = false, startPage = 1) {
  clearDocument();
  documentLife = new AbortController();
  const signal = documentLife.signal;
  besideOriginal = beside;
  viewport.classList.toggle('beside-original', beside);
  hostname = inputFile instanceof URL ? inputFile.hostname : '';
  status.textContent = '正在打开 PDF…';
  try {
    const doc = await openDocument(inputFile, signal, (error) => {
      if (signal.aborted) return;
      clearDocument();
      status.textContent = error.message;
    });
    if (signal.aborted) return;
    pdf = doc;
    queue = new PdfTranslationQueue(doc.numPages, async page => (await getModel(doc, page)).content.items, updateTranslation);
    input.max = String(doc.numPages);
    find('total').textContent = '/ ' + doc.numPages;
    viewport.hidden = false;
    view = new PdfContinuousView(viewport, pages, doc.numPages,
      (page, signal) => renderPage(doc, page, signal, beside),
      page => {
        if (document.activeElement !== input) input.value = String(page);
        queue?.select(page);
      }, page => updateTranslation(page === view?.page));
    goToPage(startPage);
  } catch (error) {
    if (!signal.aborted) status.textContent = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
      ? error.message : '无法打开 PDF。请确认文件完整，网页文件可下载后重新选择。';
  }
}

translate.onclick = () => {
  if (!queue || queue.enabled || !settings) return;
  const { configured, authorized } = selectedProviderAccess(settings);
  if (!configured || !authorized) {
    status.textContent = errors[configured ? 'consent-required' : 'not-configured'];
    return;
  }
  if (source.value === target.value) { status.textContent = '原文语言与目标语言相同。'; return; }
  queue.start({
    provider: settings.provider, hostname,
    options: { source: source.value as SourceLanguage, target: target.value as Language, range: 'main' },
  });
};
cancel.onclick = () => { queue?.stop(); status.textContent = '已停止翻译。'; };
source.onchange = target.onchange = () => { queue?.reset(); status.textContent = '语言已更新。'; };
prev.onclick = () => { if (view) goToPage(view.page - 1); };
next.onclick = () => { if (view) goToPage(view.page + 1); };
input.onchange = () => goToPage(input.valueAsNumber);
input.onblur = () => { if (view) input.value = String(view.page); };
file.onchange = () => {
  const selected = file.files?.[0];
  file.value = '';
  if (selected) void load(selected);
};
find('settings').onclick = () => void browser.runtime.openOptionsPage();
window.addEventListener('focus', () => void readSettings());
browser.storage.onChanged.addListener((changes, area) => {
  const provider = changes.providerSettings;
  if (area === 'local' && provider) {
    const revision = (value: unknown) => isRecord(value) ? value.revision : undefined;
    const changed = revision(provider.newValue) !== revision(provider.oldValue);
    if (changed) queue?.reset();
    void readSettings(false, changed);
  }
});
window.addEventListener('pagehide', clearDocument);

async function initialize() {
  const initialLife = documentLife;
  await readSettings(true);
  if (!/^#\d+$/.test(location.hash)) return;
  const tabId = Number(location.hash.slice(1));
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  const url = await currentPdf(tabId, tab?.url);
  const canRead = url && (url.protocol !== 'file:' || await browser.extension.isAllowedFileSchemeAccess());
  if (initialLife !== documentLife || initialLife.signal.aborted) return;
  if (!canRead) {
    status.textContent = '请选择 PDF。要直接读取本地标签页，请在扩展详情中开启「允许访问文件网址」。';
    return;
  }
  if (settings?.disabledSites.some(site => url.hostname === site || url.hostname.endsWith('.' + site))) {
    status.textContent = errors['site-disabled']; return;
  }
  const pageNumber = (address: URL) => {
    const page = Number(new URLSearchParams(address.hash.slice(1)).get('page'));
    return Number.isInteger(page) && page > 0 ? page : undefined;
  };
  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== tabId) return;
    const updated = pdfAddress(change.url, true);
    if (updated && updated.href.split('#')[0] === url.href.split('#')[0]) {
      const page = pageNumber(updated);
      if (page && besideOriginal) goToPage(page);
    } else if (change.url || change.status === 'loading') {
      clearDocument();
      status.textContent = '标签页已更新，请重新打开 PDF 翻译。';
      void browser.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
    }
  });
  void load(url, true, pageNumber(url) ?? 1);
}
void initialize();
