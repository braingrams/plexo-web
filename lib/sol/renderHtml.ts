import { sanitizeHtml } from "@/server/sanitizer";

import type { DocBlock, DocumentModel } from "./exportDocument";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOOL_ACTION_ICON: Record<"success" | "error" | "cancelled", string> = {
  success: "✓", // check mark
  error: "✗", // ballot x
  cancelled: "⦸", // circled backslash, reads as "blocked/cancelled"
};

function renderBlock(block: DocBlock): string {
  switch (block.kind) {
    case "heading": {
      const tag = `h${block.level}` as const;
      return `<${tag}>${escapeHtml(block.text)}</${tag}>`;
    }
    case "paragraph":
      return `<p>${escapeHtml(block.text)}</p>`;
    case "toolAction":
      return (
        `<div class="tool-action tool-action--${block.status}">` +
        `<span class="tool-action__icon">${TOOL_ACTION_ICON[block.status]}</span>` +
        `<span class="tool-action__label">${escapeHtml(block.label)}</span>` +
        `</div>`
      );
    case "codeBlock": {
      // No `<pre>`/`<code>` here on purpose — the shared sanitizeHtml() allowlist (see
      // server/sanitizer.ts / @charisol/plexo-sdk's sanitizeCompiledHtml) doesn't include
      // either tag, so they'd otherwise be stripped, and `white-space: pre-wrap` on a
      // plain <div>/<span> preserves the code's newlines/indentation just as well.
      const languageAttr = block.language ? ` data-language="${escapeHtml(block.language)}"` : "";
      return `<div class="code-block"${languageAttr}><span>${escapeHtml(block.code)}</span></div>`;
    }
    case "imageRef":
      return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt ?? "")}">`;
  }
}

/**
 * Renders a DocumentModel to a clean, standalone HTML document (inline <style>, no
 * external stylesheet — this is a downloadable file, not an app page). Run through the
 * app's existing sanitizeHtml() before returning: tool-call args/results or user-pasted
 * conversation content could carry something unsafe, and this file is served straight
 * back to a browser as a real document.
 */
export function renderDocumentToHtml(doc: DocumentModel): string {
  const body = doc.blocks.map(renderBlock).join("\n");
  const generatedLabel = new Date(doc.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 720px;
    margin: 40px auto;
    padding: 0 24px 64px;
    color: #1a1a2e;
    background: #ffffff;
    line-height: 1.6;
  }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin-top: 32px; }
  h3 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7280;
    margin-top: 28px;
    margin-bottom: 8px;
  }
  p { margin: 8px 0; white-space: pre-wrap; }
  .code-block {
    background: #0f1117;
    color: #e5e7eb;
    padding: 14px 16px;
    border-radius: 8px;
    overflow-x: auto;
    font-family: "SFMono-Regular", Consolas, Menlo, monospace;
    font-size: 13px;
    white-space: pre-wrap;
    margin: 10px 0;
  }
  img { max-width: 100%; border-radius: 8px; margin: 12px 0; display: block; }
  .tool-action {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    background: #f3f4f6;
    border-left: 3px solid #9ca3af;
    padding: 8px 12px;
    border-radius: 6px;
    margin: 10px 0;
    font-size: 13.5px;
    color: #374151;
  }
  .tool-action--success { border-left-color: #16a34a; }
  .tool-action--error { border-left-color: #dc2626; }
  .tool-action--cancelled { border-left-color: #d97706; }
  .tool-action__icon { font-weight: 700; }
  .export-meta { color: #6b7280; font-size: 12.5px; margin-bottom: 24px; }
</style>
</head>
<body>
<div class="export-meta">Exported from SOL on ${escapeHtml(generatedLabel)}</div>
${body}
</body>
</html>`;

  return sanitizeHtml(html);
}
