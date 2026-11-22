import type { Session } from './reader-messages';

export const MAX_SELECTION_LENGTH = 1000;
export type SelectionKind = 'selection' | 'paragraph';

export type SelectionSession = Pick<Session, 'id' | 'source' | 'target'> & { shortcut?: string };

export type SelectionCommand =
  | { type: `${SelectionKind}:state` | `${SelectionKind}:stop` }
  | { type: 'paragraph:shortcut'; sessionId: string; shortcut: string }
  | { type: `${SelectionKind}:start`; session: SelectionSession };

export type SelectionRequest =
  | { type: `${SelectionKind}:translate`; sessionId: string; requestId: string; text: string }
  | { type: `${SelectionKind}:cancel`; sessionId: string; requestId: string }
  | { type: `${SelectionKind}:closed`; sessionId: string };
