// PR-preview environments (see .github/workflows/pr-deploy-aws.yml) are always reachable
// at exactly this shape — a fixed Route53 zone/cert dedicated to them, never a real
// customer domain. Shared between middleware.ts (deciding whether a preview's own hostname
// should route to the dashboard app instead of tenant /pub content) and the login page
// (deciding whether to suppress the auto Google-sign-in redirect there — see its own
// comment). Deliberately narrower than `*.plexo.aws.charisol.io`: a published TEST tenant
// site inside a PR-preview environment lives at `<slug>.plexo.aws.charisol.io` and must
// keep routing to /pub, not the dashboard.
export function isPrPreviewHost(hostname: string): boolean {
  return /^pr-\d+\.plexo\.aws\.charisol\.io$/.test(hostname);
}
