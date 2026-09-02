/**
 * Minimal renderer for the legal documents in docs/. Deliberately narrow: it
 * supports only the constructs those files use, so the published terms stay a
 * single source of truth without pulling in a markdown dependency.
 */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, href: string) => {
      const target = href.replace(/^\.\/terms-of-service\.md$/, "/legal/terms").replace(/^\.\/dispute-policy\.md$/, "/legal/dispute-policy");
      return `<a href="${target}">${text}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

export function renderMarkdown(source: string): string {
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    if (line.startsWith("- ")) { listItems.push(line.slice(2)); continue; }
    flushList();
    if (line === "---") { blocks.push("<hr />"); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    blocks.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  return blocks.join("\n");
}
