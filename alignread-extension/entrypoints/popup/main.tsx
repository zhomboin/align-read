import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { request } from '../../src/shared/extension';
import { currentPdf, pdfAddress } from '../../src/shared/pdf-source';
import { LanguageFields } from '../../src/shared/language-fields';
import {
  TRANSLATION_PROVIDERS, defaults, errors, isProviderId, selectedProviderAccess,
  type ErrorCode, type PageState, type ProviderId, type ReaderControl, type ReaderMode, type ReadingOptions, type ReaderState,
} from '../../src/shared/reader-messages';
import { ReaderModeSelector } from '../../src/shared/reader-mode-selector';
import '../../src/shared/settings-controls.css';
import './popup.css';

const progressLabels = {
  preparing: '正在提取页面内容', translating: '正在翻译', paused: '已暂停',
  partial: '已显示部分译文', ready: '翻译完成', error: '翻译遇到问题',
};
const modeLabels = {
  dual: { start: '开启双栏', switch: '切换为双栏', stop: '关闭双栏' },
  bilingual: { start: '开启段落双语', switch: '切换为段落双语', stop: '关闭段落双语' },
  replace: { start: '开启原位翻译', switch: '切换为原位翻译', stop: '恢复原文' },
};
const providers = Object.keys(TRANSLATION_PROVIDERS).filter(isProviderId);

