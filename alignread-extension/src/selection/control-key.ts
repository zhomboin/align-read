export function onControlTap(trigger: () => void, signal: AbortSignal) {
  const options = { capture: true, signal };
  const held = new Set<string>();
  let armed = false;
  let pointerDown = false;
  function reset() {
    armed = false;
    pointerDown = false;
    held.clear();
  }
  window.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    const id = event.code || event.key;
    if (!event.repeat) {
      armed = event.key === 'Control' && !held.size && !pointerDown &&
        !event.shiftKey && !event.altKey && !event.metaKey && !event.isComposing;
    }
    held.add(id);
  }, options);
  window.addEventListener('keyup', event => {
    if (!event.isTrusted) return;
    const singleControl = armed && event.key === 'Control' && held.has(event.code || event.key);
    held.delete(event.code || event.key);
    armed = false;
    if (singleControl) trigger();
  }, options);
  window.addEventListener('pointerdown', () => { pointerDown = true; armed = false; }, options);
  window.addEventListener('pointerup', event => { pointerDown = Boolean(event.buttons); armed = false; }, options);
  window.addEventListener('pointercancel', reset, options);
  window.addEventListener('wheel', () => { armed = false; }, { ...options, passive: true });
  window.addEventListener('blur', reset, { signal });
  document.addEventListener('visibilitychange', reset, { signal });
}
