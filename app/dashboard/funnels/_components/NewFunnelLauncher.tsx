"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Level = "BEGINNER" | "INTERMEDIATE" | "PROFESSIONAL";
type Step = "closed" | "chooseLevel" | "wizard" | "quickCreate";

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 200, display: "grid", placeItems: "center",
  background: "rgba(8,9,15,0.75)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", padding: "1.5rem",
};

const cardStyle: React.CSSProperties = {
  width: "100%", maxWidth: 560, background: "rgba(15,17,28,0.98)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 18, padding: "1.75rem", boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
};

const buttonPrimary: React.CSSProperties = {
  padding: "0.65rem 1.2rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700,
  background: "var(--brand, var(--brand))", color: "#fff", border: "none", cursor: "pointer",
};

const buttonGhost: React.CSSProperties = {
  padding: "0.6rem 1rem", borderRadius: 10, fontSize: "0.83rem", fontWeight: 600,
  background: "transparent", color: "rgba(240,242,255,0.6)", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.75rem", fontSize: "0.88rem", outline: "none", fontFamily: "inherit",
};

/** Launches "New Funnel". First-ever click picks an experience level (never asked again
 * unless changed in Settings) — see the Funnel/LMS plan's "Experience-level onboarding".
 * Beginner gets a real step-by-step wizard; Intermediate/Professional get a one-field
 * quick-create since they don't need the hand-holding. */
export function NewFunnelLauncher({ initialFunnelBuilderLevel }: { initialFunnelBuilderLevel: Level | null }) {
  const router = useRouter();
  const [level, setLevel] = useState<Level | null>(initialFunnelBuilderLevel);
  const [step, setStep] = useState<Step>("closed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; needsSlot?: boolean } | null>(null);

  function openLauncher() {
    setError(null);
    if (!level) {
      setStep("chooseLevel");
    } else if (level === "BEGINNER") {
      setStep("wizard");
    } else {
      setStep("quickCreate");
    }
  }

  async function chooseLevel(chosen: Level) {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelBuilderLevel: chosen }),
      });
      setLevel(chosen);
      setStep(chosen === "BEGINNER" ? "wizard" : "quickCreate");
    } finally {
      setBusy(false);
    }
  }

  async function createFunnel(opts: { name: string; enabled: boolean; firstPagePatch?: Record<string, unknown> }) {
    setBusy(true);
    setError(null);
    try {
      // Checked here, before creating anything — POST /api/v1/lms/funnels can only attach
      // Funnel capability to a Template that already exists, so checking slot availability
      // only *after* creating one would leave an orphaned, funnel-less Template behind the
      // moment the org is actually out of slots. This check is the common case's fast path,
      // not the sole guarantee — POST /api/v1/lms/funnels below still re-checks
      // authoritatively, so a genuine race (two tabs creating at once) is still caught, just
      // without avoiding the orphan in that rare case.
      const slotsRes = await fetch("/api/v1/lms/funnels");
      const slotsBody = await slotsRes.json().catch(() => ({}));
      if (slotsRes.ok && slotsBody.slots && !slotsBody.slots.hasSlotAvailable) {
        throw Object.assign(new Error("You've used every funnel slot your plan includes. Buy another slot to create more."), { needsSlot: true });
      }

      const templateRes = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: opts.name, kind: "LANDING_PAGE" }),
      });
      const templateBody = await templateRes.json().catch(() => ({}));
      if (!templateRes.ok) throw new Error(templateBody.error || "Could not create a site for this funnel.");
      const templateId = templateBody.template?.id as string;

      const funnelRes = await fetch("/api/v1/lms/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const funnelBody = await funnelRes.json().catch(() => ({}));
      if (!funnelRes.ok) {
        const needsSlot = funnelRes.status === 403 && Boolean(funnelBody.slots);
        throw Object.assign(new Error(funnelBody.error || "Could not turn this site into a funnel."), { needsSlot });
      }

      if (opts.firstPagePatch) {
        const pagesRes = await fetch(`/api/v1/lms/funnels/${templateId}/pages`);
        const pagesBody = await pagesRes.json().catch(() => ({}));
        const firstPageId = pagesBody.pages?.[0]?.id;
        if (firstPageId) {
          await fetch(`/api/v1/lms/funnels/${templateId}/pages/${firstPageId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(opts.firstPagePatch),
          });
        }
      }

      if (opts.enabled) {
        await fetch(`/api/v1/lms/funnels/${templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        });
      }

      router.push(`/dashboard/funnels/${templateId}`);
    } catch (err) {
      const needsSlot = err instanceof Error && "needsSlot" in err && Boolean((err as { needsSlot?: boolean }).needsSlot);
      setError({ message: err instanceof Error ? err.message : "Something went wrong.", needsSlot });
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openLauncher} style={{ ...buttonPrimary, marginTop: "0.5rem" }}>
        New Funnel
      </button>

      {step === "chooseLevel" && (
        <ExperienceLevelModal busy={busy} onChoose={chooseLevel} onClose={() => setStep("closed")} />
      )}
      {step === "wizard" && (
        <BeginnerWizardModal busy={busy} error={error} onCreate={createFunnel} onClose={() => setStep("closed")} />
      )}
      {step === "quickCreate" && (
        <QuickCreateModal busy={busy} error={error} onCreate={createFunnel} onClose={() => setStep("closed")} />
      )}
    </>
  );
}

