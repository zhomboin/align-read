import type { displayPage, PageContent } from './show-page';

type RenderedPage = Awaited<ReturnType<typeof displayPage>> & { model: PageContent };
type PageView = { controller: AbortController; result?: RenderedPage; failed?: boolean };

export class PdfContinuousView {
  private readonly sheets: HTMLElement[];
  private readonly visible = new Map<number, PageView>();
  private readonly resize: ResizeObserver;
  private frame = 0;
  page = 0;

  constructor(private viewport: HTMLElement, private stack: HTMLElement, total: number,
    private render: (page: number, signal: AbortSignal) => Promise<RenderedPage>,
    private selected: (page: number) => void, private updated: (page: number) => void) {
    const fragment = document.createDocumentFragment();
    this.sheets = Array.from({ length: total }, (_, index) => {
      const sheet = document.createElement('article');
      sheet.className = 'pdf-sheet';
      sheet.dataset.page = String(index + 1);
      sheet.setAttribute('aria-label', '第 ' + (index + 1) + ' 页');
      fragment.append(sheet);
      return sheet;
    });
    stack.replaceChildren(fragment);
    viewport.addEventListener('scroll', this.schedule, { passive: true });
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(viewport);
  }

  get current() { return this.visible.get(this.page); }

  hasMounted(page: number) {
    return this.visible.has(page);
  }

  goTo(value: number) {
    const page = Math.max(1, Math.min(this.sheets.length, Math.trunc(value) || 1));
    const failed = this.visible.get(page);
    if (failed?.failed) this.evict(page, failed);
    this.viewport.scrollTop = this.sheets[page - 1]!.offsetTop;
    this.select(page);
    this.updateWindow();
  }

  applyTranslations(lookup: (page: number, id: string) => string | undefined) {
    for (const [page, view] of this.visible) {
      for (const [id, update] of view.result?.rows ?? []) update(lookup(page, id));
    }
  }

  dispose() {
    this.resize.disconnect();
    this.viewport.removeEventListener('scroll', this.schedule);
    cancelAnimationFrame(this.frame);
    for (const view of this.visible.values()) view.controller.abort();
    this.visible.clear();
    this.stack.replaceChildren();
  }

  private readonly schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const offset = Math.min(100, this.viewport.clientHeight * .20);
      this.select(this.pageAt(this.viewport.scrollTop + offset));
      this.updateWindow();
    });
  };

  private pageAt(offset: number) {
    let first = 0, last = this.sheets.length;
    while (first + 1 < last) {
      const middle = Math.floor((first + last) / 2);
      if (this.sheets[middle]!.offsetTop <= offset) first = middle;
      else last = middle;
    }
    return first + 1;
  }

  private select(page: number) {
    if (this.page === page) return;
    this.sheets[this.page - 1]?.removeAttribute('aria-current');
    this.sheets[page - 1]!.setAttribute('aria-current', 'page');
    this.page = page;
    this.selected(page);
  }

  private updateWindow() {
    const { scrollTop, clientHeight } = this.viewport;
    // Keep the adjacent pages ready while bounding the number of live canvases.
    const first = Math.max(1, this.page - 4, Math.min(this.page - 1, this.pageAt(scrollTop - clientHeight * .3)));
    const last = Math.min(this.sheets.length, this.page + 4,
      Math.max(this.page + 1, this.pageAt(scrollTop + clientHeight * 1.3)));
    for (const [page, view] of this.visible) {
      if (page < first || page > last) this.evict(page, view);
    }
    this.mount(this.page);
    for (let page = first; page <= last; page++) this.mount(page);
  }

  private evict(number: number, view: PageView) {
    view.controller.abort();
    this.visible.delete(number);
    const sheet = this.sheets[number - 1]!;
    // Keep the page's last height so revisiting an earlier page doesn't move the scroll position.
    sheet.style.setProperty('--estimated-page-height', sheet.offsetHeight + 'px');
    sheet.classList.remove('pdf-sheet-ready');
    sheet.removeAttribute('aria-busy');
    sheet.replaceChildren();
  }

  private mount(number: number) {
    if (this.visible.has(number)) return;
    const sheet = this.sheets[number - 1]!;
    const view: PageView = { controller: new AbortController() };
    this.visible.set(number, view);
    sheet.setAttribute('aria-busy', 'true');
    void this.render(number, view.controller.signal).then(result => {
      if (view.controller.signal.aborted) return;
      view.result = result;
      const translated = document.createElement('div');
      translated.className = 'pdf-translation';
      translated.append(result.content);
      if (!translated.hasChildNodes()) translated.append(this.notice('本页没有可提取的文字。'));
      if (result.canvas) {
        const original = document.createElement('div');
        original.className = 'pdf-original';
        original.append(result.canvas);
        sheet.append(original);
      }
      sheet.append(translated);
      sheet.classList.add('pdf-sheet-ready');
      sheet.removeAttribute('aria-busy');
      this.updated(number);
      this.schedule();
    }, () => {
      if (view.controller.signal.aborted) return;
      view.failed = true;
      sheet.append(this.notice('无法读取第 ' + number + ' 页。'));
      sheet.removeAttribute('aria-busy');
      this.updated(number);
    });
  }

  private notice(text: string) {
    const notice = document.createElement('p');
    notice.className = 'pdf-page-notice';
    notice.textContent = text;
    return notice;
  }
}
