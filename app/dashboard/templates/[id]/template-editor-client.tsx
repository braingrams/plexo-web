"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlexoBuilder, type PlexoBuilderRef, type TemplateJSON } from "@plexo/sdk";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";

type Props = {
  templateId: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  initialDesignJson: TemplateJSON;
  subscriptionPlan: string;
  useAi: boolean;
  aiModel: string;
  aiTier: AiTier;
};

export function TemplateEditorClient({
  templateId,
  templateName,
  templateKind,
  initialDesignJson,
  subscriptionPlan,
  useAi,
  aiModel,
  aiTier,
}: Props) {
  const router = useRouter();
  const builderRef = useRef<PlexoBuilderRef>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    if (!builderRef.current) {
      setSaveError("Builder is not ready yet.");
      return;
    }

    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);

    try {
      const mode = templateKind === "EMAIL" ? "email" : "landing_page";
      const exported = await builderRef.current.exportDesign(mode);

      const response = await fetch(`/api/templates/update/${templateId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          designJson: exported.json,
          compiledHtml: exported.html,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to save template.");
      }

      setSaveMessage("Design saved.");
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen w-full p-2 md:p-4">
      <section className="mx-auto w-full max-w-[1500px] rounded-3xl border border-sky-200/20 bg-[#051227]/75 p-3 shadow-[0_30px_120px_rgba(0,0,0,.45)] md:p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200/20 bg-[#081a32]/80 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300/80">Visual Workspace</p>
            <h1 className="font-[var(--font-heading)] text-xl text-sky-50">{templateName}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Subscription plan badge */}
            <span className="hidden rounded-lg border border-sky-300/30 bg-sky-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-300 sm:inline-flex">
              {subscriptionPlan}
            </span>
            <button
              type="button"
              onClick={() => router.push("/dashboard/templates")}
              className="rounded-xl border border-sky-200/20 px-3 py-2 text-xs font-semibold text-sky-100/85"
            >
              Back to Templates
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-xl bg-gradient-to-r from-cyan-300 to-teal-200 px-4 py-2 text-xs font-bold text-slate-900 transition hover:brightness-110 disabled:opacity-65"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </header>

        {saveError ? <p className="mb-2 text-xs text-rose-300">{saveError}</p> : null}
        {saveMessage ? <p className="mb-2 text-xs text-emerald-300">{saveMessage}</p> : null}

        <div className="overflow-hidden rounded-2xl border border-sky-200/20">
          <PlexoBuilder
            ref={builderRef}
            apiKey="workspace-internal"
            mode={templateKind === "EMAIL" ? "email" : "landing_page"}
            initialTemplate={initialDesignJson}
            backgroundColor="#0b1526"
            themeBgColor="#1fb6ff"
            themeFgColor="#082032"
            textColor="#ecfeff"
            showSaveButton={false}
            useAi={useAi}
            aiModel={aiModel}
            aiTier={aiTier}
            subscriptionPlan={subscriptionPlan}
          />
        </div>
      </section>
    </main>
  );
}
