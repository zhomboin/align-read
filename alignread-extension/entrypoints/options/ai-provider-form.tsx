import {
  AI_FIELD_LIMITS, AI_PROVIDERS, MINIMAX_ENDPOINTS, parseAiSettings, type AiCredentials, type AiProviderId, type AiSettings,
} from '../../src/shared/ai-settings';
import type { ProviderStatus } from '../../src/shared/reader-messages';

export type AiDraft = AiCredentials & { authorized: boolean };

type Props = {
  provider: AiProviderId;
  draft: AiDraft;
  saved: AiSettings | null;
  status: ProviderStatus;
  busy: boolean;
  feedback: string;
  onChange: (draft: AiDraft) => void;
  onSave: (clear?: boolean) => void;
  onTest: () => void;
};

export function AiProviderForm({ provider, draft, saved, status, busy, feedback, onChange, onSave, onTest }: Props) {
  const { label } = AI_PROVIDERS[provider];
  const fields = parseAiSettings(provider, draft);
  const canReuseKey = saved !== null && fields?.endpoint === saved.endpoint;
  const edited = !canReuseKey || fields?.model !== saved?.model || Boolean(draft.apiKey) || draft.authorized !== status.consent;
  return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    {provider === 'minimax' ? <label className="field">服务地区
      <select name="endpoint" value={draft.endpoint} disabled={busy}
        onChange={(event) => onChange({ ...draft, endpoint: event.target.value, apiKey: '', authorized: false })}>
        <option value={MINIMAX_ENDPOINTS.cn}>中国站</option>
        <option value={MINIMAX_ENDPOINTS.global}>国际站</option>
      </select>
    </label> : <label className="field">Chat Completions 地址
      <input name="endpoint" type="url" autoComplete="off" spellCheck={false} required disabled={busy} readOnly={provider === 'deepseek'}
        maxLength={AI_FIELD_LIMITS.endpoint} placeholder="https://api.example.com/v1/chat/completions"
        value={draft.endpoint} onChange={(event) => onChange({ ...draft, endpoint: event.target.value })} />
    </label>}
    <label className="field">模型名称
      <input name="model" type="text" autoComplete="off" spellCheck={false} required disabled={busy}
        maxLength={AI_FIELD_LIMITS.model} value={draft.model}
        onChange={(event) => onChange({ ...draft, model: event.target.value })} />
    </label>
    <label className="field">API 密钥
      <input type="password" autoComplete="off" spellCheck={false} required={!canReuseKey} disabled={busy}
        maxLength={AI_FIELD_LIMITS.apiKey} placeholder={canReuseKey ? '留空保留当前密钥' : undefined}
        value={draft.apiKey} onChange={(event) => onChange({ ...draft, apiKey: event.target.value })} />
    </label>
    <label className="check"><input type="checkbox" checked={draft.authorized} disabled={busy}
      onChange={(event) => onChange({ ...draft, authorized: event.target.checked })} />
      <span>我同意将待译文字和语言参数发送给{provider === 'ai' ? '此 AI 服务' : ` ${label}`}。</span>
    </label>
    <div className="actions">
      <button className="primary" type="submit" disabled={busy}>保存{provider === 'ai' ? ' AI ' : ` ${label} `}设置</button>
      <button type="button" disabled={busy || edited || !status.configured || !status.consent || !status.hostPermission}
        onClick={onTest}>测试连接</button>
      {status.configured && <button className="quiet destructive" type="button" disabled={busy}
        onClick={() => onSave(true)}>清除配置</button>}
    </div>
    <p className="feedback" role="status">{feedback}</p>
  </form>;
}
