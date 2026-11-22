"use client";

import { useRef, useState } from "react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { useRouter } from "next/navigation";
import { Code2, Copy, FileText, LayoutTemplate, Upload } from "lucide-react";
import { listPageTemplates } from "@charisol/plexo-sdk/v2/compile";
import { Button, ButtonLink, Input, Modal, Select, useToast } from "../ui";
import { slugify } from "@/lib/dashboardV3/hubTabs";
import { editHrefFor } from "@/lib/dashboardV3/hubPaths";
import { errMsg, hubApi } from "./hubApi";

type Start = "design" | "copy" | "blank" | "code";
type PageLite = { id: string; name: string; isRoot: boolean };

const STARTS: { id: Start; title: string; body: string; icon: React.ReactNode }[] = [
  { id: "design", title: "A ready design", body: "Pick a page that's already filled in.", icon: <LayoutTemplate size={18} aria-hidden /> },
  { id: "copy", title: "Copy a page", body: "Start from one you already made.", icon: <Copy size={18} aria-hidden /> },
  { id: "blank", title: "Blank page", body: "Start from nothing.", icon: <FileText size={18} aria-hidden /> },
  { id: "code", title: "My own code", body: "Upload a page you made yourself.", icon: <Code2 size={18} aria-hidden /> },
];

/** Add a page to any kind of site: a ready design, a copy, blank, or the owner's own file. Then straight into the editor. */
export function AddPageModal({ open, onClose, siteName, rootId, pages, isApp, siteIsClassic }: { open: boolean; onClose: () => void; siteName: string; rootId: string; pages: PageLite[]; isApp: boolean; siteIsClassic: boolean }) {
  const router = useRouter();
  const { show } = useToast();
  const designs = listPageTemplates().filter((d) => d.id !== "blank");
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("design");
  const [design, setDesign] = useState(designs[0]?.id ?? "about");
  const [copyId, setCopyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [needsAup, setNeedsAup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const copyable = pages.filter((p) => !p.isRoot);

  const solDraft = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Add a page called "${name.trim() || "New page"}" to my site "${siteName}". `)}`;

  async function create(acceptAup = false) {
    const clean = name.trim();
    if (!clean) return setError("Please give your page a name, like “About us”.");
    setBusy(true);
    setError(null);
    try {
      let newId: string;
      if (start === "copy") {
        if (!copyId) throw new Error("Choose which page to copy.");
        const r = await hubApi<{ page: { id: string } }>(`/api/templates/${copyId}/duplicate`, { method: "POST" });
        newId = r.page.id;
        await hubApi(`/api/templates/${newId}`, { method: "PATCH", json: { name: clean } }).catch(() => null);
      } else if (start === "code") {
        if (!file) throw new Error("Choose the page file to upload (an .html file).");
        const form = new FormData();
        form.append("file", file);
        form.append("parentId", rootId);
        form.append("name", clean);
        if (acceptAup) form.append("acceptAup", "true");
        try {
          const r = await hubApi<{ templateId: string }>("/api/v1/templates/upload-raw", { method: "POST", body: form });
          newId = r.templateId;
        } catch (e) {
          if ((e as { data?: { requiresAupAcceptance?: boolean } }).data?.requiresAupAcceptance && !acceptAup) {
            setNeedsAup(true);
            setBusy(false);
            return;
          }
          throw e;
        }
      } else {
        const r = await hubApi<{ template: { id: string } }>("/api/templates", {
          method: "POST",
          json: { name: clean, parentId: rootId, slug: slugify(clean), ...(start === "design" ? { pageTemplate: design, designFormat: "v2" } : {}) },
        });
        newId = r.template.id;
      }
      show({ title: "Page added", tone: "success" });
      onClose();
      router.push(editHrefFor(newId, start === "code" ? "RAW_UPLOAD" : "BUILDER"));
      router.refresh();
    } catch (e) {
      setError(errMsg(e, "We couldn't add that page. Please try again."));
      setBusy(false);
    }
  }

  const footer = isApp ? (
    <ButtonLink href={solDraft} leftIcon={<SolGlyph size={18} />}>
      Ask SOL to build this page
    </ButtonLink>
  ) : needsAup ? (
    <>
      <Button variant="ghost" onClick={() => setNeedsAup(false)}>
        Back
      </Button>
      <Button loading={busy} onClick={() => create(true)}>
        I agree, add my page
      </Button>
    </>
  ) : (
    <>
      <ButtonLink href={solDraft} variant="secondary" leftIcon={<SolGlyph size={18} />}>
        Ask SOL to build this page
      </ButtonLink>
      <Button loading={busy} onClick={() => create()}>
        Add page
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add a page" description={isApp ? "SOL builds new screens for your app. Tell it what you need." : "Name it, then choose how to start. You can change everything after."} footer={footer} closeOnBackdrop={!busy}>
      {needsAup ? (
        <p className="plx-body">
          Your own code runs exactly as you wrote it. Before we add it, please confirm you&apos;ll only upload things you made or have the right to use, and that follow our{" "}
          <a href="/legal/acceptable-use" target="_blank" rel="noreferrer">
            rules for what&apos;s allowed
          </a>
          .
        </p>
      ) : (
        <div className="plx-modal-stack">
          <Input label="Page name" placeholder="About us" value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} autoComplete="off" />
          {isApp ? (
            <div className="plx-inlinemsg">Apps with sign-in are built by SOL, so there is nothing to pick here. Write the page name above, then tap the button below.</div>
          ) : (
            <>
              <div className="plx-starts" role="radiogroup" aria-label="How do you want to start?">
                {STARTS.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={start === s.id} className="plx-start" onClick={() => setStart(s.id)}>
                    <span className="plx-start__t">
                      {s.icon}
                      {s.title}
                    </span>
                    <span className="plx-start__d">{s.body}</span>
                  </button>
                ))}
              </div>
              {start === "design" ? (
                <div className="plx-hchips" role="radiogroup" aria-label="Choose a design">
                  {designs.map((d) => (
                    <button key={d.id} type="button" role="radio" aria-checked={design === d.id} className="plx-hchip" onClick={() => setDesign(d.id)} title={d.description}>
                      {d.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {start === "copy" ? (
                copyable.length ? (
                  <Select label="Which page?" value={copyId} onChange={(e) => setCopyId(e.target.value)} options={copyable.map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a page" />
                ) : (
                  <p className="plx-small">You only have your home page so far. Copying works once you have another page.</p>
                )
              ) : null}
              {start === "code" ? (
                <div>
                  <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <Button variant="secondary" leftIcon={<Upload size={18} aria-hidden />} onClick={() => fileRef.current?.click()}>
                    {file ? file.name : "Choose a file"}
                  </Button>
                  <p className="plx-small" style={{ marginTop: 8 }}>
                    One .html file. We keep your code exactly as it is.
                  </p>
                </div>
              ) : null}
              {siteIsClassic && start === "design" ? <p className="plx-small">This page will use our newest editor.</p> : null}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
