import { DEFAULT_PDF_LOOK_AHEAD, errors, type PdfLookAhead, type ProviderId, type ReadingOptions } from '../shared/reader-messages';
import type { PdfTranslationItem } from './math-placeholders';
import { translatePage } from './translate';

type Progress = { values: Map<string, string>; complete: boolean };
export type PdfTranslationConfig = { provider: ProviderId; options: ReadingOptions; hostname: string };

export class PdfTranslationQueue {
  private page = 1;
  private offset = 0;
  private completed = 0;
  private config?: PdfTranslationConfig;
  private job?: { page: number; cancel: AbortController };
  private pages = new Map<number, Progress>();
  enabled = false;
  error?: string;
  failedPage?: number;

  constructor(private total: number, private read: (page: number) => Promise<PdfTranslationItem[]>,
    private update: () => void, private lookAhead: PdfLookAhead = DEFAULT_PDF_LOOK_AHEAD) { }

  get translatingPage() { return this.job?.page; }
  get completedPages() { return this.completed; }

  // 跳页或调整范围时从当前页重新排队；按原顺序推进时只访问后面的页。
  nextPendingPage() {
    if (this.completed === this.total) return;
    const length = this.lookAhead === 'all' ? this.total : Math.min(this.total - this.page + 1, this.lookAhead + 1);
    while (this.offset < length) {
      const page = (this.page - 1 + this.offset) % this.total + 1;
      if (!this.result(page)?.complete) return page;
      this.offset++;
    }
  }

  result(page: number) { return this.pages.get(page); }

  start(config: PdfTranslationConfig) {
    this.config = config;
    this.error = undefined;
    this.failedPage = undefined;
    this.enabled = true;
    this.advance();
  }

  select(page: number) {
    if (page !== this.page) this.offset = 0;
    this.page = page;
    // Keep the running request when the reader opens that page or already has its translation.
    const running = this.job;
    if (running && running.page !== page && (!this.result(page)?.complete ||
      (this.lookAhead !== 'all' && (running.page < page || running.page - page > this.lookAhead)))) this.cancelJob();
    this.advance();
  }

  setLookAhead(value: PdfLookAhead) {
    if (this.lookAhead === value) return;
    this.lookAhead = value;
    this.offset = 0;
    this.select(this.page);
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
    this.offset = 0;
    this.completed = 0;
    this.stop();
  }

  private cancelJob() {
    const running = this.job;
    this.job = undefined;
    running?.cancel.abort();
  }

  private advance() {
    if (this.enabled && !this.job && this.config) {
      const page = this.nextPendingPage();
      if (page !== undefined) {
        const job = { page, cancel: new AbortController() };
        this.job = job;
        void this.run(job, this.config);
      } else if (this.lookAhead === 'all') this.enabled = false;
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
    this.completed++;
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
