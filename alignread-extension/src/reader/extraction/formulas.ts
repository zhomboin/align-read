export const formulaSelector = 'math,.katex-display,.katex,mjx-container,.MathJax,.MathJax_Display,.MathJax_SVG,.MathJax_SVG_Display,[role=math],img.ltx_Math';
export type MathPart = string | { tag: string; attrs: Record<string, string>; children: MathPart[]; };
export type Formula = { text: string; math?: MathPart; };
const tags = new Set('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd mlabelledtr semantics'.split(' '));
const attrs = new Set('display mathvariant mathsize stretchy symmetric fence separator form movablelimits largeop accent accentunder lspace rspace linethickness bevelled columnalign rowalign columnspan rowspan notation open close separators width height depth scriptlevel displaystyle'.split(' '));

function mathTree(node: Node, depth = 0): MathPart | undefined {
  if (node instanceof Text) return node.data;
  if (!(node instanceof Element) || depth > 64 || node.namespaceURI !== 'http://www.w3.org/1998/Math/MathML' ||
    !tags.has(node.localName)) return;
  const attributes: Record<string, string> = {};
  for (const { name, value } of node.attributes) {
    if (attrs.has(name) && /^[\p{L}\p{N} .,+%()|:;!\-]{1,100}$/u.test(value)) attributes[name] = value;
  }
  const children = [...node.childNodes].map(child => mathTree(child, depth + 1)).filter((child): child is MathPart => child !== undefined);
  return { tag: node.localName, attrs: attributes, children };
}

// MathJax SVG keeps semantic node names and Unicode glyphs alongside drawing paths.
function svgMath(node: Element, depth = 0): MathPart | undefined {
  const tag = node.getAttribute('data-mml-node');
  if (!tag || !tags.has(tag) || depth > 64) return;
  if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(tag)) {
    let value = '';
    for (const glyph of node.querySelectorAll('use,text,path[data-c]')) {
      if (glyph.localName === 'text') { value += glyph.textContent ?? ''; continue; }
      const code = glyph.getAttribute('data-c') || /-([\da-f]+)$/i.exec(
        glyph.getAttribute('href') || glyph.getAttribute('xlink:href') || '')?.[1];
      if (!code || !/^[\da-f]{1,6}$/i.test(code) || parseInt(code, 16) > 0x10ffff) return;
      value += String.fromCodePoint(parseInt(code, 16));
    }
    return value ? { tag, attrs: {}, children: [value] } : undefined;
  }
  const children: MathPart[] = [];
  for (const child of node.querySelectorAll('[data-mml-node]')) {
    if (child.parentElement?.closest('[data-mml-node]') !== node) continue;
    const part = svgMath(child, depth + 1);
    if (!part) return;
    children.push(part);
  }
  return { tag, attrs: {}, children };
}

export function readFormula(el: Element): Formula {
  const math = el.localName === 'math' ? el : el.querySelector('math');
  const svg = !math && el.querySelector('svg [data-mml-node="math"]');
  const frame = el.id.endsWith('-Frame') ? el : el.querySelector('[id$="-Frame"]');
  const script = frame && document.getElementById(frame.id.slice(0, -6));
  const tex = script?.matches('script[type^="math/tex"]') ? script.textContent : undefined;
  const text = math?.getAttribute('alttext') || math?.querySelector('annotation[encoding*="tex" i]')?.textContent ||
    tex || el.getAttribute('aria-label') || el.getAttribute('alt') || el.querySelector('svg title')?.textContent ||
    math?.textContent || el.textContent || '公式';
  return { text: text.trim() || '公式', math: math ? mathTree(math) : svg ? svgMath(svg) : undefined };
}

// Keep complete TeX delimiters together, including multiline display equations.
export const texExpression = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$])\$(?![\s$])(?:\\.|[^$\r\n])+?(?<!\s)\$(?![\d$]))/g;
