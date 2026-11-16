import type { BatchResult, ReadingOptions, Result, TranslationItem } from '../../shared/reader-messages';

export type TranslationBatch = ReadingOptions & { id: string; items: TranslationItem[] };

export interface TranslationProvider<Credentials> {
  translateSegments(request: TranslationBatch, credentials: Credentials, signal: AbortSignal): Promise<Result<BatchResult>>;
}
