import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { request } from '../../src/shared/extension';
import { LanguageFields } from '../../src/shared/language-fields';
import {
  MAX_YOUDAO_CREDENTIAL_LENGTH, TRANSLATION_PROVIDERS, defaults, errors, isProviderId,
  type ProviderId, type ProviderStatus, type PublicSettings, type YoudaoCredentials,
} from '../../src/shared/reader-messages';
import './options.css';

const emptyYoudaoCredentials: YoudaoCredentials = { appKey: '', appSecret: '' };
const emptyStatus: ProviderStatus = { configured: false, consent: false, hostPermission: false, lastCheck: null };

function ConnectionStatus({ provider, status, testing }: { provider: ProviderId; status: ProviderStatus; testing: boolean }) {
  const { configured, consent, hostPermission, lastCheck, appKeySuffix } = status;
  const saved = configured ? '已保存' : '未保存';
  return <dl className="connection-status">
    {provider === 'youdao' ? <>
      <dt>应用 ID</dt><dd>{saved}{appKeySuffix && <span>（尾号 {appKeySuffix}）</span>}</dd>
      <dt>应用密钥</dt><dd>{saved}</dd>
    </> : <><dt>API 密钥</dt><dd>{saved}</dd></>}
    <dt>文本外发同意</dt><dd>{consent ? '已同意' : '未同意'}</dd>
    <dt>浏览器访问权限</dt><dd>{hostPermission ? '已授予' : '未授予'}</dd>
    <dt>连接测试</dt><dd role="status">{testing ? '正在测试…' : lastCheck ? <>
      <strong>{lastCheck.error ? '失败' : '通过'}</strong>
      <time className="hint" dateTime={new Date(lastCheck.checkedAt).toISOString()}>
        {new Date(lastCheck.checkedAt).toLocaleString()}
      </time>
      {lastCheck.error && <div>{lastCheck.error === 'timeout' ? '等待翻译接口响应超时。' : errors[lastCheck.error]}</div>}
    </> : '尚未测试'}</dd>
  </dl>;
}