function Popup() {
  const [tabId, setTabId] = useState<number>();
  const [pdfTab, setPdfTab] = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const [panelError, setPanelError] = useState(false);
  const [page, setPage] = useState<PageState>();
  const [choice, setChoice] = useState<ReadingOptions>(defaults);
  const [modeChoice, setModeChoice] = useState<ReaderMode>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode>();
  const [confirmedProvider, setConfirmedProvider] = useState<ProviderId>();
  const initialized = useRef(false);
  const provider = page?.settings.provider;
  const confirmSensitive = provider !== undefined && confirmedProvider === provider;
  const reader = page?.reader;
  const readerMode = reader?.mode ?? 'dual';
  const mode = modeChoice ?? readerMode;

  useEffect(() => {
    let disposed = false;
    void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (disposed) return;
      if (tab?.id === undefined) { setError('unsupported-page'); return; }
      const isPdf = Boolean(pdfAddress(tab.pendingUrl) ?? await currentPdf(tab.id, tab.url)) ||
        (!tab.url && /\.pdf$/i.test(tab.title ?? ''));
      if (disposed) return;
      setTabId(tab.id);
      setPdfTab(isPdf);
      if (isPdf) {
        void browser.sidePanel.setOptions({ tabId: tab.id, path: 'pdf.html#' + tab.id, enabled: true })
          .then(() => { if (!disposed) setPanelReady(true); }, () => { if (!disposed) setPanelError(true); });
      }
    }, () => { if (!disposed) setError('unavailable'); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (tabId === undefined || pending) return;
    let disposed = false;
    let timer = 0;
    const update = async () => {
      const result = await request<PageState>({ type: 'page', tabId });
      if (disposed) return;
      if (result.ok) {
        setPage(result.value);
        if (!initialized.current) {
          initialized.current = true;
          setChoice(result.value.reader?.options ?? result.value.settings);
          setError(undefined);
        }
      } else if (!initialized.current) setError(result.error);
      timer = window.setTimeout(() => void update(), 900);
    };
    void update();
    return () => { disposed = true; clearTimeout(timer); };
  }, [tabId, pending]);

  async function switchProvider(next: string) {
    if (tabId === undefined || pending || next === provider || !isProviderId(next)) return;
    setPending(true);
    setError(undefined);
    const result = await request<PageState>({ type: 'switch-provider', tabId, provider: next });
    if (result.ok) {
      setPage(result.value);
      setConfirmedProvider(undefined);
    } else setError(result.error);
    setPending(false);
  }

  async function execute(command: 'start' | ReaderControl) {
    if (tabId === undefined || provider === undefined || pending) return;
    setPending(true);
    setError(undefined);
    const result = await request<ReaderState | null>(command === 'start'
      ? { type: 'start', tabId, provider, options: choice, mode, confirmSensitive }
      : { type: 'control', tabId, command });
    if (result.ok) {
      setPage((current) => current && ({ ...current, reader: result.value }));
    } else setError(result.error);
    setPending(false);
  }

  async function toggleSelection(kind: 'selection' | 'paragraph') {
    if (tabId === undefined || provider === undefined || !page || pending) return;
    const field = kind === 'paragraph' ? 'paragraphEnabled' : 'selectionEnabled';
    const enable = !page[field];
    setPending(true);
    setError(undefined);
    const result = await request<null>(enable
      ? { type: `${kind}-start`, tabId, provider, options: choice, confirmSensitive }
      : { type: `${kind}-stop`, tabId });
    if (result.ok) setPage((current) => current && ({ ...current, [field]: enable }));
    else setError(result.error);
    setPending(false);
  }

  const active = Boolean(reader && (reader.status !== 'error' || reader.total > 0));
  const translationAction = !active ? modeLabels[mode].start : mode === readerMode ? '重新翻译' : modeLabels[mode].switch;
  const retry = readerMode !== 'dual' && (reader?.failed ?? 0) > 0;
  const access = page && selectedProviderAccess(page.settings);
  const configuredProviders = page ? providers.filter((id) => page.settings.providers[id].configured) : [];
  const setup = access && (!access.configured || !access.authorized);
  const blocked = pending || !page || Boolean(page.error || (page.sensitive && !confirmSensitive));
  const info = error ?? page?.error ?? reader?.error ??
    (setup ? access.configured ? 'consent-required' : 'not-configured' : undefined);

  return <main>
    <header>
      <div className="brand"><img src="/icons/32.png" alt="" width="28" height="28" /><h1>AlignRead</h1></div>
      <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>设置</button>
      {pdfTab && tabId !== undefined ? <><button type="button" disabled={!panelReady} onClick={() => {
        void browser.sidePanel.open({ tabId }).then(() => window.close(), () => setPanelError(true));
      }}>在此页对照翻译</button><button type="button" onClick={() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/pdf.html') + '#inplace=' + tabId })
          .then(() => window.close(), () => setError('unavailable'));
      }}>在新标签页原位翻译</button></> : <button type="button" disabled={tabId === undefined}
        onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/pdf.html') })}>打开 PDF</button>}
    </header>
    {panelError && <p className="notice" role="status">无法打开侧边栏，请重新打开扩展后重试。</p>}
    {!pdfTab && <>{page && <label className="field provider-field">翻译服务
      <select value={access?.configured ? provider : ''} disabled={pending || configuredProviders.length === 0}
        onChange={(event) => void switchProvider(event.target.value)}>
        {!access?.configured && <option value="" disabled>
          {configuredProviders.length ? '选择已配置的服务' : '暂无已配置的服务'}
        </option>}
        {configuredProviders.map((id) => {
          const { consent, hostPermission } = page.settings.providers[id];
          return <option key={id} value={id}>
            {TRANSLATION_PROVIDERS[id].label}{consent && hostPermission ? '' : '（待授权）'}
          </option>;
        })}
      </select>
    </label>}
    <LanguageFields value={choice} change={setChoice} locked={pending || Boolean(page?.error)} />
    <ReaderModeSelector className="mode-field" mode={mode} onChange={setModeChoice} disabled={pending || !page || Boolean(page.error)} />
    {page?.sensitive && <label className="check sensitive">
      <input type="checkbox" checked={confirmSensitive} disabled={pending}
        onChange={(event) => setConfirmedProvider(event.target.checked ? provider : undefined)} />
      <span>此页面可能包含敏感信息，我确认可以向当前服务发送待译文字。</span>
    </label>}
    {reader && !reader.error && <p className="notice" role="status">
      {reader.status === 'ready' && reader.total === 0 ? '已显示原文' : progressLabels[reader.status]}
      {reader.total > 0 && ' · ' + reader.done + '/' + reader.total}
    </p>}
    {info && <p className="notice" role="status">
      {info === 'unsupported-page' ? '当前页面无法使用翻译。' : errors[info]}
    </p>}
    <div className="actions">
      {setup ? <button type="button" className="primary" onClick={() => void browser.runtime.openOptionsPage()}>配置翻译服务</button>
        : <button type="button" className="primary" disabled={blocked} onClick={() => void execute('start')}>
          {translationAction}
        </button>}
      {active && <>
        {reader && (!retry || !reader.error) && (reader.status === 'paused' || reader.done + reader.failed < reader.total) &&
          <button type="button" disabled={pending}
            onClick={() => void execute(reader.status === 'paused' || reader.error ? 'resume' : 'pause')}>
            {reader.status === 'paused' || reader.error ? '继续' : '暂停'}
          </button>}
        {retry && <button type="button" disabled={pending} onClick={() => void execute('retry')}>重试失败项</button>}
        <button type="button" disabled={pending} onClick={() => void execute('stop')}>{modeLabels[readerMode].stop}</button>
      </>}
    </div>
      <div className="selection-actions">
        <div>
          <button type="button" disabled={page?.selectionEnabled ? pending : blocked || Boolean(setup)}
            aria-pressed={Boolean(page?.selectionEnabled)} aria-describedby="selection-consent"
            onClick={() => void toggleSelection('selection')}>
            {page?.selectionEnabled ? '关闭选词翻译' : '开启选词翻译'}
          </button>
          <p className="selection-consent" id="selection-consent">点击「译」发送选中文字。</p>
        </div>
        <div>
          <button type="button" disabled={page?.paragraphEnabled ? pending : blocked || Boolean(setup) || (active && readerMode === 'bilingual')}
            aria-pressed={Boolean(page?.paragraphEnabled)} aria-describedby="paragraph-consent"
            onClick={() => void toggleSelection('paragraph')}>
            {page?.paragraphEnabled ? '关闭段落翻译' : '开启段落翻译'}
          </button>
          <p className="selection-consent" id="paragraph-consent">{active && readerMode === 'bilingual' ? '段落双语已开启，选区快捷键暂停。' : '按快捷键发送选区涉及的整段正文。'}</p>
          {page && <a className="shortcut-settings" href="options.html#shortcuts" target="_blank" rel="noopener noreferrer">
            段落快捷键 · {page.settings.paragraphShortcut}
          </a>}
        </div>
    </div>
    </>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup />);
