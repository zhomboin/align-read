import { browser } from 'wxt/browser';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { openDocument, type PdfInput } from '../../src/pdf/document';
import { displayPage, readPage, type PageContent } from '../../src/pdf/show-page';
import { displayInplace } from '../../src/pdf/inplace-view';
import { PdfTranslationQueue } from '../../src/pdf/translation-queue';
import { PdfContinuousView } from '../../src/pdf/continuous-view';
import { request } from '../../src/shared/extension';
import { currentPdf, pdfAddress } from '../../src/shared/pdf-source';
import {
  DEFAULT_PDF_LOOK_AHEAD, LANGUAGES, TRANSLATION_PROVIDERS, errors, isRecord, selectedProviderAccess, type ErrorCode, type Language,
  type PublicSettings, type SourceLanguage,
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
const layout = find<HTMLSelectElement>('layout');
const original = find<HTMLButtonElement>('original');
const download = find<HTMLButtonElement>('download');
const exportStatus = find('export-status');
const inplaceSource = /^#inplace=(\d+)$/.exec(location.hash);
if (inplaceSource) layout.value = 'inplace';
let startOnOpen = Boolean(inplaceSource);
let besideSource = false;
let filename = '';
let exportJob: AbortController | undefined;
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
let settingsError: ErrorCode | undefined;
let settingsRequest = 0;
let languageEdited = false;
let requestedPage = 1;
const tabLife = new AbortController();
const models = new Map<number, Promise<{ page: PDFPageProxy; content: PageContent }>>();

function siteDisabled() {
  return settings?.disabledSites.some(site => hostname === site || hostname.endsWith('.' + site));
}

function controls() {
  const number = view?.page ?? 0;
  const model = view?.current?.result?.model;
  prev.disabled = !pdf || number <= 1;
  next.disabled = !pdf || number >= pdf.numPages;
  input.disabled = !pdf;
  const job = queue?.translatingPage;
  const lookAhead = settings?.pdfLookAhead ?? DEFAULT_PDF_LOOK_AHEAD;
  const canStart = model && (model.items.length > 0 || lookAhead === 'all' || (lookAhead > 0 && pdf && number < pdf.numPages));
  translate.disabled = !settings || siteDisabled() || !canStart || Boolean(queue?.enabled) ||
    Boolean(queue && !queue.error && queue.nextPendingPage() === undefined);
  translate.disabled ||= Boolean(exportJob);
  download.disabled = !pdf || !settings || Boolean(siteDisabled() || exportJob);
  cancel.hidden = !queue?.enabled && !exportJob;
  cancel.textContent = exportJob ? '取消下载' : job ? '停止翻译' : '停止预译';
  original.hidden = besideSource || layout.value !== 'inplace';
  original.disabled = !pdf;
  const heading = !besideSource && layout.value === 'inplace' ? 'PDF 原位阅读' : 'PDF 对照阅读';
  document.querySelector('h1')!.textContent = heading;
  document.title = heading + ' · AlignRead';
  const action = lookAhead === 'all' ? '翻译整份 PDF' : lookAhead === 0 ? '翻译当前页' : '翻译并预译后 ' + lookAhead + ' 页';
  translate.textContent = queue?.error ? '重试翻译' : action;
  if (settings) translate.title = TRANSLATION_PROVIDERS[settings.provider].label;
  if (startOnOpen && settings && canStart && !translate.disabled) {
    startOnOpen = false;
    queueMicrotask(() => translate.click());
  }
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
  const settingsNotice = siteDisabled() ? errors['site-disabled'] : settingsError ? errors[settingsError] : '';
  const progress = settings?.pdfLookAhead === 'all' && pdf && queue && (queue.enabled || queue.completedPages)
    ? ' 全文进度 ' + queue.completedPages + '/' + pdf.numPages + ' 页。' : '';
  const message = pageStatus + (job !== undefined && job !== number ? ' 正在预译第 ' + job + ' 页…' : '') +
    progress + (error ? ' ' + error : '') + (settingsNotice ? ' ' + settingsNotice : '');
  if (status.textContent !== message) status.textContent = message;
}

async function readSettings(credentialsChanged = false) {
  const sequence = ++settingsRequest;
  const result = await request<PublicSettings>({ type: 'settings' });
  if (sequence !== settingsRequest) return;
  const hadNotice = settingsError || siteDisabled();
  settingsError = result.ok ? undefined : result.error;
  if (result.ok) {
    const next = result.value;
    if (!settings && !languageEdited) { source.value = next.source; target.value = next.target; }
    const reset = settings && (credentialsChanged || settings.provider !== next.provider || !selectedProviderAccess(next).authorized);
    settings = next;
    if (reset || siteDisabled()) cancelExport();
    if (reset) queue?.reset();
    if (siteDisabled()) queue?.stop();
    queue?.setLookAhead(next.pdfLookAhead ?? DEFAULT_PDF_LOOK_AHEAD);
  }
  if (hadNotice || settingsError || siteDisabled()) updateTranslation();
  else controls();
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
  requestedPage = value;
  view?.goTo(requestedPage);
  if (view) input.value = String(view.page);
}

async function renderPage(doc: PDFDocumentProxy, number: number, signal: AbortSignal, beside: boolean) {
  const { page, content } = await getModel(doc, number);
  signal.throwIfAborted();
  try {
    const rendered = !beside && layout.value === 'inplace'
      ? await displayInplace(page, content, signal) : await displayPage(page, content, signal, !beside);
    return { ...rendered, model: content };
  } finally { page.cleanup(); }
}

function clearDocument() {
  find<HTMLDialogElement>('detail').close();
  cancelExport();
  exportStatus.hidden = true;
  documentLife.abort();
  view?.dispose();
  view = undefined;
  pdf = undefined;
  models.clear();
  queue?.stop();
  queue = undefined;
  viewport.hidden = true;
  find('total').textContent = '';
  controls();
}

async function load(inputFile: PdfInput, beside = false, startPage = 1, wholeFile = false) {
  clearDocument();
  documentLife = new AbortController();
  const signal = documentLife.signal;
  requestedPage = startPage;
  besideSource = beside;
  layout.hidden = beside;
  const name = inputFile instanceof URL ? inputFile.pathname.split('/').filter(Boolean).at(-1) ?? '文档' : inputFile.name;
  try { filename = decodeURIComponent(name); } catch { filename = name; }
  showOriginal(false);
  viewport.classList.toggle('beside-original', beside);
  hostname = inputFile instanceof URL ? inputFile.hostname : '';
  status.textContent = wholeFile ? '分段读取失败，正在完整读取 PDF…' : '正在打开 PDF…';
  try {
    const doc = await openDocument(inputFile, signal, () => {
      if (!signal.aborted && !wholeFile) void load(inputFile, beside, view?.page ?? requestedPage, true);
    }, wholeFile || Boolean(inplaceSource && !beside && inputFile instanceof URL));
    if (signal.aborted) return;
    pdf = doc;
    queue = new PdfTranslationQueue(doc.numPages, async page => (await getModel(doc, page)).content.items,
      updateTranslation, settings?.pdfLookAhead);
    input.max = String(doc.numPages);
    find('total').textContent = '/ ' + doc.numPages;
    viewport.hidden = false;
    mountView(doc);
  } catch (error) {
    if (signal.aborted) return;
    const reason = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
      ? error.message : '无法打开 PDF。请确认文件完整，网页文件可下载后重新选择。';
    status.textContent = (wholeFile ? '分段读取和完整读取均失败。' : '') + reason;
  }
}

function mountView(doc: PDFDocumentProxy) {
  const number = view?.page || requestedPage;
  view?.dispose();
  viewport.classList.toggle('inplace-mode', !besideSource && layout.value === 'inplace');
  view = new PdfContinuousView(viewport, pages, doc.numPages,
    (page, signal) => renderPage(doc, page, signal, besideSource),
    page => {
      if (document.activeElement !== input) input.value = String(page);
      queue?.select(page);
    }, page => updateTranslation(page === view?.page));
  goToPage(number);
}

function configuration() {
  if (!settings || siteDisabled()) return;
  const { configured, authorized } = selectedProviderAccess(settings);
  if (!configured || !authorized) {
    status.textContent = errors[configured ? 'consent-required' : 'not-configured'];
    return;
  }
  if (source.value === target.value) { status.textContent = '原文语言与目标语言相同。'; return; }
  return {
    provider: settings.provider, hostname,
    options: { source: source.value as SourceLanguage, target: target.value as Language, range: 'main' as const },
  };
}
translate.onclick = () => {
  const config = configuration();
  if (config && queue && !queue.enabled && !exportJob) queue.start(config);
};
function showOriginal(active: boolean) {
  viewport.classList.toggle('original-only', active);
  original.setAttribute('aria-pressed', String(active));
  original.textContent = active ? '查看译文' : '查看原文';
}
original.onclick = () => showOriginal(!viewport.classList.contains('original-only'));
layout.onchange = () => { showOriginal(false); if (pdf) mountView(pdf); };
function cancelExport() {
  exportJob?.abort();
  exportJob = undefined;
  exportStatus.hidden = true;
}
download.onclick = async () => {
  const doc = pdf, translations = queue, config = configuration();
  if (!doc || !translations || !config || exportJob) return;
  const job = new AbortController();
  exportJob = job;
  translations.stop();
  exportStatus.hidden = false;
  exportStatus.textContent = '正在准备译本…';
  try {
    const { exportDocument, downloadDocument } = await import('../../src/pdf/export-document');
    const blob = await exportDocument({
      total: doc.numPages, signal: job.signal,
      read: page => getModel(doc, page),
      translate: page => translations.completePage(page, config, job.signal),
      progress: message => { exportStatus.textContent = message; },
    });
    job.signal.throwIfAborted();
    downloadDocument(blob, filename, LANGUAGES[config.options.target]);
    exportStatus.textContent = '译文 PDF 已生成。';
  } catch (error) {
    if (!job.signal.aborted) exportStatus.textContent = (error instanceof Error ? error.message : '下载失败。') + ' 可重新下载。';
  } finally {
    if (exportJob === job) { exportJob = undefined; updateTranslation(); }
  }
};
cancel.onclick = () => {
  cancelExport();
  queue?.stop();
  status.textContent = '已停止翻译。';
};
source.onchange = target.onchange = () => {
  languageEdited = true;
  cancelExport();
  queue?.reset();
  status.textContent = '语言已更新。';
};
prev.onclick = () => { if (view) goToPage(view.page - 1); };
next.onclick = () => { if (view) goToPage(view.page + 1); };
input.onchange = () => goToPage(input.valueAsNumber);
input.onblur = () => { if (view) input.value = String(view.page); };
file.onchange = () => {
  const selected = file.files?.[0];
  file.value = '';
  if (selected) {
    startOnOpen = false;
    tabLife.abort();
    void load(selected);
  }
};
find('settings').onclick = () => void browser.runtime.openOptionsPage();
window.addEventListener('focus', () => void readSettings());
browser.storage.onChanged.addListener((changes, area) => {
  const provider = changes.providerSettings;
  if (area === 'local' && provider) {
    const revision = (value: unknown) => isRecord(value) ? value.revision : undefined;
    const changed = revision(provider.newValue) !== revision(provider.oldValue);
    if (changed) {
      cancelExport();
      queue?.reset();
    }
    void readSettings(changed);
  }
});
window.addEventListener('pagehide', () => {
  tabLife.abort();
  clearDocument();
});

function pageNumber(address: URL) {
  const page = Number(new URLSearchParams(address.hash.slice(1)).get('page'));
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

async function followTab(tabId: number) {
  type TabUpdated = Parameters<typeof browser.tabs.onUpdated.addListener>[0];
  type Tab = Parameters<TabUpdated>[2];
  let documentUrl: string | undefined;
  let revision = 0;
  status.textContent = '正在识别当前标签页的 PDF…';

  async function resolveDocument(tab: Tab | undefined, url = tab?.url) {
    const attempt = ++revision;
    const pending = tab?.pendingUrl && tab.pendingUrl !== url;
    const address = pending ? undefined : await currentPdf(tabId, url);
    const allowed = address?.protocol !== 'file:' ||
      await browser.extension.isAllowedFileSchemeAccess().catch(() => false);
    if (tabLife.signal.aborted || attempt !== revision) return;
    if (!address) {
      status.textContent = pending || tab?.status === 'loading' ? '正在等待当前标签页的 PDF…' : '请从 PDF 标签页打开对照阅读，或选择 PDF 文件。';
    } else if (!allowed) {
      status.textContent = '请选择 PDF。要直接读取本地标签页，请在扩展详情中开启「允许访问文件网址」。';
    } else {
      documentUrl = address.href.split('#')[0];
      if (inplaceSource) tabLife.abort();
      void load(address, !inplaceSource, pageNumber(address) ?? 1);
    }
  }

  const onUpdated: TabUpdated = (id, change, tab) => {
    if (id !== tabId || (change.url === undefined && change.status === undefined)) return;
    const url = change.url ?? tab.url;
    if (!documentUrl) {
      void resolveDocument(tab, url);
      return;
    }
    // A cross-origin navigation can revoke activeTab before Chrome sends the final update.
    if (!url && change.status !== 'complete') return;
    const address = pdfAddress(url, true);
    if (address?.href.split('#')[0] !== documentUrl) {
      tabLife.abort();
      clearDocument();
      status.textContent = '标签页已更新，请重新打开 PDF 翻译。';
      void browser.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
    } else if (change.url) {
      const page = pageNumber(address);
      if (page) goToPage(page);
    }
  };
  browser.tabs.onUpdated.addListener(onUpdated);
  tabLife.signal.addEventListener('abort', () => browser.tabs.onUpdated.removeListener(onUpdated), { once: true });
  const tab = await browser.tabs.get(tabId).catch(() => undefined);
  if (!tabLife.signal.aborted && revision === 0) await resolveDocument(tab);
}

if (/^#\d+$/.test(location.hash)) void followTab(Number(location.hash.slice(1)));
else if (inplaceSource) void followTab(Number(inplaceSource[1]));
void readSettings();
