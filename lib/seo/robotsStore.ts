import { randomUUID } from "node:crypto";
import { SiteLayout } from "@/lib/db/contentEntities";
import { checkRobotsText, parseRobotsConfig, type RobotsConfig } from "./robots";

/** The site's robots.txt choice (default when the owner never touched it). */
export async function readRobotsConfig(templateId: string): Promise<RobotsConfig> {
  const { data } = await SiteLayout.get({ templateId }).go();
  return parseRobotsConfig(data?.robotsConfig);
}

export type SaveRobotsResult = { ok: true; config: RobotsConfig; warnings: string[] } | { ok: false; error: string };

/** Validates and saves. A hand-written file is checked line by line; folders are cleaned; "default" clears the choice. */
export async function saveRobotsConfig(args: { organizationId: string; templateId: string; input: unknown }): Promise<SaveRobotsResult> {
  const config = parseRobotsConfig(args.input);
  let warnings: string[] = [];
  if (config.mode === "custom") {
    const c = checkRobotsText(config.custom);
    if (!c.ok) return { ok: false, error: c.problems[0] };
    config.custom = c.text;
    warnings = c.warnings;
  }
  if (config.mode === "folders" && config.folders.length === 0) return { ok: false, error: "Add at least one folder to keep out of search, or choose \"Open to everyone\"." };
  const robotsConfig = config.mode === "default" ? "" : JSON.stringify(config);
  const { data: existing } = await SiteLayout.get({ templateId: args.templateId }).go();
  if (existing) await SiteLayout.patch({ templateId: args.templateId }).set({ robotsConfig }).go();
  else await SiteLayout.create({ id: randomUUID(), templateId: args.templateId, organizationId: args.organizationId, robotsConfig }).go();
  return { ok: true, config, warnings };
}
