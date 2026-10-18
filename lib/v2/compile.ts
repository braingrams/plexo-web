import {
  compilePageToHtml,
  prepareCustomJs,
  sanitizeV2Html,
  type DocumentNode,
  type PageDefinition,
} from "@charisol/plexo-sdk/v2/compile";

import { escapeHtmlAttr, insertBeforeBodyEnd } from "@/lib/pub/htmlInject";
import { MAX_V2_HTML_CHARS, V2DesignError, requireV2Design, type V2Design, type V2Meta } from "@/lib/v2/design";
import { formDisplayName } from "@/lib/v2/forms";

/** Header/footer sections of a site's shared layout, ready to sit around a page's own sections. */
export type V2LayoutSections = { headerSections: DocumentNode[]; footerSections: DocumentNode[] };

export type CompileV2Context = {
  /** The site's ROOT template id — Plexo's form endpoint resolves the site from it (the page's own domain must match). */
  rootTemplateId: string;
  /** This row's own id — lets the form endpoint find the form again to label its fields. */
  pageTemplateId: string;
  /** The row's name; the browser-tab title unless the design has its own. */
  name: string;
  layout?: V2LayoutSections | null;
};

function eachNode(node: DocumentNode, visit: (n: DocumentNode) => void): void {
  visit(node);
  for (const c of node.children ?? []) eachNode(c, visit);
}

function allIds(nodes: DocumentNode[]): Set<string> {
  const ids = new Set<string>();
  for (const n of nodes) eachNode(n, (x) => ids.add(x.id));
  return ids;
}

/** Copy of a section subtree with every id prefixed (keeps the "<section>__<slot>" structure intact). */
function prefixIds(node: DocumentNode, prefix: string): DocumentNode {
  return { ...node, id: `${prefix}${node.id}`, ...(node.children ? { children: node.children.map((c) => prefixIds(c, prefix)) } : {}) };
}

/**
 * Pure. Puts the layout's header sections before the page's own and its footer sections
 * after them (the V2 twin of V1's spliceLayoutRows). The page JSON that is STORED never
 * contains them — only the compiled output does — so the header/footer stay editable in
 * exactly one place. A layout section whose id collides with one of the page's own
 * (e.g. both started from the same SDK page template) gets its ids prefixed instead.
 */
export function spliceLayoutSections(design: V2Design, layout: V2LayoutSections | null | undefined): V2Design {
  if (!layout || (layout.headerSections.length === 0 && layout.footerSections.length === 0)) return design;
  const page = design.pages[0];
  const own = page.rootNode.children ?? [];
  const taken = allIds(own);
  const place = (sections: DocumentNode[], prefix: string): DocumentNode[] =>
    sections.map((s) => {
      const clash = [...allIds([s])].some((id) => taken.has(id));
      const placed = clash ? prefixIds(s, prefix) : s;
      for (const id of allIds([placed])) taken.add(id);
      return placed;
    });
  const header = place(layout.headerSections, "hdr-");
  const footer = place(layout.footerSections, "ftr-");
  const spliced: PageDefinition = { ...page, rootNode: { ...page.rootNode, children: [...header, ...own, ...footer] } };
  return { ...design, pages: [spliced, ...design.pages.slice(1)] };
}

/** <title> aside, what a visitor's browser tab / search result / share card shows for this page. */
export function injectV2Head(html: string, meta: V2Meta | undefined): string {
  if (!meta) return html;
  const tags: string[] = [];
  if (meta.metaDescription) tags.push(`<meta name="description" content="${escapeHtmlAttr(meta.metaDescription)}">`);
  if (meta.htmlTitle) tags.push(`<meta property="og:title" content="${escapeHtmlAttr(meta.htmlTitle)}">`);
  if (meta.metaDescription) tags.push(`<meta property="og:description" content="${escapeHtmlAttr(meta.metaDescription)}">`);
  if (meta.ogImageUrl) tags.push(`<meta property="og:image" content="${escapeHtmlAttr(meta.ogImageUrl)}">`);
  if (meta.favicon) tags.push(`<link rel="icon" href="${escapeHtmlAttr(meta.favicon)}">`);
  if (tags.length === 0) return html;
  const at = html.search(/<\/head\s*>/i);
  return at === -1 ? html : html.slice(0, at) + tags.join("") + html.slice(at);
}

function formsOf(page: PageDefinition): Map<string, string> {
  const forms = new Map<string, string>();
  eachNode(page.rootNode, (n) => {
    if (n.type === "form") forms.set(n.id, formDisplayName(n));
  });
  return forms;
}

/**
 * The address a form posts to — Plexo's own inbox (V2's "workspace-internal" destination),
 * named after the form. A form on this row's own page also carries `page` + `fid` so the
 * endpoint can find it again and label its fields; one from the shared header/footer can't
 * be traced to this row, so it is named only.
 */
function formActionFor(ctx: CompileV2Context, names: Map<string, string>, own: Map<string, string>): (formId: string) => string | undefined {
  return (formId) => {
    const base = `/api/public/forms/${encodeURIComponent(ctx.rootTemplateId)}/submit?form=${encodeURIComponent(names.get(formId) ?? "Website Form")}`;
    return own.has(formId) ? `${base}&page=${encodeURIComponent(ctx.pageTemplateId)}&fid=${encodeURIComponent(formId)}` : base;
  };
}

/**
 * V2 design JSON -> the complete, sanitised HTML document stored as Template.compiledHtml
 * (what /pub serves). Throws V2DesignError (plain-language message) for a design that can't
 * be compiled. Never goes through V1's sanitizeCompiledHtml.
 *
 * Order matters: compile -> sanitizeV2Html -> only THEN add the owner's own script and
 * head details, because the sanitiser (rightly) strips every script it didn't print itself.
 */
export function compileV2Design(rawDesign: unknown, ctx: CompileV2Context): string {
  const base = requireV2Design(rawDesign);
  const own = formsOf(base.pages[0]);
  const design = spliceLayoutSections(base, ctx.layout);
  const page = design.pages[0];

  let compiled;
  try {
    compiled = compilePageToHtml(page, {
      apiKey: "workspace-internal",
      templateId: ctx.rootTemplateId,
      designSystem: design.designSystem,
      title: design.meta?.htmlTitle || ctx.name,
      formAction: formActionFor(ctx, formsOf(page), own),
    });
  } catch (err) {
    throw new V2DesignError(`This page couldn't be built: ${err instanceof Error ? err.message : "something in its design isn't valid"}.`);
  }

  let html = sanitizeV2Html(compiled.document);
  html = injectV2Head(html, design.meta);

  const custom = prepareCustomJs(design.customJs);
  if (custom.warning) throw new V2DesignError(custom.warning);
  if (custom.code) html = insertBeforeBodyEnd(html, `<script>\n${custom.code}\n</script>\n`);

  if (html.length > MAX_V2_HTML_CHARS) {
    throw new V2DesignError("This page is too large to publish. Remove some content, or use pictures from your media library instead of embedding them.");
  }
  return html;
}
