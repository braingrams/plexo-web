// SOL writes Markdown; WhatsApp has its own lighter syntax (*bold*, _italic_, ~strike~, ```code```)
// and no headings, tables or link text. This turns one into the other and splits long replies.

const MAX_MESSAGE_CHARS = 3800; // WhatsApp's hard cap is 4096; leave room for the part counter

export function markdownToWhatsApp(markdown: string): string {
  const codeBlocks: string[] = [];
  let text = markdown.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    codeBlocks.push("```" + code.replace(/\n$/, "") + "```");
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  text = text
    // images and links: WhatsApp can't render link text, so show "text: url"
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) => (alt ? `${alt}: ${url}` : url))
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) => (label.trim() === url ? url : `${label}: ${url}`))
    // headings become bold lines
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, "**$1**")
    // horizontal rules
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "")
    // bullets
    .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ");

  // Bold first (parked behind a marker so the italic pass can't touch it), then italics, then restore.
  text = text.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_m, a: string, b: string) => `\u0001${a ?? b}\u0001`);
  text = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "_$1_");
  text = text.replace(/\u0001/g, "*");
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)]);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Splits on paragraph, then line, then space boundaries so no message is cut mid-word. */
export function splitForWhatsApp(text: string, max = MAX_MESSAGE_CHARS): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const parts: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.length > 1 ? parts.map((p, i) => `${p}\n\n(${i + 1}/${parts.length})`) : parts;
}
