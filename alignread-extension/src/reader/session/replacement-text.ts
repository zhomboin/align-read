export function trackReplacementText() {
  const translated = new Map<Text, { original: string; applied: string }>();
  const ownWrites = new WeakMap<Text, string[]>();
  const siteControlled = new WeakMap<Text, string>();

  function readText(node: Text) {
    const entry = translated.get(node);
    return entry && node.data === entry.applied ? entry.original : node.data;
  }

  function write(node: Text, value: string) {
    if (node.data === value) return;
    if (node.getRootNode() === document) {
      const previous = ownWrites.get(node) ?? [];
      previous.push(node.data);
      ownWrites.set(node, previous);
    }
    node.data = value;
  }

  function restore(node: Text) {
    const entry = translated.get(node);
    translated.delete(node);
    if (entry && node.ownerDocument === document && node.data === entry.applied) write(node, entry.original);
  }

  return {
    readText,
    siteControls(node: Text) { return siteControlled.get(node) === node.data; },
    isSourceMutation(record: MutationRecord) {
      if (record.type !== 'characterData' || !(record.target instanceof Text)) return true;
      const node = record.target;
      const previous = ownWrites.get(node);
      if (previous?.[0] === record.oldValue) {
        previous.shift();
        if (!previous.length) ownWrites.delete(node);
        return false;
      }
      const entry = translated.get(node);
      if (entry && (node.data === entry.original || node.data === entry.applied)) {
        // The site claimed the same text. Leave it alone until the site changes the value.
        siteControlled.set(node, node.data);
      } else if (siteControlled.get(node) !== node.data) {
        siteControlled.delete(node);
      }
      translated.delete(node);
      return true;
    },
    apply(node: Text, original: string, value: string) {
      if (readText(node) !== original || siteControlled.get(node) === node.data) return;
      if (value === original) {
        restore(node);
        return;
      }
      translated.set(node, { original, applied: value });
      write(node, value);
    },
    restore,
    restoreExcept(retained?: ReadonlySet<Text>) {
      for (const node of translated.keys()) {
        if (!retained?.has(node)) restore(node);
      }
    },
  };
}
