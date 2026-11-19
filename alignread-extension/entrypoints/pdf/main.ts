import { browser } from 'wxt/browser';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openDocument, type PdfInput } from '../../src/pdf/document';
import { originalLine, pageLines } from '../../src/pdf/page-content';
import { translatePage } from '../../src/pdf/translate';
import { request } from '../../src/shared/extension';
import { pdfAddress } from '../../src/shared/pdf-source';
import {
  LANGUAGES, TRANSLATION_PROVIDERS, errors, selectedProviderAccess, type Language, type SourceLanguage,
  type PublicSettings, type TranslationItem
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
let translation: AbortController | undefined;
let number = 0;
let hostname = '';
let settings: PublicSettings | undefined;
let rows: { p: HTMLElement; item: TranslationItem; done: boolean; }[] = [];

function controls() {
  prev.disabled = !pdf || number <= 1;
  next.disabled = !pdf || number >= pdf.numPages;
  input.disabled = !pdf;
  translate.disabled = !settings || !rows.some(row => !row.done) || Boolean(translation);
  cancel.hidden = !translation;
  if (settings) translate.textContent = '用' + TRANSLATION_PROVIDERS[settings.provider].label + '翻译本页';
}

async function readSettings(initial = false) {
  const result = await request<PublicSettings>({ type: 'settings' });
  if (result.ok) {
    if (settings && settings.provider !== result.value.provider) resetTranslation();
    settings = result.value;
    if (initial) { source.value = settings.source; target.value = settings.target; }
  } else status.textContent = errors[result.error];
  controls();
}

function stopTranslation() {
  translation?.abort();
  translation = undefined;
  controls();
}

function resetTranslation() {
  stopTranslation();
  for (const row of rows) { row.done = false; row.p.textContent = row.item.text; }
  controls();
}

async function showPage(value: number) {
  if (!pdf) return;
  pageLife.abort();
  pageLife = new AbortController();
  const signal = pageLife.signal;
  const doc = pdf;
  stopTranslation();
  number = Math.max(1, Math.min(doc.numPages, Math.trunc(value) || 1));
  input.value = String(number);
  rows = [];
  original.replaceChildren();
  lines.replaceChildren();
  controls();
  status.textContent = '正在读取第 ' + number + ' 页…';
  try {
    const page = await doc.getPage(number);
    if (signal.aborted) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1600 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    canvas.setAttribute('aria-label', 'PDF 原页 ' + number);
    const render = page.render({ canvas, viewport });
    const cancelRender = () => render.cancel();
    signal.addEventListener('abort', cancelRender, { once: true });
    try { await render.promise; }
    finally { signal.removeEventListener('abort', cancelRender); }
    if (signal.aborted) return;
    original.replaceChildren(canvas);
    const extracted = await pageLines(page);
    if (signal.aborted) return;
    for (const line of extracted) {
      const p = document.createElement('p');
      if (line.keep) p.append(originalLine(canvas, line, page, scale));
      else {
        p.textContent = line.text;
        rows.push({ p, item: { id: 'line-' + rows.length, text: line.text }, done: false });
      }
      lines.append(p);
    }
    page.cleanup();
    status.textContent = rows.length ? '第 ' + number + ' 页已就绪。点击翻译会向所选服务发送本页正文。'
      : extracted.length ? '本页仅显示原文。' : '本页没有可提取的文字，已显示原页。扫描件需要先做 OCR。';
  } catch {
    if (!signal.aborted) status.textContent = '无法读取本页，请尝试其他页或重新选择文件。';
  } finally { if (!signal.aborted) controls(); }
}

async function load(inputFile: PdfInput) {
  documentLife.abort();
  pageLife.abort();
  stopTranslation();
  documentLife = new AbortController();
  const signal = documentLife.signal;
  pdf = undefined;
  rows = [];
  hostname = inputFile instanceof URL ? inputFile.hostname : '';
  columns.hidden = true;
  original.replaceChildren(); lines.replaceChildren();
  find('total').textContent = '';
  controls();
  status.textContent = '正在打开 PDF…';
  try {
    const doc = await openDocument(inputFile, signal);
    if (signal.aborted) return;
    pdf = doc;
    input.max = String(doc.numPages);
    find('total').textContent = '/ ' + doc.numPages;
    columns.hidden = false;
    await showPage(1);
  } catch (error) {
    if (!signal.aborted) status.textContent = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
      ? error.message : '无法打开 PDF。请确认文件完整，网页文件可下载后重新选择。';
  }
}

translate.onclick = async () => {
  if (translation || !settings || !rows.length) return;
  const { configured, authorized } = selectedProviderAccess(settings);
  if (!configured || !authorized) {
    status.textContent = errors[configured ? 'consent-required' : 'not-configured'];
    return;
  }
  if (source.value === target.value) { status.textContent = '原文语言与目标语言相同。'; return; }
  const current = new AbortController();
  translation = current;
  controls();
  status.textContent = '正在翻译本页…';
  try {
    const pending = rows.filter(row => !row.done);
    const byId = new Map(pending.map(row => [row.item.id, row]));
    await translatePage(pending.map(row => row.item), settings.provider, {
      source: source.value as SourceLanguage, target: target.value as Language, range: 'main',
    }, hostname, current.signal, (values) => {
      for (const { id, text } of values) {
        const row = byId.get(id)!;
        row.p.textContent = text;
        row.done = true;
      }
    });
    if (!current.signal.aborted) status.textContent = '本页翻译完成。';
  } catch (error) {
    if (!current.signal.aborted) status.textContent = error instanceof Error ? error.message : errors.unavailable;
  } finally {
    if (translation === current) { translation = undefined; controls(); }
  }
};
cancel.onclick = () => { stopTranslation(); status.textContent = '已取消，可继续翻译本页。'; };
source.onchange = target.onchange = () => { resetTranslation(); status.textContent = '语言已更新。'; };
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
window.addEventListener('pagehide', () => { stopTranslation(); pageLife.abort(); documentLife.abort(); });

async function initialize() {
  const initialLife = documentLife;
  await readSettings(true);
  if (!/^#\d+$/.test(location.hash)) return;
  const tab = await browser.tabs.get(Number(location.hash.slice(1))).catch(() => undefined);
  const url = pdfAddress(tab?.url);
  if (initialLife !== documentLife || !url) return;
  if (url.protocol === 'file:') { status.textContent = '请选择当前本地 PDF 文件。'; return; }
  if (settings?.disabledSites.some(site => url.hostname === site || url.hostname.endsWith('.' + site))) {
    status.textContent = errors['site-disabled']; return;
  }
  void load(url);
}
void initialize();
