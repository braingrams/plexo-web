// The one place that formats the copyable "embed your signup form" snippet — used both by
// Funnel Settings' "Embed your signup form" panel (what an admin copies) and
// funnelStarterDesign.ts (what a brand-new funnel is pre-seeded with) — so the two can never
// drift out of sync with each other or with public/lms-signup.js's own `querySelectorAll`
// selector and expected attribute name.
export function lmsSignupEmbedSnippet(templateId: string): string {
  return `<div data-plexo-lms-signup data-plexo-template-id="${templateId}" style="min-height:280px;"></div>`;
}
