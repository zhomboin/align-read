import { createElement, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { errors, LANGUAGES, LIMITS, type ReaderState, type Session } from '../../shared/reader-messages';
import type { Piece, ReadingNode } from '../extraction/document';
import type { BlockStatus } from '../session/translation';
import { ReaderModeControl, type ReaderModeSwitch } from './reader-mode-controls';
import { MathView } from './math-view';
import { displayComment } from '../extraction/code-comments';

type Props = {
  session: Session; state: ReaderState; nodes: ReadingNode[];
  ratio: number; sync: boolean; hover: boolean;
  targets: Map<string, HTMLElement>;
  captureScroll: (element: HTMLElement | null) => void;
  show: (id: string, text: string) => string; status: (id: string) => BlockStatus;
  onHover: (id: string | null) => void; locate: (id: string) => void;
  retry: (id?: string) => void; close: () => void;
  setRatio: (ratio: number, final: boolean) => void;
  toggleSync: () => void; toggleHover: () => void; togglePause: () => void;
  modeSwitch: ReaderModeSwitch;
};

const summaries = {
  preparing: '正在提取页面内容', translating: '正在翻译', paused: '已暂停',
  partial: '译文分批显示', ready: '翻译完成', error: '翻译遇到问题',
};

export function ReaderPanel(props: Props) {
  const { session, state, sync, hover, ratio, modeSwitch } = props;

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  return (
    <section className={'panel' + (!props.nodes.length ? ' preparing' : '')} aria-label="AlignRead 双栏阅读">
      {props.nodes.length > 0 && <div className="divider" role="separator" aria-label="调整原文栏宽度"
        aria-orientation="vertical" aria-valuemin={LIMITS.minRatio * 100} aria-valuemax={LIMITS.maxRatio * 100}
        aria-valuenow={Math.round(ratio * 100)} tabIndex={0}
        onPointerDown={beginDrag}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            props.setRatio(event.clientX / window.innerWidth, false);
          }
        }}
        onLostPointerCapture={() => props.setRatio(ratio, true)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          props.setRatio(ratio + (event.key === 'ArrowLeft' ? -.02 : .02), true);
        }} />}
      <header className="toolbar">
        <div className="heading">
          <div>
            <h1>译文</h1>
            <p>{session.source === 'auto' ? '自动检测' : LANGUAGES[session.source]} → {LANGUAGES[session.target]}</p>
          </div>
          <button type="button" disabled={modeSwitch.pending} onClick={props.close}>关闭</button>
        </div>
        <div className="controls" aria-busy={modeSwitch.pending}>
          <ReaderModeControl mode="dual" modeSwitch={modeSwitch} />
          {props.nodes.length > 0 && <>
            <button type="button" disabled={modeSwitch.pending} aria-pressed={sync} onClick={props.toggleSync}>同步滚动</button>
            <button type="button" disabled={modeSwitch.pending} aria-pressed={hover} onClick={props.toggleHover}>悬停高亮</button>
            {!state.error && state.done + state.failed < state.total && <button type="button"
              disabled={modeSwitch.pending} onClick={props.togglePause}>
              {state.status === 'paused' ? '继续' : '暂停'}
            </button>}
            {state.failed > 0 && <button type="button" disabled={modeSwitch.pending} onClick={() => props.retry()}>
              重试失败项
            </button>}
          </>}
        </div>
        {modeSwitch.error && <p className="mode-switch-error" role="status">{errors[modeSwitch.error]}</p>}
        <div className="status" role="status">
          {state.error ? errors[state.error] : state.status === 'ready' && state.total === 0 ? '已显示原文' : summaries[state.status]}
          {state.total > 0 && <span>{state.done}/{state.total}{state.failed ? ' · 失败 ' + state.failed : ''}</span>}
        </div>
        {state.total > 0 && <progress aria-label="翻译进度" max={state.total} value={state.done + state.failed} />}
      </header>
      <div className="scroll" ref={props.captureScroll} tabIndex={0}
        onPointerOver={(event) => props.onHover(blockId(event.target))}
        onPointerOut={(event) => {
          if (blockId(event.target) !== blockId(event.relatedTarget)) props.onHover(blockId(event.relatedTarget));
        }}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey ||
              event.metaKey || event.shiftKey || !(event.target instanceof Element) ||
              event.target.closest('a,button') || window.getSelection()?.isCollapsed === false) return;
          const id = blockId(event.target);
          if (id) props.locate(id);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.defaultPrevented || event.repeat ||
              event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
              !(event.target instanceof HTMLElement) || window.getSelection()?.isCollapsed === false) return;
          const id = event.target.dataset.readerBlock;
          if (id) {
            event.preventDefault();
            props.locate(id);
          }
        }}>
        <article lang={session.target} className={hasColumns(props.nodes) ? 'with-sidebar' : undefined}>
          {props.nodes.map((node, index) => nodeView(node, props, index))}
        </article>
      </div>
    </section>
  );
}

