import type { Article, Block } from '../extraction/document';

export function createArticleIdentity() {
  let nextId = 0;

  function reconcile(article: Article, previous?: Article) {
    const byFirstText = new Map<Text, Block>();
    for (const block of previous?.blocks ?? []) {
      const first = block.snapshots.keys().next().value;
      if (first) byFirstText.set(first, block);
    }

    for (const block of article.blocks) {
      const first = block.snapshots.keys().next().value;
      const candidate = first && byFirstText.get(first);
      if (first && candidate && sameBlock(block, candidate)) {
        block.id = candidate.id;
        byFirstText.delete(first);
      } else {
        block.id = 'b' + ++nextId;
      }
      for (const [index, piece] of block.pieces.entries()) piece.id = block.id + 'p' + index;
    }
  }

  return { reconcile };
}

function sameBlock(block: Block, previous: Block) {
  if (block.source !== previous.source || block.tag !== previous.tag ||
      block.snapshots.size !== previous.snapshots.size || block.pieces.length !== previous.pieces.length) return false;

  const previousSnapshots = previous.snapshots.entries();
  for (const [node, text] of block.snapshots) {
    const entry = previousSnapshots.next().value;
    if (!entry || entry[0] !== node || entry[1] !== text) return false;
  }

  return block.pieces.every((piece, index) => {
    const oldPiece = previous.pieces[index]!;
    return piece.text === oldPiece.text && piece.translate === oldPiece.translate &&
      piece.lineBreak === oldPiece.lineBreak;
  });
}
