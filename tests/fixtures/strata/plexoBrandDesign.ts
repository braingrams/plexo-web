// Plexo's own brand project in Strata (a public snapshot, see plexoBrandSnapshot.json): two published test components, a button and a card.
// Turns the snapshot into the design system Plexo stores for a linked site (components as flat rows: name, variant, props, nodes).
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import snapshot from "./plexoBrandSnapshot.json";

type Raw = { value: string; type?: string; unit?: string | null; comment?: string; layer?: string | null };

export const PLEXO_BRAND_DS = {
  version: 1,
  name: "Plexo",
  tokens: Object.entries(snapshot.variables as Record<string, Raw>).map(([key, v]) => ({ key, name: key.replace(/^--/, ""), value: v.value, type: v.type ?? "string", unit: v.unit ?? null, layer: "brand" as const, comment: v.comment ?? null })),
  components: Object.entries(snapshot.components as Record<string, { props: Record<string, unknown>; nodes: unknown[] }>).map(([name, c]) => ({ name, variant: "default", props: c.props, nodes: c.nodes })),
} as unknown as DesignSystem;
