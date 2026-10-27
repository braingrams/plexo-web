// How the classic (V1 / raw-HTML) page tools are retired in favour of the V2 page tools.
// They keep working for classic, email and raw-HTML pages for 90 days: their descriptions
// start with a plain notice, their results carry a `deprecation` field, and a write that
// targets a V2 page is refused with a message that names the tools to use instead.

export const DEPRECATION_WINDOW_DAYS = 90;

export const DEPRECATED_PREFIX =
  "[DEPRECATED — use page_create_from_template / page_edit / page_publish for landing pages and sites] ";

const RAW_NOTICE =
  "ADVANCED, NOT VISUAL — a raw-HTML page is not editable in Plexo's visual editor, so the owner can never tweak it themselves. Only use this when the owner explicitly asked for hand-written HTML; for any normal page or site use page_create_from_template instead. ";

/** Tool -> the V2 tool(s) that replace it. Email templates are NOT here: email stays on the classic editor. */
export const DEPRECATED_TOOLS: Readonly<Record<string, { replacement: string; raw?: boolean }>> = {
  create_landing_page: { replacement: "page_create_from_template" },
  publish_landing_page: { replacement: "page_create_from_template + page_publish" },
  update_template: { replacement: "page_describe + page_edit" },
  create_landing_page_subpage: { replacement: "page_create_from_template (with siteId)" },
  design_blog_layout: { replacement: "blog_layout_describe + blog_layout_edit" },
  get_blog_layout: { replacement: "blog_layout_describe" },
  create_raw_landing_page: { replacement: "page_create_from_template", raw: true },
  publish_raw_landing_page: { replacement: "page_create_from_template + page_publish", raw: true },
  update_raw_landing_page: { replacement: "page_describe + page_edit", raw: true },
};

export function isDeprecatedTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEPRECATED_TOOLS, name);
}

/** The tool definition with the deprecation notice at the front of its description. */
export function markDeprecated<T extends { name: string; description: string }>(tool: T): T {
  const info = DEPRECATED_TOOLS[tool.name];
  if (!info) return tool;
  return { ...tool, description: `${DEPRECATED_PREFIX}${info.raw ? RAW_NOTICE : ""}${tool.description}` };
}

/** The `deprecation` field added to a deprecated tool's successful result. */
export function deprecationNotice(name: string, extra?: string): { tool: string; replacement: string; removalAfterDays: number; message: string } | null {
  const info = DEPRECATED_TOOLS[name];
  if (!info) return null;
  return {
    tool: name,
    replacement: info.replacement,
    removalAfterDays: DEPRECATION_WINDOW_DAYS,
    message:
      `${name} still works for classic, email and raw-HTML pages but will be removed in ${DEPRECATION_WINDOW_DAYS} days. ` +
      `Use ${info.replacement} instead — pages built that way stay editable in Plexo's visual editor.${extra ? ` ${extra}` : ""}`,
  };
}

/** The plain-language refusal when a classic write tool is pointed at a V2 page. */
export function v2TargetMessage(toolName: string): string {
  const info = DEPRECATED_TOOLS[toolName];
  return (
    "This page uses Plexo's new visual editor, so this classic tool can't change it. " +
    "Use page_describe to see its sections, page_edit to change them, and page_publish to put the changes live" +
    (info ? ` (the replacement for ${toolName} is ${info.replacement}).` : ".")
  );
}
