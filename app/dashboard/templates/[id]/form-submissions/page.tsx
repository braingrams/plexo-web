import { prisma } from "@/server/prisma";
import { requireSiteLayoutAccess } from "@/lib/siteLayout";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireSiteLayoutAccess(id, `/dashboard/templates/${id}/form-submissions`);

  const submissions = await prisma.formSubmission.findMany({
    where: { templateId: access.templateId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="mx-auto max-w-5xl p-6 text-slate-100">
      <h1 className="text-xl font-semibold">Form submissions — {access.templateName}</h1>
      <p className="mt-1 text-sm text-slate-400">
        Messages sent through any form on this site, newest first. Showing the last {submissions.length} of up to 200.
      </p>

      {submissions.length === 0 ? (
        <div className="mt-8 rounded border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-400">
          No submissions yet.
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {submissions.map((s) => (
            <div key={s.id} className="rounded border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wide text-indigo-300">{s.formName}</span>
                <span className="text-xs text-slate-500">{s.createdAt.toLocaleString()}</span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {Object.entries(s.fields as Record<string, string>).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-slate-500">{key}</dt>
                    <dd className="whitespace-pre-wrap break-words text-sm text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
