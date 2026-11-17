// Made-up Strata data for the brand tests: a Strata-shaped design system (the same keys Strata's base preset uses).
import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";

const t = (key: string, value: string, type = "color", unit: string | null = null) => ({ key, name: key, value, type, unit, layer: "brand" as const, comment: null });

export const AMA_DS = {
  version: 1,
  name: "Ama's Kitchen",
  components: [],
  tokens: [
    t("--color-brand-primary-500", "#E4572E"),
    t("--color-brand-secondary-500", "#2B2D42"),
    t("--color-brand-accent-500", "#F4A261"),
    t("--color-neutral-900", "#1B1B1F"),
    t("--color-neutral-50", "#FFF8F0"),
    t("--color-neutral-0", "#FFFFFF"),
    t("--color-action-primary-bg", "var(--color-brand-primary-500)"),
    t("--color-text-primary", "var(--color-neutral-900)"),
    t("--color-bg-canvas", "var(--color-neutral-50)"),
    t("--color-bg-surface", "var(--color-neutral-0)"),
    t("--font-family-heading", "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif", "font family"),
    t("--font-family-body", "Inter, ui-sans-serif, system-ui, sans-serif", "font family"),
    t("--radius-md", "12", "dimension", "px"),
  ],
} as unknown as DesignSystem;

export const LINKED_AMA = { projectId: "proj-ama", projectName: "Ama's Kitchen brand", syncOn: true, status: "active" as const, designSystem: AMA_DS, logoUrl: "https://cdn.example.com/ama-logo.svg", stylesheet: "/__plexo/brand/site-1.css" };
