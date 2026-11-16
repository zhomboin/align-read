import { browser } from 'wxt/browser';
import { failure, type OptionsMessage, type PopupMessage, type Result } from './reader-messages';

export function request<T>(message: OptionsMessage | PopupMessage): Promise<Result<T>> {
  return browser.runtime.sendMessage(message).then(
    (reply: Result<T> | undefined) => reply ?? failure('unavailable'),
    () => failure('unavailable'),
  );
}
