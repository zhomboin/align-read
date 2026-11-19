import type { Settings } from '../settings/settings';
import { failure, type ProviderId } from '../../shared/reader-messages';
import { ai } from './ai';
import { google } from './google';
import { youdao } from './youdao';
import type { TranslationBatch } from './provider';

export function translateWithProvider(provider: ProviderId, settings: Settings, request: TranslationBatch, signal: AbortSignal) {
  switch (provider) {
    case 'google': return settings.key ? google.translateSegments(request, settings.key, signal) : failure('not-configured');
    case 'youdao': return settings.youdao ? youdao.translateSegments(request, settings.youdao, signal) : failure('not-configured');
    default: {
      const service = settings.aiServices[provider];
      return service ? ai.translateSegments(request, { ...service, provider }, signal) : failure('not-configured');
    }
  }
}
