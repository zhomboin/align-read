import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { request } from '../../src/shared/extension';
import { LanguageFields } from '../../src/shared/language-fields';
import {
  TRANSLATION_PROVIDERS, defaults, errors, selectedProviderAccess,
  type ErrorCode, type PageState, type ProviderId, type ReadingOptions, type ReaderState,
} from '../../src/shared/reader-messages';
import '../../src/shared/settings-controls.css';
import './popup.css';

const progressLabels = {
  preparing: '正在提取页面内容', translating: '正在翻译', paused: '已暂停',
  partial: '已显示部分译文', ready: '翻译完成', error: '翻译遇到问题',
};

function Popup() {
  const [tabId, setTabId] = useState<number>();
  const [page, setPage] = useState<PageState>();
  const [choice, setChoice] = useState<ReadingOptions>(defaults);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode>();
  const [confirmedProvider, setConfirmedProvider] = useState<ProviderId>();
  const provider = page?.settings.provider;
  const confirmSensitive = provider !== undefined && confirmedProvider === provider;

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (disposed) return;
      if (tab?.id === undefined) { setError('unsupported-page'); return; }
      setTabId(tab.id);
      const update = async (initial: boolean) => {
        const result = await request<PageState>({ type: 'page', tabId: tab.id! });
        if (disposed) return;
        if (result.ok) {
          setPage(result.value);
          if (initial) setChoice(result.value.settings);
        } else if (initial) setError(result.error);
        timer = window.setTimeout(() => void update(false), 900);
      };
      void update(true);
    }, () => setError('unavailable'));
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  async function execute(command: 'start' | 'pause' | 'resume' | 'stop') {
    if (tabId === undefined || provider === undefined || pending) return;
    setPending(true);
    setError(undefined);
    const result = await request<ReaderState | null>(command === 'start'
      ? { type: 'start', tabId, provider, options: choice, confirmSensitive }
      : { type: 'control', tabId, command });
    if (result.ok) {
      setPage((current) => current && ({ ...current, reader: result.value }));
    } else setError(result.error);
    setPending(false);
  }

  async function toggleSelection() {
    if (tabId === undefined || provider === undefined || !page || pending) return;
    const enable = !page.selectionEnabled;
    setPending(true);
    setError(undefined);
    const result = await request<null>(enable
      ? { type: 'selection-start', tabId, provider, options: choice, confirmSensitive }
      : { type: 'selection-stop', tabId });
    if (result.ok) setPage((current) => current && ({ ...current, selectionEnabled: enable }));
    else setError(result.error);
    setPending(false);
  }

  const reader = page?.reader;
  const active = Boolean(reader && (reader.status !== 'error' || reader.total > 0));
  const access = page && selectedProviderAccess(page.settings);
  const setup = access && (!access.configured || !access.authorized);
  const blocked = pending || !page || Boolean(page.error || (page.sensitive && !confirmSensitive));
  const info = error ?? page?.error ?? reader?.error ??
    (setup ? access.configured ? 'consent-required' : 'not-configured' : undefined);

  return <main>
    <header>
      <div className="brand"><img src="/icons/32.png" alt="" width="28" height="28" /><h1>AlignRead</h1></div>
      <button type="button" onClick={() => void browser.runtime.openOptionsPage()}>设置</button>
    </header>
    {provider && <p className="provider-name">翻译服务 · {TRANSLATION_PROVIDERS[provider].label}</p>}
    <LanguageFields value={choice} change={setChoice} locked={pending || Boolean(page?.error)} />
    {page?.sensitive && <label className="check sensitive">
      <input type="checkbox" checked={confirmSensitive}
        onChange={(event) => setConfirmedProvider(event.target.checked ? provider : undefined)} />
      <span>此页面可能包含敏感信息，我确认可以向当前服务发送待译文字。</span>
    </label>}
    {reader && !reader.error && <p className="notice" role="status">
      {progressLabels[reader.status]}{reader.total > 0 && ' · ' + reader.done + '/' + reader.total}
    </p>}
    {info && <p className="notice" role="status">
      {info === 'unsupported-page' ? '当前页面无法使用翻译。' : errors[info]}
    </p>}
    <div className="actions">
      {setup ? <button type="button" className="primary" onClick={() => void browser.runtime.openOptionsPage()}>配置翻译服务</button>
        : <button type="button" className="primary" disabled={blocked} onClick={() => void execute('start')}>
          {active ? '重新翻译' : '开启双栏'}
        </button>}
      {active && <>
        {reader && reader.done + reader.failed < reader.total && <button type="button" disabled={pending}
          onClick={() => void execute(reader.status === 'paused' || reader.error ? 'resume' : 'pause')}>
          {reader.status === 'paused' || reader.error ? '继续' : '暂停'}
        </button>}
        <button type="button" disabled={pending} onClick={() => void execute('stop')}>关闭双栏</button>
      </>}
    </div>
    <div className="actions selection-actions">
      <button type="button" disabled={page?.selectionEnabled ? pending : blocked || Boolean(setup)}
        aria-describedby={page?.selectionEnabled || setup || !page || page.error ? undefined : 'selection-consent'}
        onClick={() => void toggleSelection()}>
        {page?.selectionEnabled ? '关闭选词翻译' : '开启选词翻译'}
      </button>
    </div>
    {page && !page.error && !setup && !page.selectionEnabled && <p className="selection-consent" id="selection-consent">
      点击「译」后，选中文字会发送给当前翻译服务。
    </p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup />);
