"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, FileText, Pencil, Search } from "lucide-react";
import { Button, Modal } from "../ui";
import { buildPageChoices, searchPageChoices, type PageChoice, type PickablePage } from "@/lib/dashboardV3/pickPage";

/**
 * "Edit website": asks which page to change (Home, About, …) and then opens it. A site with only its homepage opens straight
 * away, since there is nothing to choose.
 */
export function EditWebsiteButton({ siteId, fallbackHref, label = "Edit website", variant, onStart }: { siteId: string; fallbackHref: string; /** What the button says (a brand-new site says "Review and edit your pages"). */ label?: string; variant?: "primary" | "secondary"; /** Called when editing starts, so the next-steps panel can tick "Review". */ onStart?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<PageChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  async function start() {
    onStart?.();
    setError(null);
    setQuery("");
    setOpen(true);
    if (choices) return;
    try {
      const res = await fetch(`/api/templates/${siteId}/pages`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { rootId: string; pages: PickablePage[] };
      const list = buildPageChoices(data.pages, data.rootId);
      if (list.length <= 1) {
        // Only the homepage: nothing to pick.
        setOpening(list[0]?.id ?? "home");
        router.push(list[0]?.href ?? fallbackHref);
        return;
      }
      setChoices(list);
    } catch {
      setError("We couldn't load your pages. You can still open the homepage.");
    }
  }

  useEffect(() => {
    if (choices) search.current?.focus();
  }, [choices]);

  const shown = choices ? searchPageChoices(choices, query) : [];
  const go = (c: { id: string; href: string }) => {
    setOpening(c.id);
    router.push(c.href);
  };

  return (
    <>
      <Button variant={variant} leftIcon={<Pencil size={16} aria-hidden />} onClick={() => void start()}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => (opening ? undefined : setOpen(false))}
        title="Which page do you want to change?"
        description="Pick a page and we'll open it so you can change how it looks and what it says."
        width={520}
        footer={<Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
      >
        {error ? (
          <div role="alert" style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>{error}</p>
            <Button onClick={() => router.push(fallbackHref)}>Open the homepage</Button>
          </div>
        ) : !choices ? (
          <p role="status" style={{ margin: 0 }}>{opening ? "Opening…" : "Loading your pages…"}</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {choices.length > 6 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--plx-border)", borderRadius: 10, padding: "0 12px", minHeight: 44 }}>
                <Search size={16} aria-hidden />
                <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your pages" aria-label="Search your pages" style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: "inherit", font: "inherit", minHeight: 40 }} />
              </label>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6, maxHeight: "min(52vh, 420px)", overflowY: "auto" }}>
              {shown.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => go(c)} disabled={Boolean(opening)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "8px 12px", paddingLeft: 12 + c.depth * 18, borderRadius: 10, border: "1px solid var(--plx-border)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
                    {c.isHome ? <Home size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
                    <span style={{ fontWeight: 600 }}>{c.label}</span>
                    <span style={{ opacity: 0.6, fontSize: "0.8rem", marginLeft: "auto" }}>{opening === c.id ? "Opening…" : c.isHome ? "Your homepage" : c.path}</span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li style={{ opacity: 0.7, padding: 8 }}>No page matches “{query}”.</li>}
            </ul>
          </div>
        )}
      </Modal>
    </>
  );
}
