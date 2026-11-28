import type { ReaderMode, ReaderState } from '../../shared/reader-messages';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { focusReaderMode, ReplacementControls, type ReaderModeSwitch } from './reader-mode-controls';
import css from './reader.css?inline';

export function createReplacementToolbar(mode: ReaderMode, layer?: HTMLElement) {
  const host = document.createElement('div');
  host.dataset.alignreadHost = mode;
  host.style.setProperty('all', 'initial', 'important');
  for (const [property, value] of Object.entries({
    position: 'fixed', inset: '12px 12px auto auto', display: 'block', 'z-index': '2147483647',
    margin: '0', padding: '0', border: '0', visibility: 'visible', 'pointer-events': 'auto',
  })) host.style.setProperty(property, value, 'important');

  if (layer) host.popover = 'manual';
  const shadow = host.attachShadow({ mode: 'closed' });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(css);
  shadow.adoptedStyleSheets = [stylesheet];
  const root = createRoot(shadow);

  function mount() {
    const documentRoot = layer ?? document.documentElement;
    if (host.parentElement !== documentRoot) {
      documentRoot.insertBefore(host, documentRoot.querySelector(':scope > [data-alignread-selection]'));
    }
    if (layer && host.isConnected && !host.matches(':popover-open')) host.showPopover();
  }

  return {
    mount,
    render(state: ReaderState, modeSwitch: ReaderModeSwitch, close: () => void) {
      flushSync(() => root.render(<ReplacementControls mode={mode} state={state} modeSwitch={modeSwitch} close={close} />));
    },
    focusMode: () => focusReaderMode(shadow),
    close() {
      root.unmount();
      host.remove();
    },
  };
}
