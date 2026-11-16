import type { Session } from './reader-messages';

export const MAX_SELECTION_LENGTH = 1000;

export type SelectionSession = Pick<Session, 'id' | 'source' | 'target'>;

export type SelectionCommand =
  | { type: 'selection:state' | 'selection:stop' }
  | { type: 'selection:start'; session: SelectionSession };

export type SelectionRequest =
  | { type: 'selection:translate'; sessionId: string; requestId: string; text: string }
  | { type: 'selection:cancel'; sessionId: string; requestId: string }
  | { type: 'selection:closed'; sessionId: string };
