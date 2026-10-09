// Preview builds only: tags every JSX element in the project's own src/ with
// data-plexo-loc="src/pages/Index.tsx:12:5", so the editor's Select & Edit mode can map a
// clicked element back to the exact line that renders it.
//
// The attribute goes right after the element name, i.e. BEFORE any {...props} spread. For a
// component like <Button> whose implementation spreads props onto its DOM element, the usage
// site's location therefore wins over the component file's own — the line the owner actually
// wants to change.
import MagicString from "magic-string";

type ParseSync = (filename: string, code: string, opts: { lang: "tsx" | "jsx" | "ts" | "js" }) => { program: unknown; errors?: unknown[] };

// Elements that never render DOM of their own — the attribute would be dead weight (or,
// for a few, an unknown-prop warning).
const SKIP = /(^|\.)(Fragment|Provider|Consumer|StrictMode|Suspense|Profiler)$/;

export function sourceLocPlugin(root: string, parseSync: ParseSync) {
  const srcDir = `${root.replace(/\/+$/, "")}/src/`;
  return {
    name: "plexo:source-loc",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?")[0];
      if (!file.startsWith(srcDir) || !/\.(tsx|jsx)$/.test(file) || !code.includes("<")) return null;
      let ast;
      try {
        ast = parseSync(file, code, { lang: file.endsWith(".tsx") ? "tsx" : "jsx" });
      } catch {
        return null; // the real compile step reports the syntax error
      }
      if (ast.errors?.length) return null;
      const rel = file.slice(srcDir.length - "src/".length);
      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
      const position = (offset: number) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (lineStarts[mid] <= offset) lo = mid;
          else hi = mid - 1;
        }
        return `${lo + 1}:${offset - lineStarts[lo] + 1}`;
      };
      const s = new MagicString(code);
      let count = 0;
      const visit = (node: any): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const child of node) visit(child);
          return;
        }
        if (node.type === "JSXOpeningElement" && node.name) {
          const name = jsxName(node.name);
          const already = node.attributes?.some((a: any) => a?.type === "JSXAttribute" && a.name?.name === "data-plexo-loc");
          if (name && !SKIP.test(name) && !already) {
            s.appendLeft(node.name.end, ` data-plexo-loc="${rel}:${position(node.start)}"`);
            count++;
          }
        }
        for (const key in node) {
          if (key !== "parent" && key !== "type") visit(node[key]);
        }
      };
      visit(ast.program);
      if (!count) return null;
      return { code: s.toString(), map: s.generateMap({ hires: "boundary", source: file, includeContent: true }) };
    },
  };
}

function jsxName(n: any): string | null {
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXMemberExpression") {
    const obj = jsxName(n.object);
    return obj ? `${obj}.${n.property?.name}` : null;
  }
  if (n.type === "JSXNamespacedName") return null;
  return null;
}
