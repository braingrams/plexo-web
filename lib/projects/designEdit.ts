import { applyCommands, catalogSchema, describeDesign, type CommandResult, type DesignSystem, type PageDefinition } from "@charisol/plexo-sdk/v2/compile";
import { DesignConflictError, DesignError, getAllDesigns, saveDesign, slugForName, type DesignSummary } from "./designs";
import { defaultRoute, freeRoute } from "./designTemplates";

// SOL (and MCP clients) reading and editing designed pages section by section — the same
// commands the Design tab's own SOL uses (applyCommands in @charisol/plexo-sdk), saved through
// the editor's save path so the page's React code is regenerated and its route stays wired.

const MAX_COMMANDS = 40;

export async function describeDesigns(appId: string) {
  const { designs, pages, designSystem } = await getAllDesigns(appId);
  const summary = describeDesign(pages, designSystem);
  const bySlug = new Map(designs.map((d) => [d.slug, d]));
  return {
    pages: summary.pages.map((p) => {
      const d = bySlug.get(p.slug);
      return { slug: p.slug, name: p.name, route: d?.route ?? `/${p.slug}`, codeEdited: !!d?.codeEdited, sections: p.sections };
    }),
    brand: summary.brand,
    catalog: catalogSchema(),
    note: designs.length
      ? "Use app_design_edit with section commands to change these pages. Section ids are only valid for the page they're listed under."
      : "This app has no designed pages yet. app_design_edit with an addPage command (and a templateId from catalog.pageTemplates) creates one.",
  };
}

type EditInput = { slug?: unknown; commands?: unknown; overwrite?: unknown };

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function editDesign(appId: string, input: EditInput, updatedBy?: string) {
  const commands = Array.isArray(input.commands) ? input.commands : [];
  if (!commands.length) throw new DesignError("Give at least one change to make (commands). Call app_design_describe to see the pages, sections and what can be changed.");
  if (commands.length > MAX_COMMANDS) throw new DesignError(`Make at most ${MAX_COMMANDS} changes per call — split them into a few calls.`);

  const all = await getAllDesigns(appId);
  const slug = typeof input.slug === "string" && input.slug.trim() ? input.slug.trim() : undefined;
  const overwrite = input.overwrite === true;
  const bySlug = new Map(all.designs.map((d) => [d.slug, d]));
  if (slug && !bySlug.has(slug)) {
    throw new DesignError(`There's no designed page "${slug}". ${all.designs.length ? `The designed pages are: ${all.designs.map((d) => `${d.slug} (${d.name})`).join(", ")}.` : "This app has no designed pages yet — use an addPage command to create one."}`);
  }

  // Pages whose code was edited by hand are left alone unless the owner chose to replace those edits.
  const blocked = all.designs.filter((d) => d.codeEdited && !overwrite);
  const blockedMessage = (d: DesignSummary) => `"${d.name}" (${d.route}) was edited in code since it was last designed, so I haven't changed it — saving the design would replace those code changes. Ask the owner whether to replace them (then call again with overwrite: true) or keep the code and edit the file with app_edit_file.`;
  if (slug && blocked.some((d) => d.slug === slug)) {
    return { ok: false, saved: [], results: [] as CommandResult[], notes: [blockedMessage(bySlug.get(slug)!)], next: "Nothing was changed." };
  }
  const editable = all.pages.filter((p) => !blocked.some((d) => d.slug === p.id));

  // A command that leaves out the page means "the page we're editing".
  const prepared = commands.map((c) => (slug && c && typeof c === "object" && (c as { op?: unknown }).op === "addSection" && !(c as { pageId?: unknown }).pageId ? { ...c, pageId: slug } : c));
  const applied = applyCommands(editable, all.designSystem, prepared);

  const before = new Map(editable.map((p) => [p.id, p]));
  const brandChanged = !sameJson(applied.designSystem, all.designSystem);
  const changed = applied.pages.filter((p) => before.has(p.id) && (!sameJson(p.rootNode, before.get(p.id)!.rootNode) || p.name !== before.get(p.id)!.name));
  const added = applied.pages.filter((p) => !before.has(p.id));
  const templateOf = (name: string) => {
    const cmd = prepared.find((c) => c && typeof c === "object" && (c as { op?: unknown }).op === "addPage" && String((c as { name?: unknown }).name ?? "").trim().toLowerCase() === name.trim().toLowerCase()) as { templateId?: unknown } | undefined;
    return typeof cmd?.templateId === "string" ? cmd.templateId : "blank";
  };

  const notes: string[] = blocked.map(blockedMessage);
  const warnings: string[] = [];
  const saved: Array<{ slug: string; name: string; route: string }> = [];
  let pendingSystem: DesignSystem | undefined = brandChanged ? applied.designSystem : undefined;
  const take = () => {
    const ds = pendingSystem;
    pendingSystem = undefined;
    return ds;
  };
  const record = (r: Awaited<ReturnType<typeof saveDesign>>) => {
    saved.push({ slug: r.design.slug, name: r.design.name, route: r.design.route });
    warnings.push(...r.warnings);
    if (r.skipped.length) notes.push(`The new style wasn't applied to ${r.skipped.join(", ")} because ${r.skipped.length === 1 ? "that page was" : "those pages were"} edited in code.`);
  };
  const failed = (name: string, err: unknown) => {
    notes.push(err instanceof DesignConflictError || err instanceof DesignError ? `Couldn't save "${name}": ${err.message}` : `Couldn't save "${name}" — nothing was changed on that page. Try again.`);
  };

  // A style-only change still needs a page to ride along with (saving restyles every page).
  const carrier: PageDefinition | undefined = pendingSystem && !changed.length && !added.length ? applied.pages[0] : undefined;
  for (const page of [...changed, ...(carrier ? [carrier] : [])]) {
    const d = bySlug.get(page.id)!;
    try {
      record(await saveDesign(appId, page.id, { name: page.name, route: d.route, page, designSystem: take(), overwrite }, updatedBy));
    } catch (err) {
      failed(page.name, err);
    }
  }
  const slugs = new Set(all.designs.map((d) => d.slug));
  const routes = new Set(all.designs.map((d) => d.route));
  for (const page of added) {
    const newSlug = slugForName(page.name, slugs);
    const route = freeRoute(routes, defaultRoute(templateOf(page.name), page.name));
    try {
      const result = await saveDesign(appId, newSlug, { name: page.name, route, page, designSystem: take() }, updatedBy);
      slugs.add(newSlug);
      routes.add(route);
      record(result);
    } catch (err) {
      failed(page.name, err);
    }
  }
  if (pendingSystem && !saved.length) notes.push("The brand change couldn't be saved — try again.");
  if (brandChanged && !all.pages.length && !added.length) notes.push("This app has no designed pages yet, so there's nothing to restyle — add a page first.");

  const anyOk = applied.results.some((r) => r.ok);
  if (anyOk && !saved.length && !notes.length && !brandChanged) notes.push("Those changes didn't alter anything on the page.");
  return {
    ok: saved.length > 0,
    saved,
    results: applied.results,
    warnings,
    notes,
    next: saved.length ? "Saved. The page's code was regenerated — run app_build to update the preview, then check it with app_screenshot." : "Nothing was changed.",
  };
}
