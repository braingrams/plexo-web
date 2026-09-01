import { prisma } from "@/server/prisma";

/**
 * Resolves the public URL a Commerce site is actually reachable at — for links inside a
 * customer-facing email (digital delivery, order confirmation) that should read as the
 * seller's own domain, not Plexo's. Prefers an active CUSTOM domain, falls back to the
 * shared plexopages SUBDOMAIN, and finally to Plexo's own app URL so a site with no
 * published domain at all (still mid-setup) doesn't produce a broken link.
 */
export async function resolveSitePublicUrl(templateId: string): Promise<string> {
  const domains = await prisma.publishedDomain.findMany({
    where: { templateId, active: true },
    select: { domain: true, type: true },
  });
  const custom = domains.find((d) => d.type === "CUSTOM");
  const subdomain = domains.find((d) => d.type === "SUBDOMAIN");
  const chosen = custom ?? subdomain;
  if (chosen) return `https://${chosen.domain}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
