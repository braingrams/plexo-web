import { randomUUID } from "node:crypto";
import { CustomContentType } from "@/lib/db/customContentEntities";
import type { CustomContentField } from "@/lib/db/customContentEntities";
import { CONTENT_PRESETS, type ContentPresetId } from "./presets-meta";

export { CONTENT_PRESETS, type ContentPresetId };

export function isContentPresetId(v: unknown): v is ContentPresetId {
  return typeof v === "string" && v in CONTENT_PRESETS;
}

/** Creates the preset's content type for this site, or returns the existing one (idempotent). */
export async function ensureContentPreset(input: { templateId: string; organizationId: string; preset: ContentPresetId }) {
  const { templateId, organizationId, preset } = input;
  const def = CONTENT_PRESETS[preset];
  const { data: existing } = await CustomContentType.query.primary({ templateId }).go({ pages: "all" });
  const found = existing.find((ct) => ct.slug === def.slug);
  if (found) return { contentType: found, created: false };

  const id = randomUUID();
  const fields: CustomContentField[] = def.fields.map((f) => ({ id: randomUUID(), name: f.name, key: f.key, type: f.type, required: f.required === true }));
  await CustomContentType.create({ id, templateId, organizationId, name: def.name, slug: def.slug, fields }).go();
  const { data: contentType } = await CustomContentType.get({ templateId, id }).go();
  return { contentType: contentType!, created: true };
}
