export function splitText(text: string): string[] {
  if (text.length <= 1500) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 1500) {
    const preferred = remaining.lastIndexOf(' ', 1499) + 1;
    let split = preferred > 800 ? preferred : 1500;
    if (/[\uD800-\uDBFF]/.test(remaining.charAt(split - 1))) split--;
    parts.push(remaining.slice(0, split));
    remaining = remaining.slice(split);
  }
  return [...parts, remaining];
}
