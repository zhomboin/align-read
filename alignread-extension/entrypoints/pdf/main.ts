import { browser } from 'wxt/browser';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { openDocument, type PdfInput } from '../../src/pdf/document';
import { displayPage, readPage, type PageContent, type TranslationRow } from '../../src/pdf/show-page';
import { PdfTranslationQueue, pdfLookAhead } from '../../src/pdf/translation-queue';
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
const original = find('original');
const lines = find('lines');
const columns = document.querySelector<HTMLElement>('.columns')!;
source.add(new Option('自动检测', 'auto'));
for (const [key, label] of Object.entries(LANGUAGES)) {
  source.add(new Option(label, key));
  target.add(new Option(label, key));
}
target.value = 'zh-CN';

let pdf: PDFDocumentProxy | undefined;
let documentLife = new AbortController();
let pageLife = new AbortController();
let queue: PdfTranslationQueue | undefined;
let number = 0;
let hostname = '';
let settings: PublicSettings | undefined;
let model: PageContent | undefined;
let rows = new Map<string, TranslationRow>();
let settingsRequest = 0;
const models = new Map<number, Promise<{ page: PDFPageProxy; content: PageContent }>>();
let besideOriginal = false;

function controls() {
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
  if (!pdf || !queue) return false;
  for (let page = number + 1; page <= Math.min(number + pdfLookAhead, pdf.numPages); page++) {
    if (!queue.result(page)?.complete) return true;
  }
  return false;
}

function updateTranslation() {
  controls();
  if (!model) return;
  const result = queue?.result(number);
  for (const item of model.items) {
    rows.get(item.id)?.(result?.values.get(item.id));
  }
  const job = queue?.translatingPage;
  const pageStatus = !model.items.length
    ? model.hasText ? '本页仅显示原文。' : '本页没有可提取的文字，扫描件需要先做 OCR。'
    : result?.complete ? '第 ' + number + ' 页翻译完成。'
      : job === number ? '正在翻译第 ' + number + ' 页…' : '第 ' + number + ' 页已就绪。';
  const error = queue?.error ? '第 ' + queue.failedPage + ' 页：' + queue.error : '';
  status.textContent = pageStatus + (job !== undefined && job !== number ? ' 正在预译第 ' + job + ' 页…' : '') +
    (error ? ' ' + error : '');
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
    if (pdf === doc && number !== pageNumber) page.cleanup();
    return { page, content };
  }).catch(error => {
    if (models.get(pageNumber) === entry) models.delete(pageNumber);
    throw error;
  });
  models.set(pageNumber, entry);
  if (models.size > 12) {
    const oldest = [...models.keys()].find(key => key !== number);
    if (oldest !== undefined) models.delete(oldest);
  }
  return entry;
}

async function showPage(value: number) {
  if (!pdf) return;
  pageLife.abort();
  pageLife = new AbortController();
  const signal = pageLife.signal;
  const doc = pdf;
  number = Math.max(1, Math.min(doc.numPages, Math.trunc(value) || 1));
  input.value = String(number);
  model = undefined;
  rows.clear();
  original.replaceChildren();
  lines.replaceChildren();
  controls();
  status.textContent = '正在读取第 ' + number + ' 页…';
  queue?.select(number);
  try {
    const { page, content } = await getModel(doc, number);
    if (signal.aborted) return;
    try {
      const display = await displayPage(page, content, signal, !besideOriginal);
      if (signal.aborted) return;
      if (display.canvas) original.replaceChildren(display.canvas);
      lines.replaceChildren(display.content);
      rows = display.rows;
      model = content;
      updateTranslation();
    } finally { if (!signal.aborted) page.cleanup(); }
  } catch {
    if (!signal.aborted) status.textContent = '无法读取本页，请尝试其他页或重新选择文件。';
  } finally { if (!signal.aborted) controls(); }
}

function clearDocument() {
  documentLife.abort();
  pageLife.abort();
  pdf = undefined;
  model = undefined;
  rows.clear();
  models.clear();
  queue?.stop();
  queue = undefined;
  columns.hidden = true;
  original.replaceChildren();
  lines.replaceChildren();
  find('total').textContent = '';
}

async function load(inputFile: PdfInput, beside = false, startPage = 1) {
  clearDocument();
  documentLife = new AbortController();
  const signal = documentLife.signal;
  besideOriginal = beside;
  columns.classList.toggle('beside-original', beside);
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
    columns.hidden = false;
    await showPage(startPage);
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
prev.onclick = () => void showPage(number - 1);
next.onclick = () => void showPage(number + 1);
input.onchange = () => void showPage(input.valueAsNumber);
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
  const pageNumber = (address: URL) => Number(new URLSearchParams(address.hash.slice(1)).get('page')) || 1;
  browser.tabs.onUpdated.addListener((id, change) => {
    if (id !== tabId) return;
    const updated = pdfAddress(change.url, true);
    if (updated && updated.href.split('#')[0] === url.href.split('#')[0]) {
      if (updated.hash && besideOriginal) void showPage(pageNumber(updated));
    } else if (change.url || change.status === 'loading') {
      clearDocument();
      status.textContent = '标签页已更新，请重新打开 PDF 翻译。';
      void browser.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
    }
  });
  void load(url, true, pageNumber(url));
}
void initialize();
