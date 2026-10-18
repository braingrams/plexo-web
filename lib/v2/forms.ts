import type { DocumentNode } from "@charisol/plexo-sdk/v2/compile";

import { isV2Design } from "@/lib/v2/design";

// Finding forms inside a V2 design. A V2 form node (type "form", props.fields[]) compiles to
// <form> whose inputs are named after each FIELD'S ID (not its label) and which carries the
// honeypot input FORM_HONEYPOT_FIELD_NAME. The public submit route uses these helpers to
// turn "f3" back into "Phone number" so the owner's inbox reads like a form, not like ids.

/** Must match the SDK's FORM_HONEYPOT_FIELD_NAME (v2/render/elements.ts) and V1's. */
export const V2_FORM_HONEYPOT_FIELD_NAME = "_hp_field";

export type V2FormField = { id: string; label: string; type: string };
export type V2FormInfo = { nodeId: string; name: string; fields: V2FormField[] };

function walk(node: DocumentNode | undefined, visit: (n: DocumentNode) => void): void {
  if (!node) return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Every form on the design's page(s); empty for anything that isn't a V2 design. */
export function listV2Forms(designJson: unknown): V2FormInfo[] {
  if (!isV2Design(designJson)) return [];
  const forms: V2FormInfo[] = [];
  for (const page of designJson.pages) {
    walk(page?.rootNode, (n) => {
      if (n.type !== "form") return;
      const rawFields = (n.props as { fields?: unknown } | undefined)?.fields;
      const fields: V2FormField[] = (Array.isArray(rawFields) ? rawFields : [])
        .map((f) => f as { id?: unknown; label?: unknown; type?: unknown })
        .filter((f) => typeof f?.id === "string" && f.id)
        .map((f) => ({
          id: String(f.id),
          label: (typeof f.label === "string" && f.label.trim()) || String(f.id),
          type: typeof f.type === "string" ? f.type : "text",
        }));
      forms.push({ nodeId: n.id, name: formDisplayName(n), fields });
    });
  }
  return forms;
}

export function findV2Form(designJson: unknown, nodeId: string): V2FormInfo | null {
  return listV2Forms(designJson).find((f) => f.nodeId === nodeId) ?? null;
}

/** What the form is called in the owner's inbox and Form Submissions page. */
export function formDisplayName(node: Pick<DocumentNode, "name">): string {
  const name = (node.name ?? "").trim();
  return !name || /^form$/i.test(name) ? "Website Form" : name.slice(0, 100);
}

/**
 * Renames submitted field ids to their labels (visitors never see ids). Unknown keys are
 * kept as they are; two fields with the same label stay apart ("Name", "Name (2)").
 */
export function relabelV2Fields(fields: Record<string, string>, form: V2FormInfo): Record<string, string> {
  const labels = new Map(form.fields.map((f) => [f.id, f.label]));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    let label = labels.get(key) ?? key;
    for (let n = 2; label in out; n++) label = `${labels.get(key) ?? key} (${n})`;
    out[label] = value;
  }
  return out;
}
