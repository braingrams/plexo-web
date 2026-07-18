"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  createdAt: string;
  updatedAt: string;
};

type CreatePayload = {
  template: TemplateSummary;
};

type Props = {
  initialTemplates: TemplateSummary[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function TemplatesClient({ initialTemplates }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[]>(initialTemplates);
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("EMAIL");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeLabel = useMemo(() => {
    return templateKind === "EMAIL" ? "Email Template" : "Landing Page";
  }, [templateKind]);

  async function handleCreateTemplate(): Promise<void> {
    if (!templateName.trim()) {
      setError("Template name is required.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: templateName,
          kind: templateKind,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to create template.");
      }

      const payload = (await response.json()) as CreatePayload;
      setTemplates((current) => [payload.template, ...current]);
      setModalOpen(false);
      setTemplateName("");
      setTemplateKind("EMAIL");
      router.push(`/dashboard/templates/${payload.template.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create template.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-transparent p-3 md:p-6">
      <section className="mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-[1400px] grid-cols-1 gap-4 rounded-3xl border border-sky-200/20 bg-[#051227]/70 p-2 shadow-[0_30px_120px_rgba(0,0,0,.45)] backdrop-blur md:grid-cols-[auto,1fr] md:p-4">
        <aside
          className={`relative overflow-hidden rounded-2xl border border-sky-200/20 bg-[#081a32]/85 transition-all duration-300 ${
            isRailCollapsed ? "w-full md:w-20" : "w-full md:w-72"
          }`}
        >
          <div className="flex items-center justify-between border-b border-sky-200/15 px-3 py-3">
            <div className={`${isRailCollapsed ? "hidden" : "block"}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">Workspace</p>
              <h2 className="font-[var(--font-heading)] text-base text-sky-50">Template Hub</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsRailCollapsed((prev) => !prev)}
              className="rounded-lg border border-sky-300/30 bg-sky-400/10 px-2 py-1 text-xs text-sky-100 transition hover:bg-sky-400/20"
            >
              {isRailCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>

          <div className="space-y-3 p-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-300 via-sky-300 to-teal-200 px-3 py-2 text-sm font-bold text-slate-900 transition hover:brightness-110"
            >
              {isRailCollapsed ? "+ New" : "Create New Template"}
            </button>

            <nav className="space-y-2">
              <button
                type="button"
                className="w-full rounded-xl border border-cyan-200/20 bg-cyan-400/10 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100"
              >
                Templates
              </button>
              <button
                type="button"
                className="w-full rounded-xl border border-sky-200/15 bg-sky-300/5 px-3 py-2 text-left text-xs uppercase tracking-[0.12em] text-sky-200/80"
              >
                Launch Queue (Soon)
              </button>
            </nav>
          </div>
        </aside>

        <div className="rounded-2xl border border-sky-200/20 bg-[#091a30]/70 p-4 md:p-6">
          <header className="mb-6 flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">Dashboard</p>
            <h1 className="font-[var(--font-heading)] text-2xl text-sky-50 md:text-3xl">Digital Canvas Templates</h1>
            <p className="text-sm text-sky-100/70">
              Manage, launch, and re-edit your visual canvases. Active type selector: {activeLabel}.
            </p>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <article
                key={template.id}
                className="rounded-2xl border border-sky-200/20 bg-[#07172c]/80 p-4 shadow-[0_14px_38px_rgba(0,0,0,.35)]"
              >
                <p className="mb-2 inline-flex rounded-full border border-sky-200/30 bg-sky-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-100">
                  {template.kind === "EMAIL" ? "Email Template" : "Landing Page"}
                </p>
                <h2 className="font-[var(--font-heading)] text-lg text-sky-50">{template.name}</h2>
                <p className="mt-1 text-xs text-sky-200/70">Last updated: {formatDate(template.updatedAt)}</p>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/templates/${template.id}`)}
                  className="mt-4 rounded-xl border border-cyan-200/40 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-300/20"
                >
                  Open Workspace
                </button>
              </article>
            ))}
          </div>

          {templates.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-dashed border-sky-200/20 bg-[#061326]/50 p-6 text-sm text-sky-200/70">
              No templates yet. Create your first canvas from the action rail.
            </p>
          ) : null}
        </div>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#01050c]/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-sky-200/25 bg-[#081a33] p-5 shadow-[0_20px_80px_rgba(0,0,0,.5)] md:p-6">
            <header className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300/80">Template Config</p>
              <h2 className="font-[var(--font-heading)] text-xl text-sky-50">Create New Template</h2>
            </header>

            <label className="auth-field mt-0">
              <span className="auth-label">Template Name</span>
              <input
                type="text"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                placeholder="Summer Campaign"
                className="auth-input"
              />
            </label>

            <div className="mt-4">
              <p className="auth-label mb-2">Template Type</p>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-sky-300/20 bg-[#051427] p-1">
                <button
                  type="button"
                  onClick={() => setTemplateKind("EMAIL")}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    templateKind === "EMAIL"
                      ? "bg-cyan-300 text-slate-900"
                      : "bg-transparent text-sky-100 hover:bg-sky-500/20"
                  }`}
                >
                  📧 Email Template
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateKind("LANDING_PAGE")}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                    templateKind === "LANDING_PAGE"
                      ? "bg-cyan-300 text-slate-900"
                      : "bg-transparent text-sky-100 hover:bg-sky-500/20"
                  }`}
                >
                  📄 Landing Page
                </button>
              </div>
            </div>

            {error ? <p className="auth-error">{error}</p> : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setError(null);
                }}
                className="rounded-xl border border-sky-200/20 px-3 py-2 text-xs font-semibold text-sky-100/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateTemplate}
                disabled={isCreating}
                className="rounded-xl bg-gradient-to-r from-cyan-300 to-teal-200 px-4 py-2 text-xs font-bold text-slate-900 transition hover:brightness-110 disabled:opacity-65"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
