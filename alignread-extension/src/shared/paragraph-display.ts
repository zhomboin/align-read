import type { ReadingOptions } from './reader-messages';

// 两个按需注入的脚本共用扩展的隔离环境。网页无法提供或读取这里的译文。
type ParagraphDisplay = {
  fullPage?: boolean;
  takeSelection?: (options: ReadingOptions, reuse: boolean) => Map<string, string>;
};

export function paragraphDisplay(): ParagraphDisplay {
  const content = window as Window & { __alignReadParagraphDisplay?: ParagraphDisplay };
  return content.__alignReadParagraphDisplay ??= {};
}
