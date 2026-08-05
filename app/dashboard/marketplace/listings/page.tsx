import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { Card } from "@/app/dashboard/_components/Card";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING_REVIEW: { label: "Pending review", color: "#f59e0b" },
  PUBLISHED: { label: "Published", color: "#34d399" },
  REJECTED: { label: "Rejected", color: "#f87171" },
  DRAFT: { label: "Draft", color: "rgba(240,242,255,0.5)" },
};

export default async function MyListingsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/marketplace/listings");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const listings = await prisma.template.findMany({
    where: { organizationId: orgResolution.organizationId, marketplaceStatus: { not: null } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      marketplaceStatus: true,
      marketplaceRejectionReason: true,
      priceCents: true,
      _count: { select: { purchases: true } },
    },
  });

  return (
    <div style={{ padding: "2rem 8px", maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        eyebrow="Marketplace"
        title="My listings"
        subtitle="Templates you've submitted for sale."
        action={
          <Link
            href="/dashboard/marketplace/sell"
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem",
              borderRadius: 9, fontWeight: 700, fontSize: "0.82rem",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff", textDecoration: "none",
            }}
          >
            Sell a template
          </Link>
        }
      />

      {listings.length === 0 ? (
        <Card>
          <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.6)" }}>
            You haven&apos;t listed any templates for sale yet.
          </p>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {listings.map((listing) => {
            const status = STATUS_LABEL[listing.marketplaceStatus ?? "DRAFT"];
            return (
              <Card key={listing.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>{listing.name}</p>
                  <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", margin: "0.25rem 0 0" }}>
                    {listing.kind === "EMAIL" ? "Email" : "Landing Page"} ·{" "}
                    {listing.priceCents ? `$${(listing.priceCents / 100).toFixed(2)}` : "Free"} ·{" "}
                    {listing._count.purchases} sale{listing._count.purchases === 1 ? "" : "s"}
                  </p>
                  {listing.marketplaceStatus === "REJECTED" && listing.marketplaceRejectionReason && (
                    <p style={{ fontSize: "0.78rem", color: "#f87171", margin: "0.5rem 0 0" }}>
                      Rejected: {listing.marketplaceRejectionReason}
                    </p>
                  )}
                </div>
                <span style={{
                  flexShrink: 0, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", padding: "0.3rem 0.65rem", borderRadius: 999,
                  background: "rgba(255,255,255,0.05)", color: status.color,
                }}>
                  {status.label}
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
