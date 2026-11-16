// Skin tokens for the country UI: the new brand's variables when the page defines them,
// else the classic dark dashboard's. Lets one component look right in either dashboard.
export const T = {
  action: "var(--color-action-primary, var(--brand))",
  onAction: "var(--color-text-on-action, #ffffff)",
  surface: "var(--color-bg-surface, #12172a)",
  field: "var(--color-bg-field, rgba(255,255,255,0.04))",
  text: "var(--color-text-primary, #f0f2ff)",
  muted: "var(--color-text-secondary, rgba(240,242,255,0.62))",
  border: "var(--color-border-default, rgba(255,255,255,0.14))",
  focus: "var(--color-border-focus, var(--color-action-primary, var(--brand)))",
  hover: "var(--color-bg-hover, rgba(255,255,255,0.07))",
  danger: "var(--color-text-danger, #fca5a5)",
  radius: "var(--radius-md, 12px)",
  radiusLg: "var(--radius-lg, 20px)",
  font: "var(--font-body, inherit)",
  heading: "var(--font-heading, var(--font-body, inherit))",
} as const;