function blockId(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>('[data-reader-block]')?.dataset.readerBlock ?? null : null;
}

function hasColumns(nodes: ReadingNode[]): boolean {
  return nodes.some((node) => 'children' in node && (node.side !== undefined || hasColumns(node.children)));
}

function nodeView(node: ReadingNode, props: Props, key: number): ReactNode {
  if ('children' in node) {
    const compactRow = node.compactRow;
    const style: CSSProperties & { '--reading-list-width'?: string } = {
      ...node.surface, flexGrow: node.columnWeight, textAlign: node.align,
      captionSide: node.captionSide, listStyleType: node.marker,
      justifyContent: node.inlineRow?.align,
      rowGap: compactRow?.rowGap, columnGap: compactRow?.columnGap,
    };
    if (node.listColumns) {
      style['--reading-list-width'] = `calc((100% - ${node.listColumns - 1} * .75em) / ${node.listColumns})`;
    }
    const content = createElement(node.tag, {
      key, 'aria-label': node.label, colSpan: node.span, rowSpan: node.rowSpan, start: node.start,
      scope: node.scope, reversed: node.reversed, value: node.listValue,
      'data-sidebar-side': node.side, 'data-reading-area': node.area,
      'data-reading-columns': node.columns,
      'data-reading-list-row': node.listRow,
      'data-reading-inline-row': Boolean(node.inlineRow) || undefined,
      'data-reading-compact-row': Boolean(compactRow) || undefined,
      'data-reading-compact-reverse': compactRow?.reverse,
      'data-reading-compact-scroll': compactRow?.scroll,
      dir: node.columns ?? node.inlineRow?.direction ?? compactRow?.direction ?? node.navigation?.direction,
      tabIndex: compactRow?.scroll ? 0 : undefined,
      'data-reading-navigation': node.navigation?.style,
      'data-vertical': node.navigation?.vertical || undefined,
      'aria-current': node.current || undefined,
      'data-reading-disclosure': node.disclosure,
      'data-reading-list-columns': node.listColumns,
      'data-reading-surface': Boolean(node.surface) || undefined,
      'data-reading-code-cell': node.codeCell,
      style,
    }, node.children.map((child, index) => nodeView(child, props, index)));
    return node.tag === 'table'
      ? <div key={key} className="table-scroll" tabIndex={0} role="region" aria-label="表格">{content}</div>
      : content;
  }
  if (node.tag === 'hr') return <hr key={key} />;
  if (node.tag === 'image') return (
    <div key={key} className="image-placeholder" role="img" aria-label={node.alt || '图片'}
      style={{ aspectRatio: node.width + ' / ' + node.height, width: node.width }}>{node.alt || '图片'}</div>
  );

  const state = props.status(node.id);
  const attributes = {
    key: node.id, 'data-reader-block': node.id, 'data-state': state,
    tabIndex: 0, 'aria-keyshortcuts': 'Enter',
    'data-reading-summary': node.tag === 'summary' || undefined,
    style: { ...node.inlineAppearance, whiteSpace: node.whiteSpace },
    ref: (element: HTMLElement | null) => {
      if (element) props.targets.set(node.id, element);
      else props.targets.delete(node.id);
    },
  };
  const children = node.pieces.map((piece) => pieceView(piece, props.show(piece.id, piece.text)));
  if (node.tag !== 'pre' && state === 'failed') children.push(
    <button key="retry" type="button" className="retry" onClick={() => props.retry(node.id)}>重试</button>);
  return createElement(node.tag === 'summary' ? 'div' : node.tag, attributes, children);
}

function pieceView(piece: Piece, text: string): ReactNode {
  if (piece.formula) return <MathView key={piece.id} formula={piece.formula} />;
  if (piece.lineBreak) return <br key={piece.id} />;
  let value: ReactNode = piece.comment ? displayComment(piece.text, text) : text;
  for (const mark of piece.marks) value = createElement(mark, null, value);
  if (piece.href) return <a key={piece.id} href={piece.href} target="_blank" rel="noopener noreferrer">{value}</a>;
  return <span key={piece.id}>{value}</span>;
}
