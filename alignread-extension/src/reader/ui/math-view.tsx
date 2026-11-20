import { createElement, type ReactNode } from 'react';
import type { Formula, MathPart } from '../extraction/formulas';

function renderMath(part: MathPart, key: number): ReactNode {
  if (typeof part === 'string') return part;
  return createElement(part.tag, { ...part.attrs, key }, ...part.children.map(renderMath));
}

export function MathView({ formula }: { formula: Formula; }) {
  return <span className="reading-math" translate="no">{formula.math ? renderMath(formula.math, 0) : formula.text}</span>;
}
