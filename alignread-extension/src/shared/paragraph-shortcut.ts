export const DEFAULT_PARAGRAPH_SHORTCUT = 'Ctrl';
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const modifierNames: Record<string, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' };
const mainKey = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

export function isParagraphShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 40) return false;
  const parts = value.split('+');
  if (parts.every(part => modifiers.includes(part))) {
    return modifiers.filter(part => parts.includes(part)).join('+') === value;
  }
  const key = parts.pop()!;
  const canonical = [...modifiers.filter(modifier => parts.includes(modifier)), key].join('+');
  return mainKey.test(key) && canonical === value;
}

function pressedModifiers(event: KeyboardEvent) {
  const down = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey];
  return modifiers.filter((name, index) => down[index] || name === modifierNames[event.key]);
}

// 普通键在按下时识别，仅含修饰键的组合等到松开，以区分 Ctrl 和 Ctrl+C。
export function listenForShortcut(accept: (shortcut: string) => boolean, signal: AbortSignal) {
  const options = { capture: true, signal };
  const held = new Set<string>();
  let modifierTap = '';
  let pointerDown = false;
  function reset() {
    modifierTap = '';
    held.clear();
    pointerDown = false;
  }
  function consume(event: KeyboardEvent, shortcut?: string) {
    if (shortcut && accept(shortcut)) {
      event.preventDefault();
      if (event.type === 'keydown') event.stopImmediatePropagation();
    }
  }
  window.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) { modifierTap = ''; return; }
    const id = event.code || event.key;
    if (event.repeat || held.has(id)) return;
    const modifier = modifierNames[event.key];
    const mods = pressedModifiers(event);
    const continuesTap = held.size === 0 || Boolean(modifierTap);
    modifierTap = modifier && continuesTap && !pointerDown && mods.length === held.size + 1 ? mods.join('+') : '';
    const otherMainKey = [...held].some(code => !/^(Control|Alt|Shift|Meta)(Left|Right)?$/.test(code));
    held.add(id);
    if (modifier || otherMainKey || pointerDown) return;
    const key = event.code.replace(/^(?:Key(?=[A-Z]$)|Digit(?=[0-9]$))/, '') || event.key.toUpperCase();
    if (mainKey.test(key)) consume(event, [...mods, key].join('+'));
  }, options);
  window.addEventListener('keyup', event => {
    if (!event.isTrusted) return;
    const id = event.code || event.key;
    const tapped = modifierTap && held.has(id) && modifierNames[event.key];
    held.delete(id);
    const shortcut = modifierTap;
    modifierTap = '';
    if (tapped && !event.isComposing) consume(event, shortcut);
  }, options);
  window.addEventListener('pointerdown', () => { reset(); pointerDown = true; }, options);
  window.addEventListener('pointerup', event => { pointerDown = Boolean(event.buttons); modifierTap = ''; }, options);
  window.addEventListener('pointermove', event => { pointerDown = Boolean(event.buttons); }, { ...options, passive: true });
  window.addEventListener('pointercancel', reset, options);
  window.addEventListener('wheel', () => { modifierTap = ''; }, { ...options, passive: true });
  window.addEventListener('blur', reset, { signal });
  document.addEventListener('visibilitychange', reset, { signal });
  return reset;
}
