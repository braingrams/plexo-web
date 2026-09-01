// Extracted out of app/api/v1/domains/route.ts (which is Prisma-backed and being cut
// over) into its own pure, dependency-free file — these two functions have nothing to do
// with the data layer, and every already-ported call site needs them without pulling in
// the rest of that route's Prisma imports.
//
// This is also the single file that gets replaced once custom-domain publishing moves to
// CloudFront SaaS Manager (see DYNAMODB_CUTOVER_CHECKLIST.md's Content section) — Vercel
// stays the actual domain registrar for published sites until that migration happens, so
// these calls are still live and load-bearing, not vestigial.

export async function addVercelDomain(domain: string): Promise<void> {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    console.warn("Vercel configurations missing. Skipping Vercel Domain registration in local development.");
    return;
  }

  const url = `https://api.vercel.com/v10/projects/${projectId}/domains${teamId ? `?teamId=${teamId}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: domain }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("Failed to add domain to Vercel project:", data.error);
    throw new Error(data.error?.message ?? "Failed to configure custom domain routing on the server.");
  }
}

export async function removeVercelDomain(domain: string): Promise<void> {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return;
  }

  const url = `https://api.vercel.com/v9/projects/${projectId}/domains/${domain}${teamId ? `?teamId=${teamId}` : ""}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.error("Failed to remove domain from Vercel project:", data.error);
  }
}
