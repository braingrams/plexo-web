// Every tool that makes or restyles something visual carries ONE sentence telling the model that a site's brand exists and is used
// by default. Pure, so a test can check the catalogue: every name here must be a real tool, and every tool gets the note exactly once.

export const BRAND_NOTE =
  " BRAND: a site may have a brand (a linked Strata project, or the colours and logo saved on the site). Read it with get_site_brand BEFORE you start and use it by default, without the owner having to mention it: never ask them for colours, fonts or a logo while one exists, and don't override it unless they ask for something different. If the brand has ready-made components (list_brand_components), use them before building your own buttons or cards. Write all copy in the brand's voice and use its tagline (get_site_brand returns them as `words` and `tagline`; get_brand_voice reads just those).";

/** Extra sentence for the tools that write an app's own code (hosted server apps). */
export const APP_CODE_BRAND_NOTE =
  " APP CODE: if the site has a linked brand, style the app with its CSS variables (var(--color-brand-primary-500), var(--color-text-primary), var(--color-bg-canvas), var(--font-family-heading), var(--font-family-body), var(--radius-md)) rather than fixed colours or fonts, and keep <link rel=\"stylesheet\" href=\"/__plexo/brand/<siteId>.css\"> in the shared layout or HTML shell (get_site_brand returns the address). Plexo also adds that link itself when the owner switches on \"Add my brand to my app\"; it is never added twice, and <meta name=\"plexo-brand\" content=\"off\"> opts a page out.";
export const APP_CODE_TOOLS: ReadonlySet<string> = new Set(["create_app", "app_write_files", "app_edit_file"]);

/** Tools that create or restyle pages, emails, blog/store/funnel/course pages or apps. */
export const BRAND_AWARE_TOOLS: ReadonlySet<string> = new Set([
  "site_create",
  "create_site_from_template",
  "page_create_from_template",
  "page_edit",
  "create_landing_page",
  "create_landing_page_subpage",
  "create_raw_landing_page",
  "update_raw_landing_page",
  "publish_landing_page",
  "publish_raw_landing_page",
  "update_template",
  "update_landing_page_page",
  "create_email_template",
  "design_blog_layout",
  "blog_layout_edit",
  "create_funnel_page",
  "update_funnel_page",
  "sell_product_on_page",
  "create_app",
  "app_design_edit",
  "app_write_files",
  "app_edit_file",
]);

export function withBrandNote<T extends { name: string; description?: string }>(tool: T): T {
  if (!BRAND_AWARE_TOOLS.has(tool.name) || !tool.description || tool.description.includes(BRAND_NOTE)) return tool;
  const extra = APP_CODE_TOOLS.has(tool.name) ? APP_CODE_BRAND_NOTE : "";
  return { ...tool, description: tool.description + BRAND_NOTE + extra };
}

/** The MCP server's own instructions (sent in `initialize`): how an external AI should treat the owner's brand. */
export const MCP_SERVER_INSTRUCTIONS = [
  "Plexo builds and runs websites, stores, blogs, courses, emails and apps for its owners.",
  "BRAND FIRST: a site can have a brand: a linked Strata project (Charisol's design-system tool: colours with roles, fonts, radius, logo) which stays in sync automatically, or the colours and logo saved on the site. Precedence: linked Strata project, then the site's own saved brand, then the account's onboarding brand.",
  "Before you create or change anything for a site (pages, sections, emails, blog and store layouts, funnel or course pages, apps) call get_site_brand and use what it returns by default, in the first version and on every later change, even when the user never mentions their brand. Never ask for colours, fonts or a logo while a brand exists; say once, plainly, \"I'll use your <brand name> brand\". A change published in Strata shows up in the next get_site_brand call, so read it again each time instead of remembering it.",
  "THE BRAND LIVES IN STRATA, and Plexo keeps a copy: the owner's design lives in their Strata project, and Plexo follows it. Use the brand's components and tokens first: call list_brand_components before you hand-build a button, card or similar and use the brand's own (an element with class plx-brand-<name>), saying once \"I'll use your brand's <name>\"; read the brand's variables with get_brand_tokens and use var(--token) in your styles. Save new reusable things back: when you build something reusable, offer to save it with create_brand_component, and change the brand's colours, fonts, corners or spacing with set_brand_tokens, only when the owner asked. Both go to Strata and the site follows.",
  "THE BRAND HAS WORDS TOO: a tagline, a short about line and a voice (tones, formality, audience, words to like and avoid). Call get_brand_voice before you write any copy for a site (pages, emails, blog posts, product text) and write in that voice without being asked; use the tagline as is. If none is set, offer once to set it: write the proposal yourself from what the owner told you and save it with set_brand_voice when they agree.",
  "site_create and the visual-editor tools already fall back to the site's brand when you pass no colours or fonts; pass your own only when the user asks for something different.",
  "For a brand-new site where the owner gave no colours: call list_strata_projects; if they have projects, offer them (then link_site_brand, or pass strataProjectId to site_create). If they have no brand in Strata but the site has one, create_strata_project_from_brand keeps it in Strata. If Strata isn't connected, don't push it: carry on with their own brand.",
  "Apps with their own code (create_app, app_write_files, app_edit_file): style them with the brand's CSS variables (var(--color-brand-primary-500), var(--font-family-body) ...) and keep <link rel=\"stylesheet\" href=\"/__plexo/brand/<siteId>.css\"> in the shared layout. get_site_brand gives the address.",
  "Pages made of code have Design, Code and Text views in the dashboard; block pages can be turned into code with convert_page_to_code (preview first) and back with restore_page_blocks. Converted pages COPY the site header and footer, so later edits to the site header or footer do not reach them: always tell the owner this before converting. Code pages have no draft: saves go live straight away.",
  "Talk to owners in plain words: say \"your brand\", \"your colours\", \"your Strata brand\", never token names, ids or tool names.",
].join("\n");
