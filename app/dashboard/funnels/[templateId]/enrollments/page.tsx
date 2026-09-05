import { LmsEnrollment, LmsPage } from "@/lib/db/contentEntities";
import { EnrollmentsClient } from "./EnrollmentsClient";

export default async function FunnelEnrollmentsPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const [{ data: enrollments }, { data: pages }] = await Promise.all([
    LmsEnrollment.query.byEnrolledAt({ templateId }).go({ pages: "all" }),
    LmsPage.query.byOrder({ templateId }).go({ pages: "all" }),
  ]);

  enrollments.sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""));

  return (
    <EnrollmentsClient
      templateId={templateId}
      pageCount={pages.length}
      initialEnrollments={enrollments.map((e) => ({
        email: e.email,
        name: e.name ?? null,
        status: e.status ?? "ACTIVE",
        paymentStatus: e.paymentStatus ?? "FREE",
        completedPageCount: e.completedPageCount ?? 0,
        enrolledAt: e.enrolledAt ?? new Date().toISOString(),
      }))}
    />
  );
}
