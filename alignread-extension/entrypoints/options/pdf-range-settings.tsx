import { useEffect, useState, type FormEvent } from 'react';
import { request } from '../../src/shared/extension';
import { DEFAULT_PDF_LOOK_AHEAD, errors, isPdfLookAhead, type PdfLookAhead } from '../../src/shared/reader-messages';

export function PdfRangeSettings({ value, disabled, onSaved }: {
  value: PdfLookAhead; disabled: boolean; onSaved: (value: PdfLookAhead) => void;
}) {
  const [all, setAll] = useState(value === 'all');
  const [count, setCount] = useState(String(value === 'all' ? DEFAULT_PDF_LOOK_AHEAD : value));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setAll(value === 'all');
    if (value !== 'all') setCount(String(value));
  }, [value]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const range = all ? 'all' : Number(count);
    if ((!all && count === '') || !isPdfLookAhead(range)) return;
    setSaving(true);
    const result = await request<PdfLookAhead>({ type: 'save-pdf-range', pdfLookAhead: range });
    if (result.ok) onSaved(result.value);
    setMessage(result.ok ? '设置已保存。' : errors[result.error]);
    setSaving(false);
  }

  return <form className="preference-form" onSubmit={save}>
    <section className="panel">
      <label className="field">默认翻译范围
        <select id="pdf-range" value={all ? 'all' : 'pages'} disabled={disabled || saving}
          onChange={event => { setAll(event.target.value === 'all'); setMessage(''); }}>
          <option value="pages">当前页及后续页</option><option value="all">整份 PDF</option>
        </select>
      </label>
      {!all && <label className="field">向后预译页数
        <input id="pdf-look-ahead" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" required
          value={count} disabled={disabled || saving} aria-describedby="pdf-range-hint"
          onChange={event => { setCount(event.target.value); setMessage(''); }} />
      </label>}
      <p className="hint" id="pdf-range-hint">{all
        ? '从当前页译到末页，再补译前面的页面。' : '填 0 只翻译当前页。翻页后按新页码继续。'}</p>
    </section>
    <footer className="actions">
      <button type="submit" className="primary" disabled={disabled || saving}>保存设置</button>
      <p className="feedback" role="status">{message}</p>
    </footer>
  </form>;
}
