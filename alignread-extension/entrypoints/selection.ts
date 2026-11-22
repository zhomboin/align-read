import { browser } from 'wxt/browser';
import { startSelection } from '../src/selection/selection';
import { isRecord, success } from '../src/shared/reader-messages';
import type { SelectionCommand } from '../src/shared/selection-messages';

export default defineUnlistedScript(() => {
  const binding = window as Window & { __alignReadSelection?: boolean };
  if (binding.__alignReadSelection) return;
  binding.__alignReadSelection = true;
  let active: ReturnType<typeof startSelection> | undefined;

  function stop() {
    active?.stop();
    active = undefined;
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== browser.runtime.id || !isRecord(message)) return;
    const command = message as SelectionCommand;
    switch (command.type) {
      case 'selection:state':
        reply(active?.id ?? null);
        break;
      case 'selection:stop':
        stop();
        reply(null);
        break;
      case 'selection:shortcut':
        if (active?.id === command.sessionId) active.setShortcut(command.shortcut);
        reply(null);
        break;
      case 'selection:start':
        stop();
        active = startSelection(command.session, () => { active = undefined; });
        reply(success(null));
        break;
    }
  });
  window.addEventListener('pagehide', stop);
});
