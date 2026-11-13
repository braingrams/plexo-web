"use client";

import { ZipDropzone } from "../_components/ZipDropzone";
import { ServerBuildProgress } from "./ServerBuildProgress";
import { stripEnvFilesInBrowser } from "@/lib/projects/clientSsrUpload";
import { SolIcon, SolOutOfCredits } from "../_components/sol/SolTopUp";
import { useEffect, useRef, useState } from "react";
import { AI_UNREACHABLE } from "@/lib/ai/requestErrors";
import { checkAiCredits, generateWithProgress, type AiRequestBody } from "@/lib/ai/clientGenerate";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MarketplaceListItem } from "@/lib/marketplace";
import { MarketplaceRowExpandGrid } from "@/app/marketplace/MarketplaceRowExpandGrid";
import { MarketplaceSkeletonGrid } from "@/app/marketplace/MarketplaceBrowse";
import { CustomSelect } from "../../_components/CustomSelect";

// Same four tiers/labels as Settings → AI's own Creativity Tier picker (AiSettingsClient.tsx)
// — kept here as its own small copy rather than a shared import since that file's TIER_OPTIONS
// isn't exported and this is the only other place in the app letting someone choose a tier
// for a single one-off AI action rather than a stored per-key default.
// Same builder-vs-raw-HTML framing as SOL's own ask_user_question for this exact choice
// (lib/ai/solAgent.ts's system prompt) — Pretty HTML is the recommended option in both
// places: real hand-crafted markup/CSS the model writes directly is the premium, most
// polished result, at the cost of not being editable afterward in the drag-and-drop
// builder the way generate_layout's designJson output is.
const PAGE_TYPE_OPTIONS: Array<{ value: "html" | "builder"; label: string; description: string }> = [
  { value: "html", label: "Pretty HTML (Recommended)", description: "Hand-crafted markup for the most premium, polished result — not editable in the drag-and-drop builder afterward" },
  { value: "builder", label: "Drag & Drop Builder", description: "Editable afterward with Plexo's own visual builder" },
];

const AI_TIER_OPTIONS: Array<{ label: string; value: "AUTO" | "BASIC" | "MEDIUM" | "HIGH"; description: string }> = [
  { label: "Auto", value: "AUTO", description: "Let Plexo pick based on the prompt" },
  { label: "Standard", value: "BASIC", description: "Fast and efficient" },
  { label: "Advanced", value: "MEDIUM", description: "Stronger reasoning" },
  { label: "Most Capable", value: "HIGH", description: "Most creative & thorough" },
];

type MarketplaceItem = MarketplaceListItem;

type CreatedTemplate = { id: string; name: string };

const hairline = "rgba(255,255,255,0.09)";
const hairlineSoft = "rgba(255,255,255,0.055)";

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const SERVER_ZIP_LIMIT_BYTES = 100 * 1024 * 1024;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconTemplate() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a13 13 0 0 1 3.2 9 13 13 0 0 1-3.2 9 13 13 0 0 1-3.2-9A13 13 0 0 1 12 3z" />
    </svg>
  );
}

function IconSuccess() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12.5 11 15.5 16 9" />
    </svg>
  );
}

/** A blank canvas for AI generation to start from — same empty-body shape
 * create_landing_page_subpage falls back to when no content is given. */
const BLANK_DESIGN_JSON = { body: { style: { background: "#ffffff", fontFamily: "inherit" }, rows: [] } };

/** Step indicator badge — filled brand while active or done, a checkmark once done,
 * an outlined faint circle while still upcoming. */
function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
        fontSize: "12.5px",
        fontWeight: 700,
        background: active || done ? "var(--brand)" : "rgba(255,255,255,0.05)",
        color: active || done ? "#fff" : "var(--text-faint)",
        border: active || done ? "none" : `1px solid ${hairline}`,
        boxShadow: active ? "0 0 0 4px var(--brand-subtle)" : "none",
        transition: "background 0.2s, box-shadow 0.2s",
      }}
    >
      {done ? <IconCheck /> : n}
    </div>
  );
}

function stepLabelStyle(active: boolean, done: boolean) {
  return {
    fontSize: "12.5px",
    fontWeight: 650,
    color: active || done ? "var(--text-main)" : "var(--text-faint)",
  };
}

function inputStyle() {
  return {
    width: "100%",
    background: "rgba(255,255,255,0.045)",
    border: `1px solid ${hairline}`,
    borderRadius: 9,
    color: "var(--text-main)",
    padding: "11px 13px",
    fontSize: "13.5px",
    fontFamily: "inherit",
  } as const;
}

function ghostButtonStyle() {
  return {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "none",
    border: `1px solid ${hairline}`,
    borderRadius: 9,
    padding: "10px 18px",
    cursor: "pointer",
  } as const;
}

function primaryButtonStyle(enabled: boolean) {
  return {
    fontSize: "13px",
    fontWeight: 650,
    color: "var(--bg)",
    background: enabled ? "var(--text-main)" : "var(--text-faint)",
    padding: "10px 20px",
    borderRadius: 9,
    border: "none",
    cursor: enabled ? "pointer" : "not-allowed",
  } as const;
}

/**
 * The "create a site" flow. Works as the /dashboard/new page, and inside the shared modal
 * (NewSiteProvider), where `onClose` is set and the page header is hidden.
 * `plan` decides whether the Server app tab is usable.
 */
