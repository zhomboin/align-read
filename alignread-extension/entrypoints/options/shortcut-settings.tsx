import { useEffect, useState } from 'react';
import { request } from '../../src/shared/extension';
import { DEFAULT_PARAGRAPH_SHORTCUT, listenForShortcut } from '../../src/shared/paragraph-shortcut';
import { errors } from '../../src/shared/reader-messages';

export function ShortcutSettings({ value, disabled, onSaved }: {
  value: string; disabled: boolean; onSaved: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save(shortcut: string) {
    setRecording(false);
    setSaving(true);
    const result = await request<string>({ type: 'save-shortcut', shortcut });
    if (result.ok) onSaved(result.value);
    setMessage(result.ok ? '快捷键已保存。' : errors[result.error]);
    setSaving(false);
  }

  useEffect(() => {
    if (!recording) return;
    const controller = new AbortController();
    listenForShortcut(shortcut => {
      controller.abort();
      void save(shortcut);
      return true;
    }, controller.signal);
    return () => controller.abort();
  }, [recording]);

  return <section className="panel shortcut-panel">
    <h3>段落翻译快捷键</h3>
    <div className="actions">
      <kbd>{value}</kbd>
      <button type="button" disabled={disabled || saving} aria-pressed={recording}
        onClick={event => { event.currentTarget.focus(); setRecording(!recording); setMessage(''); }}
        onBlur={() => setRecording(false)}
        onKeyDown={event => {
          if (recording && event.key === 'Escape') {
            event.preventDefault();
            setRecording(false);
          }
        }}>{recording ? '取消录入' : '更改快捷键'}</button>
      <button type="button" disabled={disabled || saving || value === DEFAULT_PARAGRAPH_SHORTCUT}
        onClick={() => void save(DEFAULT_PARAGRAPH_SHORTCUT)}>恢复 Ctrl</button>
    </div>
    <p className="hint" role="status">{recording ? '请按新快捷键，例如 F8 或 Alt+K。Esc 取消。' : message}</p>
  </section>;
}
