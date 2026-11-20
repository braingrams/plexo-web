/**
 * A small, safe HTML tidier for the Code view's "Tidy up" button: puts one block element per line and indents what is
 * inside it. It never changes what the page shows: text is only re-spaced where browsers already collapse spaces, and
 * <pre>, <textarea>, <script>, <style> and comments are kept exactly as written.
 */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const INLINE = new Set(["a", "abbr", "b", "bdi", "bdo", "button", "cite", "code", "data", "del", "dfn", "em", "i", "img", "input", "ins", "kbd", "label", "mark", "q", "s", "samp", "select", "small", "span", "strong", "sub", "sup", "time", "u", "var", "br", "wbr", "svg", "path", "option"]);

const TOKEN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(script|style|pre|textarea)\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+|</gi;

export function formatHtml(src: string, indent = "  "): string {
  const lines: string[] = [];
  let cur = "";
  let depth = 0;
  const stack: { name: string; line: number; hasBlock: boolean }[] = [];
  const pad = () => indent.repeat(Math.max(0, depth));
  const flush = () => {
    const t = cur.trim();
    if (t) lines.push(pad() + t);
    cur = "";
  };
  const markBlock = () => {
    if (stack.length) stack[stack.length - 1].hasBlock = true;
  };

  for (const m of src.matchAll(TOKEN)) {
    const tok = m[0];
    if (tok.startsWith("<!--") || /^<!doctype/i.test(tok)) {
      flush();
      markBlock();
      lines.push(pad() + tok.trim());
    } else if (m[1]) {
      // script / style / pre / textarea: untouched, on their own line
      flush();
      markBlock();
      lines.push(/^<pre/i.test(tok) || /^<textarea/i.test(tok) ? pad() + tok : pad() + tok.trim());
    } else if (tok.startsWith("</")) {
      const name = /^<\/([^\s>]+)/.exec(tok)![1].toLowerCase();
      if (INLINE.has(name)) {
        cur += tok;
      } else {
        const open = stack.length && stack[stack.length - 1].name === name ? stack.pop() : null;
        const text = cur.trim();
        if (open && !open.hasBlock && lines.length === open.line + 1 && lines[open.line].length + text.length + tok.length < 110) {
          // <p>short text</p> stays on one line
          lines[open.line] += text + tok;
          cur = "";
          depth = Math.max(0, depth - 1);
        } else {
          flush();
          depth = Math.max(0, depth - 1);
          lines.push(pad() + tok);
        }
      }
    } else if (tok.startsWith("<") && tok.length > 1 && /^<[a-zA-Z]/.test(tok)) {
      const name = /^<([^\s/>]+)/.exec(tok)![1].toLowerCase();
      const selfClosing = /\/>$/.test(tok) || VOID.has(name);
      if (INLINE.has(name)) {
        cur += tok;
      } else {
        flush();
        markBlock();
        lines.push(pad() + tok);
        if (!selfClosing) {
          stack.push({ name, line: lines.length - 1, hasBlock: false });
          depth++;
        }
      }
    } else {
      // text (a lone "<" is text too)
      cur += tok.replace(/\s+/g, " ");
    }
  }
  flush();
  return lines.join("\n") + "\n";
}
