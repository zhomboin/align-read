// 选词授权绑定文档地址，只允许在同一地址的普通页内锚点间移动。
export function sameSelectionPage(initial: string | undefined, current: string | undefined,
  hasAnchor?: (name: string) => boolean) {
  if (!initial || !current) return false;
  if (initial === current) return true;
  const [base, ...from] = initial.split('#');
  const [nextBase, ...to] = current.split('#');
  if (base !== nextBase) return false;
  return [from.join('#'), to.join('#')].every(fragment => {
    if (!fragment) return true;
    try {
      const name = decodeURIComponent(fragment);
      return !/[!/?#]/.test(name) && (hasAnchor?.(name) ?? true);
    } catch {
      return false;
    }
  });
}