function ExperienceLevelModal({
  busy, onChoose, onClose,
}: { busy: boolean; onChoose: (level: Level) => void; onClose: () => void }) {
  const options: { level: Level; title: string; description: string }[] = [
    { level: "BEGINNER", title: "New to building funnels", description: "A guided, step-by-step setup that explains each choice as you go." },
    { level: "INTERMEDIATE", title: "I've done this before", description: "A checklist keeps you on track, but you're free to jump around." },
    { level: "PROFESSIONAL", title: "I know exactly what I want", description: "Every control is visible right away — no hand-holding." },
  ];
  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff" }}>How would you like to build?</h3>
        <p style={{ margin: "0.4rem 0 1.25rem", fontSize: "0.83rem", color: "rgba(240,242,255,0.5)" }}>
          You can change this anytime in a funnel's Settings.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {options.map((opt) => (
            <button
              key={opt.level}
              type="button"
              disabled={busy}
              onClick={() => onChoose(opt.level)}
              style={{
                textAlign: "left", padding: "0.9rem 1rem", borderRadius: 12,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)",
                cursor: busy ? "default" : "pointer", color: "#f0f2ff",
              }}
            >
              <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>{opt.title}</div>
              <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", marginTop: 2 }}>{opt.description}</div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.25rem" }}>
          <button type="button" style={buttonGhost} onClick={() => onChoose("INTERMEDIATE")} disabled={busy}>
            Not sure, decide for me
          </button>
          <button type="button" style={buttonGhost} onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function QuickCreateModal({
  busy, error, onCreate, onClose,
}: { busy: boolean; error: { message: string; needsSlot?: boolean } | null; onCreate: (opts: { name: string; enabled: boolean }) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <div style={overlayStyle}>
      <div style={{ ...cardStyle, maxWidth: 440 }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff" }}>New funnel</h3>
        <div style={{ marginTop: "1.1rem" }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>Name</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="My course" autoFocus />
        </div>
        {error && (
          <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#f87171" }}>
            {error.message}
            {error.needsSlot && (
              <>
                {" "}
                <Link href="/dashboard/settings/subscription?addon=funnel_slot&returnTo=/dashboard/funnels" style={{ color: "#f87171", textDecoration: "underline" }}>
                  Buy another funnel slot
                </Link>
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.25rem" }}>
          <button type="button" style={buttonGhost} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            style={{ ...buttonPrimary, opacity: busy || !name.trim() ? 0.6 : 1 }}
            disabled={busy || !name.trim()}
            onClick={() => onCreate({ name: name.trim(), enabled: false })}
          >
            {busy ? "Creating…" : "Create funnel"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PAGE_KIND_OPTIONS = [
  { kind: "VIDEO", label: "YouTube video" },
  { kind: "DOCUMENT", label: "Document" },
  { kind: "IMAGE", label: "Image" },
] as const;

function BeginnerWizardModal({
  busy, error, onCreate, onClose,
}: {
  busy: boolean;
  error: { message: string; needsSlot?: boolean } | null;
  onCreate: (opts: { name: string; enabled: boolean; firstPagePatch?: Record<string, unknown> }) => void;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [pageKind, setPageKind] = useState<(typeof PAGE_KIND_OPTIONS)[number]["kind"]>("VIDEO");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [publishNow, setPublishNow] = useState(true);

  const steps = ["Name it", "First page", "Review & publish"];

  function firstPagePatch(): Record<string, unknown> | undefined {
    if (pageKind === "VIDEO" && youtubeUrl.trim()) {
      return { kind: "VIDEO", title: "Lesson 1", youtubeVideoId: extractYoutubeId(youtubeUrl.trim()) };
    }
    if (pageKind !== "VIDEO") {
      return { kind: pageKind, title: "Lesson 1" };
    }
    return undefined;
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.25rem" }}>
          {steps.map((label, i) => (
            <div key={label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                height: 4, borderRadius: 2, background: i <= stepIndex ? "var(--brand, var(--brand))" : "rgba(255,255,255,0.1)", marginBottom: "0.4rem",
              }} />
              <div style={{ fontSize: "0.7rem", color: i <= stepIndex ? "#f0f2ff" : "rgba(240,242,255,0.4)" }}>{label}</div>
            </div>
          ))}
        </div>

        {stepIndex === 0 && (
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>What's this funnel called?</h3>
            <p style={{ margin: "0.35rem 0 1rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.5)" }}>
              Visitors won't see this name — it's just how you'll find it in your dashboard.
            </p>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="My course" autoFocus />
          </div>
        )}

        {stepIndex === 1 && (
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>Add your first page</h3>
            <p style={{ margin: "0.35rem 0 1rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.5)" }}>
              You can add more pages, reorder them, and change this anytime after.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem" }}>
              {PAGE_KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => setPageKind(opt.kind)}
                  style={{
                    flex: 1, padding: "0.55rem", borderRadius: 9, fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
                    background: pageKind === opt.kind ? "rgba(var(--brand-rgb),0.18)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${pageKind === opt.kind ? "var(--brand, var(--brand))" : "rgba(255,255,255,0.09)"}`,
                    color: pageKind === opt.kind ? "#c4b5fd" : "rgba(240,242,255,0.6)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {pageKind === "VIDEO" && (
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>YouTube URL</label>
                <input style={inputStyle} value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
              </div>
            )}
            {pageKind !== "VIDEO" && (
              <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)" }}>
                You'll upload the {pageKind === "DOCUMENT" ? "document" : "image"} once the funnel is created.
              </p>
            )}
          </div>
        )}

        {stepIndex === 2 && (
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>Ready to go</h3>
            <p style={{ margin: "0.35rem 0 1rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.5)" }}>
              Publishing makes this funnel visible to visitors right away. You can always turn it back off in Settings.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem", color: "#f0f2ff", cursor: "pointer" }}>
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
              Publish this funnel now
            </label>
          </div>
        )}

        {error && (
          <div style={{ marginTop: "0.9rem", fontSize: "0.8rem", color: "#f87171" }}>
            {error.message}
            {error.needsSlot && (
              <>
                {" "}
                <Link href="/dashboard/settings/subscription?addon=funnel_slot&returnTo=/dashboard/funnels" style={{ color: "#f87171", textDecoration: "underline" }}>
                  Buy another funnel slot
                </Link>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          <button type="button" style={buttonGhost} onClick={stepIndex === 0 ? onClose : () => setStepIndex((s) => s - 1)} disabled={busy}>
            {stepIndex === 0 ? "Cancel" : "Back"}
          </button>
          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              style={{ ...buttonPrimary, opacity: stepIndex === 0 && !name.trim() ? 0.6 : 1 }}
              disabled={stepIndex === 0 && !name.trim()}
              onClick={() => setStepIndex((s) => s + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              style={{ ...buttonPrimary, opacity: busy ? 0.6 : 1 }}
              disabled={busy}
              onClick={() => onCreate({ name: name.trim(), enabled: publishNow, firstPagePatch: firstPagePatch() })}
            >
              {busy ? "Creating…" : "Create funnel"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function extractYoutubeId(url: string): string {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match?.[1] ?? url;
}
