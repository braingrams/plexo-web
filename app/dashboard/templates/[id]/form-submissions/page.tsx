import Link from "next/link";

import { prisma } from "@/server/prisma";
import { requireSiteLayoutAccess } from "@/lib/siteLayout";
import { PageContainer } from "../../../_components/PageContainer";
import { Card } from "../../../_components/Card";

function IconArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function IconInbox() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forms have no fixed schema — every field a site owner adds becomes its own key in
 * `fields`. Finding "the" email/name to act on means scanning for a key that looks like
 * one (case-insensitive "email"/"name") whose value is actually shaped like that, rather
 * than assuming a fixed field name every form happens to use. */
function findFieldByKeyword(fields: [string, string][], keyword: string): string | null {
  const match = fields.find(([key]) => key.toLowerCase().includes(keyword));
  return match ? match[1] : null;
}

function findSubmissionEmail(fields: [string, string][]): string | null {
  const byKey = findFieldByKeyword(fields, "email");
  if (byKey && EMAIL_PATTERN.test(byKey.trim())) return byKey.trim();
  // Fall back to scanning every value — some forms label the field something else
  // entirely ("Your contact", "Reach me at").
  const byShape = fields.find(([, value]) => EMAIL_PATTERN.test(value.trim()));
  return byShape ? byShape[1].trim() : null;
}

function buildMailtoHref(email: string, formName: string, senderName: string | null): string {
  const subject = `Re: your ${formName} submission`;
  const body = senderName ? `Hi ${senderName},\n\n` : "";
  // The address itself is left unencoded (standard mailto: practice — encoding "@" as
  // %40 trips up some mail clients' address parsing); only the query params are encoded.
  return `mailto:${email}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/form-submissions`);

  const submissions = await prisma.formSubmission.findMany({
    where: { templateId: access.templateId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <PageContainer>
      <Link href={`/dashboard/templates/${id}/detail`} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.5)", textDecoration: "none", marginBottom: "1.5rem" }}>
        <IconArrowLeft /> {access.templateName}
      </Link>

      <div style={{ marginBottom: "2rem" }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: "0.35rem" }}>
          {access.templateName}
        </p>
        <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.02em" }}>
          Form Submissions
        </h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.45)", marginTop: "0.4rem" }}>
          Messages sent through any form on this site, newest first — showing the last {submissions.length} of up to 200.
        </p>
      </div>

      {submissions.length === 0 ? (
        <Card style={{ padding: "3.5rem 2rem", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 14, background: "rgba(255,255,255,0.04)", color: "rgba(240,242,255,0.3)", marginBottom: "1rem" }}>
            <IconInbox />
          </div>
          <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(240,242,255,0.7)" }}>No submissions yet</p>
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", marginTop: "0.3rem" }}>
            Messages sent through a form on this site will show up here.
          </p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {submissions.map((s) => {
            const fields = Object.entries(s.fields as Record<string, string>);
            const email = findSubmissionEmail(fields);
            const senderName = findFieldByKeyword(fields, "name");
            return (
              <Card key={s.id}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.1rem", paddingBottom: "1rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "0.3rem",
                        padding: "0.25rem 0.65rem", borderRadius: 999,
                        fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                        background: "rgba(129,140,248,0.1)", color: "#818cf8",
                      }}
                    >
                      {s.formName}
                    </span>
                    <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>{formatDateTime(s.createdAt)}</span>
                  </div>
                  {email && (
                    <a
                      href={buildMailtoHref(email, s.formName, senderName)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "0.4rem",
                        padding: "0.4rem 0.8rem", borderRadius: 8,
                        border: "1px solid rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.1)",
                        color: "var(--brand)", fontSize: "0.78rem", fontWeight: 700, textDecoration: "none",
                      }}
                    >
                      <IconMail /> Reply by email
                    </a>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem 1.5rem" }}>
                  {fields.map(([key, value]) => (
                    <div key={key}>
                      <div style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(240,242,255,0.35)", marginBottom: "0.3rem" }}>
                        {key}
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#f0f2ff", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
