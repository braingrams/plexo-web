/**
 * Where a V2 design keeps its logo: the `logo` field of its header section (props.block = { kind: "header", content: { logo, ... } }).
 * A site made from the site kit keeps that header in the shared header fragment (SiteLayout); a site made from a marketplace design
 * keeps it as the first section of the page itself. Pure JSON (no SDK), so adding, replacing and removing a logo is one tested rule
 * for both, and it survives every recompile because it is in the design data, not only in the compiled HTML.
 */

type Node = { id?: string; props?: { block?: { kind?: string; content?: Record<string, unknown> } }; children?: Node[] };
type Design = { pages?: Array<{ rootNode?: Node }> };

/** The header section (a node with block kind "header") of a one-page design, or null. Looks through containers. */
export function findHeaderSection(design: unknown): { id: string; logo: string } | null {
  const root = (design as Design | null | undefined)?.pages?.[0]?.rootNode;
  const visit = (nodes: Node[] | undefined): { id: string; logo: string } | null => {
    for (const n of nodes ?? []) {
      const block = n.props?.block;
      if (block?.kind === "header" && typeof n.id === "string") return { id: n.id, logo: typeof block.content?.logo === "string" ? block.content.logo : "" };
      const inner = visit(n.children);
      if (inner) return inner;
    }
    return null;
  };
  return visit(root?.children);
}

/** The page_edit-style command that sets (or, with "", clears) the logo of the design's header; null when the design has no header section. */
export function logoCommandFor(design: unknown, logoUrl: string): { op: "updateSection"; sectionId: string; content: { logo: string } } | null {
  const header = findHeaderSection(design);
  return header ? { op: "updateSection", sectionId: header.id, content: { logo: logoUrl } } : null;
}

/** A copy of the design with the header's logo set to `logoUrl` ("" removes it). `placed` is false when there is no header to put it in. Never changes the input. */
export function withHeaderLogo<T>(design: T, logoUrl: string): { design: T; placed: boolean } {
  const header = findHeaderSection(design);
  if (!header) return { design, placed: false };
  const copy = JSON.parse(JSON.stringify(design)) as T;
  const visit = (nodes: Node[] | undefined): boolean => {
    for (const n of nodes ?? []) {
      if (n.id === header.id && n.props?.block) {
        const content = { ...(n.props.block.content ?? {}) };
        content.logo = logoUrl; // "" clears it, the same value the Brand page's command uses
        n.props.block.content = content;
        return true;
      }
      if (visit(n.children)) return true;
    }
    return false;
  };
  visit((copy as unknown as Design).pages?.[0]?.rootNode?.children);
  return { design: copy, placed: true };
}
