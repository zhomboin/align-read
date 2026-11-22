import { errors, type ProviderId, type ReadingOptions } from '../shared/reader-messages';
import type { PdfTranslationItem } from './math-placeholders';
import { translatePage } from './translate';

export const pdfLookAhead = 2;
type Progress = { values: Map<string, string>; complete: boolean };
export type PdfTranslationConfig = { provider: ProviderId; options: ReadingOptions; hostname: string };

export class PdfTranslationQueue {
  private page = 1;
  private config?: PdfTranslationConfig;
  private job?: { page: number; cancel: AbortController };
  private pages = new Map<number, Progress>();
  enabled = false;
  error?: string;
  failedPage?: number;

  constructor(private total: number, private read: (page: number) => Promise<PdfTranslationItem[]>,
    private update: () => void) { }

  get translatingPage() { return this.job?.page; }

  result(page: number) { return this.pages.get(page); }

  start(config: PdfTranslationConfig) {
    this.config = config;
    this.error = undefined;
    this.failedPage = undefined;
    this.enabled = true;
    this.advance();
  }

  select(page: number) {
    this.page = page;
    // Keep the running request when the reader opens that page or already has its translation.
    const running = this.job;
    if (running && (running.page < page || running.page > page + pdfLookAhead ||
      (running.page !== page && !this.result(page)?.complete))) this.cancelJob();
    this.advance();
  }

  stop() {
    this.enabled = false;
    this.cancelJob();
    this.update();
  }

  reset() {
    this.error = undefined;
    this.failedPage = undefined;
    this.pages.clear();
    this.stop();
  }

  private cancelJob() {
    const running = this.job;
    this.job = undefined;
    running?.cancel.abort();
  }

  private advance() {
    if (this.enabled && !this.job && this.config) {
      for (let page = this.page; page <= Math.min(this.page + pdfLookAhead, this.total); page++) {
        if (this.result(page)?.complete) continue;
        const job = { page, cancel: new AbortController() };
        this.job = job;
        void this.run(job, this.config);
        break;
      }
    }
    this.update();
  }

  async completePage(page: number, config: PdfTranslationConfig, signal: AbortSignal) {
    signal.throwIfAborted();
    let progress = this.pages.get(page);
    if (!progress) {
      progress = { values: new Map(), complete: false };
      this.pages.set(page, progress);
    }
    if (progress.complete) return progress.values;
    const items = await this.read(page);
    signal.throwIfAborted();
    const pending = items.filter(item => !progress.values.has(item.id));
    if (pending.length) {
      await translatePage(pending, config.provider, config.options, config.hostname, signal, values => {
        signal.throwIfAborted();
        for (const { id, text } of values) progress.values.set(id, text);
        this.update();
      });
    }
    signal.throwIfAborted();
    progress.complete = true;
    return progress.values;
  }

  private async run(job: { page: number; cancel: AbortController }, config: PdfTranslationConfig) {
    const { page, cancel: { signal } } = job;
    try {
      await this.completePage(page, config, signal);
    } catch (error) {
      if (!signal.aborted) {
        this.error = error instanceof Error ? error.message : errors.unavailable;
        this.failedPage = page;
        this.enabled = false;
      }
    } finally {
      if (this.job === job) {
        this.job = undefined;
        this.advance();
      }
    }
  }
}