function Options() {
  const [settings, setSettings] = useState<PublicSettings>({
    ...defaults, provider: 'google', providers: { google: emptyStatus, youdao: emptyStatus },
  });
  const [key, setKey] = useState('');
  const [erase, setErase] = useState(false);
  const [googleConsent, setGoogleConsent] = useState(false);
  const [googleMessage, setGoogleMessage] = useState('');
  const [youdao, setYoudao] = useState(emptyYoudaoCredentials);
  const [youdaoConsent, setYoudaoConsent] = useState(false);
  const [youdaoMessage, setYoudaoMessage] = useState('');
  const [providerMessage, setProviderMessage] = useState('');
  const [sites, setSites] = useState('');
  const [saving, setBusy] = useState(true);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState('');
  const [cacheBytes, setCacheBytes] = useState(0);
  const { google, youdao: youdaoStatus } = settings.providers;
  const busy = saving || testing !== null;
  const googleEdited = Boolean(key.trim()) || erase || googleConsent !== google.consent;
  const youdaoEdited = Boolean(youdao.appKey.trim() || youdao.appSecret.trim()) || youdaoConsent !== youdaoStatus.consent;

  function adopt(saved: PublicSettings) {
    setSettings(saved);
    setSites(saved.disabledSites.join('\n'));
    setKey('');
    setErase(false);
    setGoogleConsent(saved.providers.google.consent);
    setYoudaoConsent(saved.providers.youdao.consent);
    setYoudao(emptyYoudaoCredentials);
  }

  function adoptProviders(saved: PublicSettings) {
    setSettings((current) => ({ ...current, providers: saved.providers, provider: saved.provider }));
  }

  async function usage() {
    const result = await request<number>({ type: 'cache-usage' });
    if (result.ok) setCacheBytes(result.value);
  }

  useEffect(() => {
    void request<PublicSettings>({ type: 'settings' }).then((result) => {
      if (result.ok) adopt(result.value);
      else setMessage(errors[result.error]);
      setBusy(false);
    });
    void usage();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { provider: _provider, providers: _providers, ...reading } = settings;
    const preferences = { ...reading, disabledSites: sites.split(/[\n,\s]+/).filter(Boolean) };
    const result = await request<PublicSettings>({ type: 'save', preferences });
    if (result.ok) {
      setSettings(result.value);
      setSites(result.value.disabledSites.join('\n'));
    }
    setMessage(result.ok ? '设置已保存。' : errors[result.error]);
    await usage();
    setBusy(false);
  }

  async function clearCache() {
    setBusy(true);
    const result = await request<null>({ type: 'clear-cache' });
    if (result.ok) setCacheBytes(0);
    setMessage(result.ok ? '会话缓存已清空。' : errors[result.error]);
    setBusy(false);
  }

  async function selectProvider(provider: ProviderId) {
    setBusy(true);
    setProviderMessage('');
    const result = await request<PublicSettings>({ type: 'select-provider', provider });
    if (result.ok) adoptProviders(result.value);
    setProviderMessage(result.ok ? '' : errors[result.error]);
    setBusy(false);
  }

  function grantPermission(provider: ProviderId) {
    return browser.permissions.request({ origins: [TRANSLATION_PROVIDERS[provider].origin] }).catch(() => false);
  }

  async function saveGoogle(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setGoogleMessage('');
    const authorized = !erase && googleConsent && Boolean(key.trim() || google.configured);
    if (authorized) await grantPermission('google');
    const result = await request<PublicSettings>({ type: 'save-google', authorized, key: erase ? '' : key.trim() || undefined });
    if (result.ok) {
      adoptProviders(result.value);
      setGoogleConsent(result.value.providers.google.consent);
      setKey('');
      setErase(false);
    }
    setGoogleMessage(result.ok ? 'Google 翻译配置已保存。' : errors[result.error]);
    setBusy(false);
  }

  async function saveYoudao(clear = false) {
    const appKey = youdao.appKey.trim();
    const appSecret = youdao.appSecret.trim();
    const replacing = Boolean(appKey || appSecret);
    if (!clear && (replacing || !youdaoStatus.configured) && (!appKey || !appSecret)) {
      setYoudaoMessage('请同时填写应用 ID 和应用密钥。');
      return;
    }
    setBusy(true);
    setYoudaoMessage('');
    const authorized = !clear && youdaoConsent;
    if (authorized) await grantPermission('youdao');
    const credentials = clear ? null : replacing ? { appKey, appSecret } : undefined;
    const result = await request<PublicSettings>({ type: 'save-youdao', credentials, authorized });
    if (result.ok) {
      adoptProviders(result.value);
      setYoudaoConsent(result.value.providers.youdao.consent);
      setYoudao(emptyYoudaoCredentials);
    }
    setYoudaoMessage(result.ok ? (clear ? '有道凭据已清除。' : '有道翻译配置已保存。') : errors[result.error]);
    setBusy(false);
  }

  async function testConnection(provider: ProviderId) {
    const setFeedback = provider === 'youdao' ? setYoudaoMessage : setGoogleMessage;
    setTesting(provider);
    setFeedback('');
    const result = await request<PublicSettings>({ type: 'test-provider', provider });
    if (result.ok) adoptProviders(result.value);
    else {
      setFeedback(errors[result.error]);
      const refreshed = await request<PublicSettings>({ type: 'settings' });
      if (refreshed.ok) adoptProviders(refreshed.value);
    }
    setTesting(null);
  }

  async function reset() {
    if (!window.confirm('恢复默认设置并移除已保存的密钥和翻译授权？')) return;
    setBusy(true);
    const result = await request<PublicSettings>({ type: 'reset' });
    if (result.ok) {
      adopt(result.value);
      setCacheBytes(0);
      setGoogleMessage('');
      setYoudaoMessage('');
      setProviderMessage('');
    }
    setMessage(result.ok ? '已恢复默认设置。' : errors[result.error]);
    setBusy(false);
  }

  return <main>
    <header><h1>AlignRead 设置</h1><small className="hint">版本 {browser.runtime.getManifest().version}</small></header>
    <section>
      <label className="field">当前翻译服务
        <select value={settings.provider} disabled={busy} onChange={(event) => {
          const provider = event.target.value;
          if (isProviderId(provider)) void selectProvider(provider);
        }}>
          {Object.entries(TRANSLATION_PROVIDERS).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      {providerMessage && <p role="status">{providerMessage}</p>}
    </section>
    <form onSubmit={(event) => { event.preventDefault(); void saveYoudao(); }}>
      <section>
        <h2>有道智云</h2>
        <ConnectionStatus provider="youdao" status={youdaoStatus} testing={testing === 'youdao'} />
        <label className="field">应用 ID（AppKey）
          <input type="text" autoComplete="off" spellCheck={false} value={youdao.appKey}
            maxLength={MAX_YOUDAO_CREDENTIAL_LENGTH} required={!youdaoStatus.configured} disabled={busy}
            placeholder={youdaoStatus.configured ? '留空保留当前应用 ID' : undefined}
            onChange={(event) => setYoudao({ ...youdao, appKey: event.target.value })} />
        </label>
        <label className="field">应用密钥（AppSecret）
          <input type="password" autoComplete="off" spellCheck={false} value={youdao.appSecret}
            maxLength={MAX_YOUDAO_CREDENTIAL_LENGTH} required={!youdaoStatus.configured} disabled={busy}
            placeholder={youdaoStatus.configured ? '留空保留当前应用密钥' : undefined}
            onChange={(event) => setYoudao({ ...youdao, appSecret: event.target.value })} />
        </label>
        <p className="hint">凭据保存在本机。已保存凭据时，留空即可保留。</p>
        <label className="check"><input type="checkbox" checked={youdaoConsent} disabled={busy}
          onChange={(event) => setYoudaoConsent(event.target.checked)} />
          我同意在使用有道智云翻译时，将可翻译的网页文本和语言参数发送给有道智云。</label>
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>保存有道设置</button>
          <button type="button" disabled={busy || youdaoEdited || !youdaoStatus.configured || !youdaoStatus.consent || !youdaoStatus.hostPermission}
            onClick={() => void testConnection('youdao')}>测试连接</button>
          {youdaoStatus.configured && <button type="button" disabled={busy}
            onClick={() => void saveYoudao(true)}>清除有道凭据</button>}
        </div>
        {youdaoMessage && <p role="status">{youdaoMessage}</p>}
      </section>
    </form>
    <form onSubmit={saveGoogle}>
      <section>
        <h2>{TRANSLATION_PROVIDERS.google.label}</h2>
        <ConnectionStatus provider="google" status={google} testing={testing === 'google'} />
        <label className="field">API 密钥
          <input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={250}
            placeholder={google.configured ? '留空保留当前密钥' : '输入 Google Cloud API 密钥'}
            disabled={busy || erase} onChange={(event) => setKey(event.target.value)} />
        </label>
        {google.configured && <label className="check"><input type="checkbox" checked={erase} disabled={busy}
          onChange={(event) => setErase(event.target.checked)} />移除当前密钥</label>}
        <p className="hint">密钥保存在本机浏览器扩展存储中。请在 Google Cloud 中把密钥限制为 Cloud Translation API。</p>
        <label className="check"><input type="checkbox" checked={googleConsent} disabled={busy}
          onChange={(event) => setGoogleConsent(event.target.checked)} />
          我同意在使用 Google Cloud Translation 翻译时，将待译文字和语言参数发送给该服务。</label>
        <p className="hint">密码、表单和可编辑区域会跳过。敏感页面需要额外确认。</p>
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>保存 Google 设置</button>
          <button type="button" disabled={busy || googleEdited || !google.configured || !google.consent || !google.hostPermission}
            onClick={() => void testConnection('google')}>测试连接</button>
        </div>
        {googleMessage && <p role="status">{googleMessage}</p>}
      </section>
    </form>
    <form onSubmit={save}>
      <section>
        <h2>双栏阅读</h2>
        <LanguageFields value={settings} change={(value) => setSettings({ ...settings, ...value })} locked={busy} />
        <label className="check"><input type="checkbox" checked={settings.syncScroll}
          onChange={(event) => setSettings({ ...settings, syncScroll: event.target.checked })} />默认开启同步滚动</label>
        <label className="check"><input type="checkbox" checked={settings.highlight}
          onChange={(event) => setSettings({ ...settings, highlight: event.target.checked })} />默认开启悬停高亮</label>
        <label className="field">原文栏宽度（{Math.round(settings.ratio * 100)}%）
          <input type="range" min={35} max={70} value={Math.round(settings.ratio * 100)}
            onChange={(event) => setSettings({ ...settings, ratio: Number(event.target.value) / 100 })} />
        </label>
      </section>
      <section>
        <h2>站点与缓存</h2>
        <label className="field">禁用站点
          <textarea rows={3} value={sites} onChange={(event) => setSites(event.target.value)}
            placeholder="每行一个域名，例如 example.com" />
        </label>
        <p className="hint">域名规则同时适用于其子域名。</p>
        <label className="check"><input type="checkbox" checked={settings.cache}
          onChange={(event) => setSettings({ ...settings, cache: event.target.checked })} />
          使用临时会话缓存</label>
        <p className="hint">活跃会话约占 {(cacheBytes / 1024).toFixed(1)} KiB，关闭双栏后释放。</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void usage()}>刷新占用</button>
          <button type="button" disabled={busy} onClick={() => void clearCache()}>清空缓存</button>
        </div>
      </section>
      <footer>
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>保存设置</button>
          <button type="button" disabled={busy} onClick={() => void reset()}>恢复默认设置</button>
        </div>
        <p role="status">{message}</p>
      </footer>
    </form>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Options />);
