import { AI_FIELD_LIMITS, parseAiSettings, type AiCredentials, type AiSettings } from '../../src/shared/ai-settings';
import type { ProviderStatus } from '../../src/shared/reader-messages';

export type AiDraft = AiCredentials & { authorized: boolean };

type Props = {
  draft: AiDraft;
  saved: AiSettings | null;
  status: ProviderStatus;
  busy: boolean;
  feedback: string;
  onChange: (draft: AiDraft) => void;
  onSave: (clear?: boolean) => void;
  onTest: () => void;
};

export function AiProviderForm({ draft, saved, status, busy, feedback, onChange, onSave, onTest }: Props) {
  const fields = parseAiSettings(draft);
  const canReuseKey = saved !== null && fields?.endpoint === saved.endpoint;
  const edited = !canReuseKey || fields?.model !== saved?.model || Boolean(draft.apiKey) || draft.authorized !== status.consent;
  return <form aria-label="AI 翻译" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
    <label className="field">Chat Completions 地址
      <input name="endpoint" type="url" autoComplete="off" spellCheck={false} required disabled={busy}
        maxLength={AI_FIELD_LIMITS.endpoint} placeholder="https://api.example.com/v1/chat/completions"
        value={draft.endpoint} onChange={(event) => onChange({ ...draft, endpoint: event.target.value })} />
    </label>
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
      <span>我同意将待译文字和语言参数发送到此 AI 服务。</span>
    </label>
    <div className="actions">
      <button className="primary" type="submit" disabled={busy}>保存 AI 设置</button>
      <button type="button" disabled={busy || edited || !status.configured || !status.consent || !status.hostPermission}
        onClick={onTest}>测试连接</button>
      {status.configured && <button className="quiet destructive" type="button" disabled={busy}
        onClick={() => onSave(true)}>清除 AI 配置</button>}
    </div>
    <p className="feedback" role="status">{feedback}</p>
  </form>;
}
