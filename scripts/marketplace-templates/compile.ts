import { IdGen, buildSection } from "./sectionBuilders";
import type { TemplateSpec } from "./types";

/** Turns one TemplateSpec into a full plexo-sdk TemplateJSON ({ body: { style, rows } }). */
export function compileSpecToDesignJson(spec: TemplateSpec, templateIndex: number): any {
  const id = new IdGen(`t${templateIndex}`);
  const rows = spec.sections.flatMap((section) => buildSection(id, section));
  const designJson = {
    body: {
      style: {
        backgroundColor: spec.pageStyle.backgroundColor,
        background: spec.pageStyle.backgroundColor,
        color: spec.pageStyle.color,
        fontFamily: spec.pageStyle.fontFamily || "Inter, sans-serif",
        htmlTitle: spec.pageStyle.htmlTitle,
      },
      rows,
    },
  };
  // Builders leave `backgroundColor: spec.bg` etc. as literal `undefined` on any section that
  // didn't set an optional color override — StyleRecordSchema (server/sanitizer.ts) rejects an
  // explicit `undefined` value (it must be string|number), even though the *key* being absent
  // entirely is fine. JSON.stringify drops undefined-valued keys, so a round-trip here strips
  // them everywhere in the tree without every section builder needing its own compact() call.
  return JSON.parse(JSON.stringify(designJson));
}
