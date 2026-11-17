import type { CSSProperties } from 'react';

export type Surface = Pick<CSSProperties, 'backgroundColor' | 'color' | 'borderBlockStart' | 'borderBlockEnd' |
  'borderInlineStart' | 'borderInlineEnd' | 'borderRadius' | 'paddingBlockStart' | 'paddingBlockEnd' |
  'paddingInlineStart' | 'paddingInlineEnd'>;

const edges = ['BlockStart', 'BlockEnd', 'InlineStart', 'InlineEnd'] as const;

export function readSurface(style: CSSStyleDeclaration): Surface | undefined {
  const surface: Surface = {};
  // Computed opaque colors and bounded lengths do not copy images, stylesheets or positioning.
  if (/^rgb\(/.test(style.backgroundColor)) {
    surface.backgroundColor = style.backgroundColor;
    surface.color = style.color;
  }
  for (const edge of edges) {
    const width = pixels(style[`border${edge}Width`], 5);
    const line = style[`border${edge}Style`];
    if (width && /^(solid|dotted|dashed|double)$/.test(line)) {
      surface[`border${edge}`] = `${width}px ${line} ${style[`border${edge}Color`]}`;
    }
  }
  if (!Object.keys(surface).length) return undefined;
  for (const edge of edges) {
    const padding = pixels(style[`padding${edge}`], 24);
    if (padding) surface[`padding${edge}`] = padding;
  }
  const radius = pixels(style.borderTopLeftRadius, 24);
  if (radius) surface.borderRadius = radius;
  return surface;
}

export function readInlineAppearance(style: CSSStyleDeclaration, parent: CSSStyleDeclaration): CSSProperties {
  const surface = readSurface(style);
  const scale = Number.parseFloat(style.fontSize) / Number.parseFloat(parent.fontSize);
  return {
    ...surface,
    color: surface?.color ?? (style.color !== parent.color ? style.color : undefined),
    fontSize: Number.isFinite(scale) && scale !== 1 ? `${Math.max(.75, Math.min(1.25, scale))}em` : undefined,
  };
}

export function textWhiteSpace(style: CSSStyleDeclaration) {
  const mode = style.whiteSpace;
  if (mode === 'pre-line') return mode;
  if (/^(pre|pre-wrap|break-spaces)$/.test(mode)) return 'pre-wrap';
}

export function inlineEmphasis(element: HTMLElement) {
  if (element.tagName !== 'SPAN' || !element.parentElement ||
      !(element.hasAttribute('class') || element.hasAttribute('style'))) return [];
  const style = getComputedStyle(element);
  const parent = getComputedStyle(element.parentElement);
  const marks: Array<'strong' | 'em' | 'u' | 's' | 'sup' | 'sub'> = [];
  if (Number(style.fontWeight) >= 600 && Number(parent.fontWeight) < 600) marks.push('strong');
  if (style.fontStyle !== 'normal' && parent.fontStyle === 'normal') marks.push('em');
  if (style.textDecorationLine !== parent.textDecorationLine) {
    if (style.textDecorationLine.includes('underline')) marks.push('u');
    if (style.textDecorationLine.includes('line-through')) marks.push('s');
  }
  if (style.verticalAlign === 'super') marks.push('sup');
  if (style.verticalAlign === 'sub') marks.push('sub');
  return marks;
}

function pixels(value: string, maximum: number) {
  return /^\d+(?:\.\d+)?px$/.test(value) ? Math.min(Number.parseFloat(value), maximum) : 0;
}
