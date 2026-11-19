import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { focusReaderMode, ReplacementControls, type ReaderModeSwitch } from './reader-mode-controls';
import css from './reader.css?inline';

export function createReplacementToolbar() {
  const host = document.createElement('div');
  host.dataset.alignreadHost = 'replace';
  host.style.setProperty('all', 'initial', 'important');
  for (const [property, value] of Object.entries({
    position: 'fixed', inset: '12px 12px auto auto', display: 'block', 'z-index': '2147483647',
    margin: '0', padding: '0', border: '0', visibility: 'visible', 'pointer-events': 'auto',
  })) host.style.setProperty(property, value, 'important');

  const shadow = host.attachShadow({ mode: 'closed' });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(css);
  shadow.adoptedStyleSheets = [stylesheet];
  const root = createRoot(shadow);

  function mount() {
    const documentRoot = document.documentElement;
    if (host.parentElement !== documentRoot) {
      documentRoot.insertBefore(host, documentRoot.querySelector(':scope > [data-alignread-selection]'));
    }
  }

  return {
    mount,
    render(modeSwitch: ReaderModeSwitch, close: () => void) {
      flushSync(() => root.render(<ReplacementControls modeSwitch={modeSwitch} close={close} />));
    },
    focusMode: () => focusReaderMode(shadow),
    close() {
      root.unmount();
      host.remove();
    },
  };
}