export function NewSiteWizard({ onClose, plan = "FREE" }: { onClose?: () => void; plan?: "FREE" | "PRO" | "ULTRA" } = {}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [startTab, setStartTab] = useState<"marketplace" | "blank" | "ai" | "upload" | "server" | "wordpress">("marketplace");
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [serverFile, setServerFile] = useState<File | null>(null);
  const [serverAgreed, setServerAgreed] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverBusy, setServerBusy] = useState(false);
  // Set once a server build is queued: the tab then shows the build log and the success dialog.
  const [serverBuild, setServerBuild] = useState<{ templateId: string; buildId: string } | null>(null);
  // Server app source: an uploaded .zip, or a repo from the organization's connected GitHub account.
  const [serverSource, setServerSource] = useState<"zip" | "github">("zip");
  const [ghConn, setGhConn] = useState<{ configured: boolean; installations: Array<{ id: number; account: string }>; installUrl: string | null } | null>(null);
  const [ghConnLoading, setGhConnLoading] = useState(false);
  const [ghInstallation, setGhInstallation] = useState<number | null>(null);
  const [ghRepos, setGhRepos] = useState<Array<{ fullName: string; defaultBranch: string; private: boolean }>>([]);
  const [ghRepoLoading, setGhRepoLoading] = useState(false);
  const [ghRepo, setGhRepo] = useState("");
  const [ghBranch, setGhBranch] = useState("");
  const [ghFilter, setGhFilter] = useState("");
  const router = useRouter();

  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiTier, setAiTier] = useState<"AUTO" | "BASIC" | "MEDIUM" | "HIGH">("BASIC");
  // Pretty HTML is the recommended default — see PAGE_TYPE_OPTIONS below for why (matches
  // the same framing SOL's own ask_user_question uses for this exact choice).
  const [pageType, setPageType] = useState<"html" | "builder">("html");
  const [aiGenerating, setAiGenerating] = useState(false);
  // Streamed while the AI writes the page (lib/ai/clientGenerate.ts): how much so far, and
  // whether it's on a second pass after a first draft came back cut off.
  const [aiProgress, setAiProgress] = useState<{ characters: number; attempt: number } | null>(null);
  const [aiStage, setAiStage] = useState<"checking" | "writing" | "saving" | null>(null);
  // AI is a per-ApiKey setting (Settings → AI), not a single account-wide flag — "enabled"
  // means at least one active key has useAi:true. Checked once, the first time the AI tab
  // is opened, so a first-time user is asked to turn it on right here instead of hitting a
  // bare permission error only after they've already written a prompt.
  const [aiKeyStatus, setAiKeyStatus] = useState<"unchecked" | "checking" | "enabled" | "disabled">("unchecked");
  const [enablingAi, setEnablingAi] = useState(false);

  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  // The card is tall and the action buttons sit low in it: bring a new error into view,
  // or it appears off-screen above the button that caused it and looks like nothing happened.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  const [template, setTemplate] = useState<CreatedTemplate | null>(null);

  const [baseDomain, setBaseDomain] = useState("plexo.site");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  // Back from GitHub's install page: reopen the server tab on the GitHub option and say how it went.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("github");
    if (!result) return;
    setStartTab("server");
    setServerSource("github");
    const messages: Record<string, string> = {
      denied: "Your GitHub account doesn't have access to that account. Try connecting again.",
      expired: "That GitHub connection link expired. Try connecting again.",
      requested: "GitHub sent your request to the organization's owners. Once they approve, come back and try again.",
      missing: "GitHub didn't finish connecting. Try again.",
    };
    if (messages[result]) setError(messages[result]);
    params.delete("github");
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, []);

  // Load the organization's GitHub connection the first time the GitHub option is opened.
  useEffect(() => {
    if (startTab !== "server" || serverSource !== "github" || ghConn) return;
    setGhConnLoading(true);
    fetch("/api/v1/github/connection?returnTo=/dashboard/new")
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) return setError(data.error ?? "Couldn't check GitHub. Try again.");
        setGhConn(data);
        if (data.installations?.length) setGhInstallation((current) => current ?? data.installations[0].id);
      })
      .catch(() => setError("Couldn't check GitHub. Try again."))
      .finally(() => setGhConnLoading(false));
    // Runs when the option is opened; the check itself is skipped once a result is in.
  }, [startTab, serverSource]);

  // Repositories for the chosen GitHub account.
  useEffect(() => {
    if (ghInstallation === null) return;
    let cancelled = false;
    setGhRepoLoading(true);
    setGhRepos([]);
    setGhRepo("");
    setGhBranch("");
    fetch(`/api/v1/github/repos?installationId=${ghInstallation}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) return setError(data.error ?? "Couldn't load your repositories.");
        setGhRepos(data.repos ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your repositories.");
      })
      .finally(() => {
        if (!cancelled) setGhRepoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ghInstallation]);

  useEffect(() => {
    fetch("/api/v1/marketplace/templates?sort=popular&free=true&kind=LANDING_PAGE")
      .then((res) => res.json())
      .then((data) => setItems(data.templates ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));

    fetch("/api/v1/domains")
      .then((res) => res.json())
      .then((data) => {
        if (data.baseDomain) setBaseDomain(data.baseDomain);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (startTab !== "ai" || aiKeyStatus !== "unchecked") return;
    setAiKeyStatus("checking");
    fetch("/api/settings/api-keys")
      .then((res) => res.json())
      .then((data) => {
        const keys: { isActive: boolean; useAi: boolean }[] = data.apiKeys ?? [];
        setAiKeyStatus(keys.some((k) => k.isActive && k.useAi) ? "enabled" : "disabled");
      })
      .catch(() => setAiKeyStatus("disabled"));
  }, [startTab, aiKeyStatus]);

  /** Turns AI on right here in the wizard instead of sending the user to Settings — reuses
   * their most recent active API key if they have one (System AI needs no provider/BYOK
   * key to work, just useAi:true — see AiSettingsClient.tsx), or creates one first if they
   * have none yet. */
  async function handleEnableAi() {
    setError(null);
    setEnablingAi(true);
    try {
      const listRes = await fetch("/api/settings/api-keys");
      const listData = await listRes.json().catch(() => ({}));
      const keys: { id: string; isActive: boolean; createdAt?: string }[] = listData.apiKeys ?? [];
      let keyId = keys.find((k) => k.isActive)?.id;

      if (!keyId) {
        const createRes = await fetch("/api/settings/api-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Site builder AI" }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          setError(createData.error ?? "Couldn't turn on SOL. Please try again.");
          return;
        }
        keyId = createData.apiKey.id;
      }

      const patchRes = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useAi: true }),
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) {
        setError(patchData.error ?? "Couldn't turn on SOL. Please try again.");
        return;
      }
      setAiKeyStatus("enabled");
    } finally {
      setEnablingAi(false);
    }
  }

  function advanceToConnect(created: CreatedTemplate) {
    setTemplate(created);
    if (!slugTouched) setSlug(slugify(created.name));
    setStep(2);
  }

  async function handleStartBlank() {
    setCreatingBlank(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Site", kind: "LANDING_PAGE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the site. Please try again.");
        return;
      }
      advanceToConnect(data.template);
    } finally {
      setCreatingBlank(false);
    }
  }

  // The site record is created first (ssr-deploy needs a template), then the source is uploaded.
  // If the upload fails, the empty site stays on the account and can be deleted from its page.
  async function handleServerDeploy(event: React.FormEvent) {
    event.preventDefault();
    if (!serverFile || !serverName.trim() || !serverAgreed) return;
    if (serverFile.size > SERVER_ZIP_LIMIT_BYTES) {
      setError(`That zip is ${(serverFile.size / 1024 / 1024).toFixed(1)}MB. The limit is ${SERVER_ZIP_LIMIT_BYTES / 1024 / 1024}MB.`);
      return;
    }
    setServerBusy(true);
    setError(null);
    try {
      const created = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: serverName.trim(), kind: "LANDING_PAGE" }),
      });
      const createdData = await created.json().catch(() => ({}));
      if (!created.ok) {
        setError(createdData.error ?? "Couldn't create the site. Please try again.");
        return;
      }
      const templateId = createdData.template.id as string;

      // 1. Send the zip in 3 MB parts through this app, which stages them in storage. Each part
      //    stays under Lambda's request limit, and the file never goes to storage from the browser.
      // Environment files are removed in the browser, so their bytes are never sent.
      const { file: uploadFile } = await stripEnvFilesInBrowser(serverFile);
      const CHUNK = 3 * 1024 * 1024;
      const total = Math.max(1, Math.ceil(uploadFile.size / CHUNK));
      const session = crypto.randomUUID();
      let uploadKey: string | null = null;
      for (let index = 0; index < total; index++) {
        const part = await fetch(`/api/v1/templates/${templateId}/ssr-upload/chunk`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Session": session,
            "X-Chunk-Index": String(index),
            "X-Chunk-Total": String(total),
          },
          body: uploadFile.slice(index * CHUNK, (index + 1) * CHUNK),
        });
        const partData = await part.json().catch(() => ({}));
        if (!part.ok) {
          setError(partData.error ?? `The upload stopped at part ${index + 1} of ${total} (server responded ${part.status}). Try again.`);
          return;
        }
        if (partData.status === "assembled") uploadKey = partData.uploadKey as string;
      }
      if (!uploadKey) {
        setError("The upload didn't finish. Try again.");
        return;
      }

      // 3. Queue the build from the uploaded zip.
      const res = await fetch(`/api/v1/templates/${templateId}/ssr-deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `The server couldn't start the build (server responded ${res.status}). Try again.`);
        return;
      }
      // Stay here: the build log streams in place of the form, then the app goes live.
      setServerBuild({ templateId, buildId: data.buildId as string });
    } finally {
      setServerBusy(false);
    }
  }

  // Same flow as the zip upload, except the source is a repo's branch: the server downloads it
  // (ssr-deploy with a github source) and runs the same build, budget check, and publish steps.
  async function handleServerFromGitHub(event: React.FormEvent) {
    event.preventDefault();
    if (!ghInstallation || !ghRepo || !ghBranch.trim() || !serverName.trim() || !serverAgreed) return;
    setServerBusy(true);
    setError(null);
    try {
      const created = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: serverName.trim(), kind: "LANDING_PAGE" }),
      });
      const createdData = await created.json().catch(() => ({}));
      if (!created.ok) {
        setError(createdData.error ?? "Couldn't create the site. Please try again.");
        return;
      }
      const templateId = createdData.template.id as string;

      const res = await fetch(`/api/v1/templates/${templateId}/ssr-deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github: { installationId: ghInstallation, repo: ghRepo, ref: ghBranch.trim() } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `The server couldn't start the build (server responded ${res.status}). Try again.`);
        return;
      }
      setServerBuild({ templateId, buildId: data.buildId as string });
    } finally {
      setServerBusy(false);
    }
  }

  async function handleUseMarketplace(item: MarketplaceItem) {
    setError(null);
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/v1/marketplace/templates/${item.id}/use`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to use this template.");
        return;
      }
      advanceToConnect(data.template);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Calls the SAME two native, in-process endpoints an MCP client (or any first-party AI
   * caller) would — /api/v1/ai/generate (mode: generate_layout, the exact bridge
   * RawAiEditPanel.tsx already uses for in-dashboard AI edits, via the
   * x-api-key: "workspace-internal" sentinel that resolves the caller's real session
   * instead of a stored API key) to turn the prompt into a designJson tree, then
   * /api/v1/publish (the same endpoint plexo-mcp's create_landing_page ultimately calls)
   * to compile and save it as a real Template. No MCP round-trip, no extra hop — this is
   * the fastest path plexo-web itself has to a working page from a prompt.
   */
  async function handleGenerateWithAi() {
    setOutOfCredits(false);
    if (!aiPrompt.trim()) {
      setError("Describe the site you want first.");
      return;
    }
    if (pageType === "html" && !agreed) {
      setError("You must agree to the Acceptable Use Policy to publish unsanitized HTML.");
      return;
    }
    setError(null);
    setAiGenerating(true);
    setAiProgress(null);
    try {
      const request: AiRequestBody =
        pageType === "html"
          ? { mode: "generate_raw_html", prompt: aiPrompt.trim(), templateKind: "LANDING_PAGE", context: null, tier: aiTier }
          : { mode: "generate_layout", prompt: aiPrompt.trim(), templateKind: "LANDING_PAGE", context: BLANK_DESIGN_JSON, tier: aiTier };

      // Confirm the account can afford it before anything runs.
      setAiStage("checking");
      const credits = await checkAiCredits(request);
      if (credits && !credits.enough) {
        // Plexo's AI and not enough credits → SOL's top-up card; anything else is a plain message.
        if (credits.paidBy === "plexo" && credits.estimatedCredits !== null) setOutOfCredits(true);
        else setError(credits.message ?? "You don't have enough AI credits for this.");
        return;
      }

      setAiStage("writing");
      let genData: { summary: string; result: unknown };
      try {
        genData = await generateWithProgress(request, setAiProgress);
      } catch (err) {
        // "AI is not enabled for this account" is the one error a first-time user is likely
        // to hit — point them at the fix instead of leaving a bare permission error.
        const message = err instanceof Error ? err.message : "SOL couldn't build your site. Please try again.";
        if (/enough AI credits|out of AI credits/i.test(message)) setOutOfCredits(true);
        else setError(/not enabled/i.test(message) ? "SOL isn't turned on for your account yet. Turn it on in Settings → AI, then try again." : message);
        return;
      }
      setAiStage("saving");

      const name = aiPrompt.trim().slice(0, 60);
      const publishRes = await fetch(pageType === "html" ? "/api/v1/templates/upload-raw" : "/api/v1/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          pageType === "html"
            ? { name, htmlContent: genData.result, acceptAup: true }
            : { name, kind: "LANDING_PAGE", designJson: genData.result },
        ),
      });
      const publishData = await publishRes.json().catch(() => ({}));
      if (!publishRes.ok) {
        setError(publishData.error ?? "Generated the page, but couldn't save it.");
        return;
      }
      advanceToConnect({ id: publishData.templateId, name: publishData.name });
    } catch {
      // The request never got an answer (connection dropped, or the browser gave up).
      setError(AI_UNREACHABLE);
    } finally {
      setAiGenerating(false);
      setAiStage(null);
      setAiProgress(null);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a .html, .htm, or .zip file to upload.");
      return;
    }
    if (!agreed) {
      setError("You must agree to the Acceptable Use Policy to publish unsanitized HTML.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (uploadName.trim()) form.append("name", uploadName.trim());
      form.append("acceptAup", "true");
      const res = await fetch("/api/v1/templates/upload-raw", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      advanceToConnect({ id: data.templateId, name: data.name });
    } finally {
      setUploading(false);
    }
  }

  const slugValid = slug.length > 0 && SUBDOMAIN_REGEX.test(slug);

  async function handlePublish() {
    if (!template || !slugValid) return;
    setError(null);
    setPublishing(true);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, type: "SUBDOMAIN", domain: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to publish.");
        return;
      }
      setPublishedUrl(`https://${data.domain.domain}`);
    } finally {
      setPublishing(false);
    }
  }

  const cardWidth = step === 1 ? 1080 : 1080;

  return (
    <div style={{ color: "var(--text-main)", minHeight: "calc(100vh - 180px)", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: cardWidth, transition: "max-width 0.25s ease", position: "relative" }}>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 0, right: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 8 }}>
            &times;
          </button>
        )}
        {!onClose && (
          <>
          <Link href="/dashboard" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}>
            &larr; Overview
          </Link>

          <div style={{ margin: "18px 0 2.5rem" }}>
            <h1 style={{ margin: "0 0 8px", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>Host a site</h1>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)" }}>
              Pick a starting point, choose a web address, and publish — no experience needed.
            </p>
          </div>
          </>
        )}

        {/* Stepper (padded on the right in the modal so the close button doesn't cover "Publish") */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 32, paddingRight: onClose ? 40 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={1} active={step === 1} done={step > 1} />
            <span style={stepLabelStyle(step === 1, step > 1)}>Start</span>
          </div>
          <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > 1 ? "var(--brand)" : hairline, margin: "0 16px", transition: "background 0.2s" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={2} active={step === 2} done={step > 2} />
            <span style={stepLabelStyle(step === 2, step > 2)}>Connect</span>
          </div>
          <div style={{ flex: 1, height: 2, borderRadius: 2, background: step > 2 ? "var(--brand)" : hairline, margin: "0 16px", transition: "background 0.2s" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <StepBadge n={3} active={step === 3} done={false} />
            <span style={stepLabelStyle(step === 3, false)}>Publish</span>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            background: "var(--surface)",
            border: `1px solid var(--surface-border)`,
            borderRadius: 20,
            padding: step === 1 ? "36px 40px" : "40px 44px",
            boxShadow: "0 24px 60px -30px rgba(0,0,0,0.6)",
          }}
        >
          {outOfCredits && (
            <div style={{ margin: "0 0 18px" }}>
              <SolOutOfCredits onDismiss={() => setOutOfCredits(false)} onToppedUp={() => void handleGenerateWithAi()} />
            </div>
          )}
          {error && (
            <div
              ref={errorRef}
              role="alert"
              style={{
                display: "flex", gap: 10, alignItems: "flex-start", margin: "0 0 18px", padding: "12px 14px", borderRadius: 10,
                border: "1px solid rgba(248,113,113,0.45)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: "13px", lineHeight: 1.5,
              }}
            >
              <span aria-hidden="true" style={{ fontWeight: 800 }}>!</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          )}

          {/* Step 1 — Start */}
          {step === 1 && (
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Choose a starting point</h2>
              <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                Start from a ready-made template, or bring a site you already have.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 24,
                  padding: 3,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${hairline}`,
                  width: "fit-content",
                }}
              >
                <button
                  type="button"
                  onClick={() => setStartTab("marketplace")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "marketplace" ? "var(--brand)" : "transparent",
                    color: startTab === "marketplace" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  From a template
                </button>
                <button
                  type="button"
                  onClick={() => setStartTab("blank")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "blank" ? "var(--brand)" : "transparent",
                    color: startTab === "blank" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  Blank canvas
                </button>
                <button
                  type="button"
                  onClick={() => setStartTab("ai")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "ai" ? "var(--brand)" : "transparent",
                    color: startTab === "ai" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  Build with AI
                </button>
                <button
                  type="button"
                  onClick={() => setStartTab("upload")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "upload" ? "var(--brand)" : "transparent",
                    color: startTab === "upload" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  Upload your own
                </button>
                {plan === "ULTRA" && (
                  <button
                    type="button"
                    onClick={() => setStartTab("server")}
                    style={{
                      fontSize: "12.5px",
                      fontWeight: 650,
                      padding: "7px 14px",
                      borderRadius: 999,
                      border: "none",
                      cursor: "pointer",
                      background: startTab === "server" ? "var(--brand)" : "transparent",
                      color: startTab === "server" ? "#fff" : "var(--text-muted)",
                      transition: "background 0.15s, color 0.15s",
                    }}
                  >
                    Server app
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStartTab("wordpress")}
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 650,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: startTab === "wordpress" ? "var(--brand)" : "transparent",
                    color: startTab === "wordpress" ? "#fff" : "var(--text-muted)",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  Move from WordPress
                </button>
              </div>

              {startTab === "marketplace" ? (
                loadingItems ? (
                  <MarketplaceSkeletonGrid />
                ) : items.length === 0 ? (
                  <p style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
                    No free templates available right now — try{" "}
                    <button
                      type="button"
                      onClick={() => setStartTab("upload")}
                      style={{ color: "var(--brand)", fontWeight: 650, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                    >
                      uploading your own
                    </button>
                    .
                  </p>
                ) : (
                  <MarketplaceRowExpandGrid templates={items} busyId={busyId} onSelect={(t) => void handleUseMarketplace(t)} />
                )
              ) : startTab === "blank" ? (
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Start with a blank canvas</h2>
                  <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                    Build the page yourself in the visual editor, then choose an address.
                  </p>
                  <button type="button" disabled={creatingBlank} onClick={() => void handleStartBlank()} style={primaryButtonStyle(!creatingBlank)}>
                    {creatingBlank ? "Creating…" : "Create blank site"}
                  </button>
                </div>
              ) : startTab === "ai" ? (
                <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: 10, background: "var(--brand-subtle)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}
                    >
                      <SolIcon size={20} />
                    </div>
                    <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-muted)" }}>
                      Describe the site you want — SOL builds a complete, working page from your description.
                    </p>
                  </div>

                  {aiKeyStatus === "checking" || aiKeyStatus === "unchecked" ? (
                    <p style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>Getting SOL ready…</p>
                  ) : aiKeyStatus === "disabled" ? (
                    <div
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${hairline}`,
                        background: "rgba(255,255,255,0.02)",
                        padding: "18px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "13px", fontWeight: 650 }}>Turn on SOL to build from a description</p>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        SOL isn&rsquo;t on for your account yet. Turning it on uses Plexo&rsquo;s AI, paid from your AI
                        credits — no setup needed. You can switch to your own AI key any time in{" "}
                        <Link href="/dashboard/settings/ai" target="_blank" style={{ color: "var(--brand)" }}>
                          Settings
                        </Link>
                        .
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleEnableAi()}
                        disabled={enablingAi}
                        style={{ ...primaryButtonStyle(!enablingAi), cursor: enablingAi ? "wait" : "pointer" }}
                      >
                        {enablingAi ? "Turning on…" : "Turn on SOL"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span style={{ display: "block", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.35rem" }}>
                          Page Type
                        </span>
                        <CustomSelect
                          value={pageType}
                          options={PAGE_TYPE_OPTIONS}
                          onChange={(v) => setPageType(v as typeof pageType)}
                        />
                      </div>
                      <div>
                        <span style={{ display: "block", fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.35rem" }}>
                          Creativity Tier
                        </span>
                        <CustomSelect
                          value={aiTier}
                          options={AI_TIER_OPTIONS}
                          onChange={(v) => setAiTier(v as typeof aiTier)}
                        />
                      </div>
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="A modern landing page for a boutique coffee roastery, with a hero section, our story, a product grid, and a newsletter signup."
                        rows={5}
                        style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }}
                      />
                      {pageType === "html" && (
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.7, cursor: "pointer" }}>
                          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
                          <span>
                            I agree to the{" "}
                            <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>
                              Acceptable Use Policy
                            </Link>
                            . Pretty HTML pages are published exactly as generated, with no modification.
                          </span>
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleGenerateWithAi()}
                        disabled={aiGenerating || !aiPrompt.trim() || (pageType === "html" && !agreed)}
                        style={{ ...primaryButtonStyle(!aiGenerating && !!aiPrompt.trim() && (pageType !== "html" || agreed)), alignSelf: "flex-start", cursor: aiGenerating ? "wait" : "pointer" }}
                      >
                        {aiGenerating ? (aiStage === "checking" ? "Checking your AI credits…" : aiStage === "saving" ? "Saving your site…" : "Writing your site…") : "Generate my site"}
                      </button>
                      {aiGenerating && aiStage === "writing" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }} aria-live="polite">
                          <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                            <div className="plexo-ai-progress" style={{ height: "100%", width: "40%", borderRadius: 999, background: "var(--brand)" }} />
                          </div>
                          <p style={{ fontSize: "11.5px", color: "var(--text-faint)", margin: 0 }}>
                            {!aiProgress || aiProgress.characters === 0
                              ? "Planning your page…"
                              : aiProgress.attempt > 1
                                ? `The first draft ran long — writing the full version (${aiProgress.characters.toLocaleString()} characters so far)…`
                                : `Writing your page — ${aiProgress.characters.toLocaleString()} characters so far…`}
                            {" "}A full page usually takes one to three minutes; you can watch it come together here.
                          </p>
                          <style>{`@keyframes plexoAiSlide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}.plexo-ai-progress{animation:plexoAiSlide 1.4s ease-in-out infinite}`}</style>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : startTab === "server" ? (
                serverBuild ? (
                  <ServerBuildProgress
                    templateId={serverBuild.templateId}
                    buildId={serverBuild.buildId}
                    detailUrl={`/dashboard/templates/${serverBuild.templateId}/detail`}
                    onTryAgain={() => setServerBuild(null)}
                    onLive={() => onClose?.()}
                  />
                ) : (
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Server app</h2>
                  <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                    Use the source of a Next.js, Nuxt, Remix, Astro or Nitro app, from a .zip or a GitHub repository. Plexo builds it and runs it as an app on its own server.
                  </p>
                <div role="tablist" aria-label="Where the code comes from" style={{ display: "inline-flex", gap: 6, padding: 4, borderRadius: 12, border: `1px solid ${hairline}`, marginBottom: 18 }}>
                  {(["zip", "github"] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      role="tab"
                      aria-selected={serverSource === source}
                      onClick={() => setServerSource(source)}
                      disabled={serverBusy}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", background: serverSource === source ? "var(--brand)" : "transparent", color: serverSource === source ? "#fff" : "var(--text-muted)" }}
                    >
                      {source === "zip" ? "Upload a .zip" : "Connect GitHub repository"}
                    </button>
                  ))}
                </div>
                {serverSource === "zip" ? (
                <form onSubmit={(e) => void handleServerDeploy(e)} style={{ display: "grid", gap: 14, maxWidth: 480 }}>
                    <label style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                      App name
                      <input
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder="My app"
                        style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                      />
                    </label>
                    <div style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                      Source (.zip with package.json at its root)
                      <ZipDropzone file={serverFile} onFile={setServerFile} accept=".zip" hint=".zip, with package.json at its root" disabled={serverBusy} />
                    </div>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.7, cursor: "pointer" }}>
                      <input type="checkbox" checked={serverAgreed} onChange={(e) => setServerAgreed(e.target.checked)} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
                      <span>
                        I agree to the{" "}
                        <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>
                          Acceptable Use Policy
                        </Link>
                        . The app's code is built and run on Plexo's servers exactly as uploaded.
                      </span>
                    </label>
                    <div>
                      <button
                        type="submit"
                        disabled={serverBusy || !serverFile || !serverName.trim() || !serverAgreed}
                        style={primaryButtonStyle(!serverBusy && !!serverFile && !!serverName.trim() && serverAgreed)}
                      >
                        {serverBusy ? "Uploading…" : "Upload and build"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleServerFromGitHub(e)} style={{ display: "grid", gap: 14, maxWidth: 480 }}>
                    <label style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                      App name
                      <input
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder="My app"
                        style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                      />
                    </label>
                    {!ghConn ? (
                      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
                        {ghConnLoading ? "Checking your GitHub connection…" : "Couldn't reach GitHub. Switch tabs and back to try again."}
                      </p>
                    ) : !ghConn.configured ? (
                      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>GitHub isn&apos;t set up on this Plexo yet. Upload a .zip instead.</p>
                    ) : ghConn.installations.length === 0 ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                          Connect the GitHub account or organization that owns the repository. You&apos;ll approve Plexo on GitHub, then come back here.
                        </p>
                        <div>
                          <button
                            type="button"
                            disabled={!ghConn.installUrl}
                            onClick={() => window.location.assign(ghConn.installUrl as string)}
                            style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${hairline}`, background: "transparent", color: "var(--text-main)", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
                          >
                            Connect GitHub
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {ghConn.installations.length > 1 && (
                          <label style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                            GitHub account
                            <select
                              value={ghInstallation ?? ""}
                              onChange={(e) => setGhInstallation(Number(e.target.value))}
                              style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                            >
                              {ghConn.installations.map((i) => (
                                <option key={i.id} value={i.id}>{i.account}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                          Repository
                          <input
                            value={ghFilter}
                            onChange={(e) => setGhFilter(e.target.value)}
                            placeholder="Search repositories"
                            style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                          />
                          <select
                            value={ghRepo}
                            disabled={ghRepoLoading}
                            onChange={(e) => {
                              const picked = ghRepos.find((r) => r.fullName === e.target.value);
                              setGhRepo(e.target.value);
                              setGhBranch(picked?.defaultBranch ?? "");
                            }}
                            style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                          >
                            <option value="">{ghRepoLoading ? "Loading repositories…" : "Choose a repository"}</option>
                            {ghRepos
                              .filter((r) => r.fullName.toLowerCase().includes(ghFilter.trim().toLowerCase()))
                              .map((r) => (
                                <option key={r.fullName} value={r.fullName}>
                                  {r.fullName}{r.private ? " (private)" : ""}
                                </option>
                              ))}
                          </select>
                        </div>
                        <label style={{ display: "grid", gap: 6, fontSize: "13px", fontWeight: 600 }}>
                          Branch
                          <input
                            value={ghBranch}
                            onChange={(e) => setGhBranch(e.target.value)}
                            placeholder="main"
                            disabled={!ghRepo}
                            style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${hairline}`, background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit" }}
                          />
                        </label>
                      </>
                    )}
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.7, cursor: "pointer" }}>
                      <input type="checkbox" checked={serverAgreed} onChange={(e) => setServerAgreed(e.target.checked)} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
                      <span>
                        I agree to the{" "}
                        <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>
                          Acceptable Use Policy
                        </Link>
                        . The app&apos;s code is built and run on Plexo&apos;s servers exactly as it is in the repository.
                      </span>
                    </label>
                    <div>
                      <button
                        type="submit"
                        disabled={serverBusy || !ghInstallation || !ghRepo || !ghBranch.trim() || !serverName.trim() || !serverAgreed}
                        style={primaryButtonStyle(!serverBusy && !!ghInstallation && !!ghRepo && !!ghBranch.trim() && !!serverName.trim() && serverAgreed)}
                      >
                        {serverBusy ? "Starting…" : "Build from GitHub"}
                      </button>
                    </div>
                  </form>
                )}
                </div>
                )
              ) : startTab === "wordpress" ? (
                <div style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: 10, background: "var(--brand-subtle)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}
                    >
                      <IconGlobe />
                    </div>
                    <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.6 }}>
                      Already have a WordPress site? Plexo copies all of it — pages, blog posts, images, your theme&rsquo;s design and your
                      exact web addresses — reconnects your forms, and walks you through moving your domain. Your WordPress site isn&rsquo;t changed.
                    </p>
                  </div>
                  <Link href="/dashboard/migrate/wordpress" style={{ ...primaryButtonStyle(true), textDecoration: "none", display: "inline-block" }}>
                    Move my WordPress site →
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleUpload} style={{ maxWidth: 680, display: "flex", flexDirection: "column", gap: 22 }}>
                  <ZipDropzone file={file} onFile={setFile} accept=".html,.htm,.zip" hint=".html, .htm, or .zip" />
                  <div>
                    <label style={{ fontSize: "11.5px", fontWeight: 650, color: "var(--text-muted)", display: "block", marginBottom: 8 }}>Site name (optional)</label>
                    <input type="text" value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder="My site" style={inputStyle()} />
                  </div>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.7, cursor: "pointer" }}>
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0 }} />
                    <span>
                      I agree to the{" "}
                      <Link href="/legal/acceptable-use" target="_blank" style={{ color: "var(--brand)" }}>
                        Acceptable Use Policy
                      </Link>
                      . Content is published exactly as uploaded, with no modification.
                    </span>
                  </label>
                  <button type="submit" disabled={uploading} style={{ ...primaryButtonStyle(true), alignSelf: "flex-start", cursor: uploading ? "wait" : "pointer" }}>
                    {uploading ? "Uploading…" : "Upload & continue"}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Step 2 — Connect */}
          {step === 2 && template && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 14px",
                  marginBottom: 24,
                  borderRadius: 10,
                  background: "rgba(52,211,153,0.08)",
                  border: "1px solid rgba(52,211,153,0.2)",
                }}
              >
                <span style={{ fontSize: "12.5px", color: "var(--success)" }}>
                  <strong>&ldquo;{template.name}&rdquo;</strong> is ready
                </span>
                <Link href={`/dashboard/templates/${template.id}`} target="_blank" style={{ fontSize: "12px", fontWeight: 650, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap" }}>
                  Open editor &rarr;
                </Link>
              </div>

              <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Give your site an address</h2>
              <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-muted)" }}>
                This is the web address people will use to find your site. You can change it later.
              </p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "rgba(255,255,255,0.045)",
                  border: `1px solid ${slugValid || slug.length === 0 ? hairline : "var(--warning)"}`,
                  borderRadius: 10,
                  padding: "4px 4px 4px 14px",
                }}
              >
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "none",
                    border: "none",
                    outline: "none",
                    color: "var(--brand)",
                    padding: "9px 0",
                    fontSize: "15px",
                    fontWeight: 650,
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <span style={{ fontSize: "15px", color: "var(--text-faint)", fontFamily: "var(--font-mono)", paddingRight: 10, whiteSpace: "nowrap" }}>.{baseDomain}</span>
              </div>
              {!slugValid && slug.length > 0 && (
                <p style={{ fontSize: "11.5px", color: "var(--warning)", marginTop: 8 }}>Lowercase letters, numbers, and hyphens only.</p>
              )}
              <p style={{ fontSize: "12px", color: "var(--text-faint)", marginTop: 14, lineHeight: 1.6 }}>
                Have your own domain? Connect it any time from{" "}
                <Link href="/dashboard/domains" style={{ color: "var(--brand)" }}>
                  Domains
                </Link>{" "}
                after publishing — this subdomain works instantly in the meantime.
              </p>

              <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
                <button type="button" onClick={() => setStep(1)} style={ghostButtonStyle()}>
                  Back
                </button>
                <button type="button" disabled={!slugValid} onClick={() => setStep(3)} style={primaryButtonStyle(slugValid)}>
                  Continue to publish
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Publish */}
          {step === 3 && template && (
            <div>
              {publishedUrl ? (
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                    <IconSuccess />
                  </div>
                  <h2 style={{ margin: "0 0 8px", fontSize: "19px", fontWeight: 700 }}>Your site is live</h2>
                  <Link href={publishedUrl} target="_blank" style={{ fontFamily: "var(--font-mono)", fontSize: "15px", fontWeight: 650, color: "var(--brand)" }}>
                    {publishedUrl.replace("https://", "")}
                  </Link>
                  <p style={{ fontSize: "12.5px", color: "var(--text-muted)", margin: "10px 0 0" }}>
                    You can keep customizing any time — publishing doesn&rsquo;t lock anything in.
                  </p>
                  <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 26 }}>
                    <Link href={`/dashboard/templates/${template.id}`} style={{ ...ghostButtonStyle(), textDecoration: "none", display: "inline-block" }}>
                      Open editor
                    </Link>
                    <Link href="/dashboard" style={{ ...primaryButtonStyle(true), textDecoration: "none", display: "inline-block" }}>
                      Back to Overview
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: 700 }}>Review and publish</h2>
                  <p style={{ margin: "0 0 22px", fontSize: "13px", color: "var(--text-muted)" }}>
                    Here&rsquo;s what&rsquo;s about to go live. You can always change it later.
                  </p>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderTop: `1px solid ${hairlineSoft}`, borderBottom: `1px solid ${hairlineSoft}` }}>
                    <IconTemplate />
                    <span style={{ fontSize: "12.5px", color: "var(--text-muted)", flexShrink: 0 }}>Template</span>
                    <span style={{ fontSize: "13px", fontWeight: 650, marginLeft: "auto" }}>{template.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: `1px solid ${hairlineSoft}` }}>
                    <IconGlobe />
                    <span style={{ fontSize: "12.5px", color: "var(--text-muted)", flexShrink: 0 }}>Address</span>
                    <span style={{ fontSize: "13px", fontWeight: 650, fontFamily: "var(--font-mono)", marginLeft: "auto" }}>
                      {slug}.{baseDomain}
                    </span>
                  </div>

                  <p style={{ fontSize: "12px", color: "var(--text-faint)", margin: "16px 0 0", lineHeight: 1.6 }}>
                    Publishing makes this address live immediately. Nothing else changes — you can keep editing whenever you like.
                  </p>

                  <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                    <button type="button" onClick={() => setStep(2)} style={ghostButtonStyle()}>
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePublish()}
                      disabled={publishing}
                      style={{
                        fontSize: "13px",
                        fontWeight: 650,
                        color: "#fff",
                        background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
                        padding: "10px 22px",
                        borderRadius: 9,
                        border: "none",
                        cursor: publishing ? "wait" : "pointer",
                        boxShadow: "0 12px 28px -10px var(--brand-glow)",
                      }}
                    >
                      {publishing ? "Publishing…" : "Publish now"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
