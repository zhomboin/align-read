import { errors, type ReaderState } from '../../shared/reader-messages';

const labels = {
  preparing: '正在提取页面内容', translating: '正在翻译', partial: '正在翻译',
  paused: '已暂停', ready: '翻译完成', error: '翻译遇到问题',
};

export function ReaderProgress({ state }: { state: ReaderState }) {
  const { status, total, done, failed, error } = state;
  let label = labels[status];
  if (error) label = errors[error];
  else if (status === 'ready' && !total) label = '已显示原文';
  else if (status === 'partial' && failed && done + failed === total) label = done ? '部分翻译失败' : '翻译失败';
  const count = `已完成 ${done}/${total} 段`;
  return <div className="reader-progress">
    <div className="status">
      <span role="status">{label}</span>
      {total > 0 && <span className="progress-count">{done}/{total} 段
        {failed > 0 && <span className="progress-failures"> · 失败 {failed}</span>}
      </span>}
    </div>
    {total > 0 && <progress aria-label="翻译进度" aria-valuetext={failed ? `${count}，失败 ${failed} 段` : count}
      value={done} max={total} />}
    {!total && status === 'preparing' && <progress aria-label="正在提取页面内容" />}
  </div>;
}
