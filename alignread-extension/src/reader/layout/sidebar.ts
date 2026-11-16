const sidebarSelector = 'nav,aside,[role=navigation],[role=complementary],[role=doc-toc],#toc';
const chromeSelector = 'header,footer,[role=banner],[role=contentinfo]';

export type SidebarLayout = {
  row: HTMLElement;
  sidebar: HTMLElement;
  sidebarBranch: HTMLElement;
  content: HTMLElement;
  heading: HTMLElement;
  side: 'left' | 'right';
};

export function findSidebarLayout(body: HTMLElement): SidebarLayout | undefined {
  const headings = [...body.querySelectorAll<HTMLElement>('h1,main h2,[role=main] h2,article h2')].filter((element) =>
    !element.closest(sidebarSelector + ',footer,[role=contentinfo]') && element.getBoundingClientRect().width > 0);
  const heading = headings.find((element) => element.matches('main h1,[role=main] h1,article h1')) ??
    headings.find((element) => !element.closest(chromeSelector));
  if (!heading) return undefined;

  const range = new Range();
  range.selectNodeContents(heading);
  const title = range.getBoundingClientRect();
  const readingRegion = heading.closest('article,main,[role=main]') ?? heading.parentElement;
  const reading = readingRegion?.getBoundingClientRect() ?? title;
  let best: SidebarLayout | undefined;
  let bestScore = 0;

  for (const sidebar of body.querySelectorAll<HTMLElement>(sidebarSelector)) {
    if (!(sidebar instanceof HTMLElement) || sidebar.closest(chromeSelector) ||
        sidebar.contains(heading) || !sidebar.textContent?.trim() || getComputedStyle(sidebar).visibility !== 'visible') continue;
    const rect = sidebar.getBoundingClientRect();
    const height = Math.min(rect.bottom, reading.bottom) - Math.max(rect.top, reading.top);
    if (rect.width < 72 || rect.width > body.clientWidth * .48 || rect.height < 96 || height < 48) continue;
    const side = rect.right <= title.left + 6 ? 'left' : rect.left >= title.right - 6 ? 'right' : undefined;
    if (!side) continue;

    let sidebarBranch = sidebar;
    let row = sidebarBranch.parentElement;
    while (row && !row.contains(heading)) {
      sidebarBranch = row;
      row = row.parentElement;
    }
    if (!row || !body.contains(row)) continue;
    const content = [...row.children].find((element): element is HTMLElement =>
      element instanceof HTMLElement && element.contains(heading));
    if (!content || content === heading || content.contains(sidebar) || content === sidebarBranch) continue;

    const score = rect.width * height;
    if (score <= bestScore) continue;
    bestScore = score;
    best = { row, sidebar, sidebarBranch, content, heading, side };
  }
  return best;
}
