"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, ImagePlus, FileText } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, OptimisticLoader, Skeleton, Textarea, useToast } from "../../ui";
import { seoGap, seoLengthHint, type SeoPageRow } from "@/lib/dashboardV3/hubAdvanced";
import { errMsg, hubApi } from "../hubApi";

type Row = SeoPageRow & { isRoot: boolean };

/** Title, description and share picture for every page, what the site looks like on Google, and what Plexo already does for search. */
export function SeoSection({ siteId, siteName, address }: { siteId: string; siteName: string; address: string | null }) {
  const { show } = useToast();
  const [pages, setPages] = useState<Row[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; description: string; image: string } | null>(null);
  const [favicon, setFavicon] = useState<string>("");
  const [faviconDraft, setFaviconDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"image" | "icon" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        hubApi<{ pages: Row[]; truncated: boolean }>(`/api/v1/templates/${siteId}/page-seo`),
        hubApi<{ favicon?: string }>(`/api/v1/templates/${siteId}/site-meta`).catch(() => ({ favicon: "" })),
      ]);
      setPages(d.pages);
      setTruncated(d.truncated);
      setFavicon(m.favicon ?? "");
      setPicked((p) => p ?? d.pages[0]?.id ?? null);
    } catch (e) {
      setError(errMsg(e, "We couldn't load your pages."));
      setPages([]);
    }
  }, [siteId]);
  useEffect(() => { void load(); }, [load]);

  const page = pages?.find((p) => p.id === picked) ?? null;
  useEffect(() => {
    if (page) {
      setDraft({ title: page.title, description: page.description, image: page.image });
      setFaviconDraft(null);
      setError(null);
    }
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(file: File, kind: "image" | "icon") {
    setUploading(kind);
    try {
      const body = new FormData();
      body.append("file", file);
      const { url } = await hubApi<{ url: string }>("/api/v1/media/upload", { method: "POST", body }, "We couldn't upload that picture. Try a smaller one.");
      if (kind === "image") setDraft((d) => (d ? { ...d, image: url } : d));
      else setFaviconDraft(url);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    if (!page || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await hubApi(`/api/v1/templates/${siteId}/page-seo`, { method: "PUT", json: { pageId: page.id, htmlTitle: draft.title, metaDescription: draft.description, ogImageUrl: draft.image } }, "We couldn't save that. Please try again.");
      if (page.isRoot && faviconDraft !== null) {
        await hubApi(`/api/v1/templates/${siteId}/site-meta`, { method: "PUT", json: { favicon: faviconDraft } }, "We couldn't save the small icon.");
        setFavicon(faviconDraft);
        setFaviconDraft(null);
      }
      setPages((all) => all?.map((p) => (p.id === page.id ? { ...p, title: draft.title.trim(), description: draft.description.trim(), image: draft.image.trim() } : p)) ?? all);
      show({ title: "Saved", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const host = address ? `https://${address}` : null;
  const dirty = !!page && !!draft && (draft.title.trim() !== page.title || draft.description.trim() !== page.description || draft.image.trim() !== page.image || faviconDraft !== null);
  const shownFavicon = faviconDraft ?? favicon;

  return (
    <div className="plx-adv__stack">
      {pages === null ? (
        <Card><div style={{ padding: "32px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading SEO metadata" subtitle="Reading search tags and social share previews" steps={["Loading page meta tags…", "Generating search snippets…", "Ready."]} /></div></Card>
      ) : pages.length === 0 ? (
        <Card><p className="plx-body" role="alert">{error ?? "This site has no pages yet."}</p></Card>
      ) : (
        <div className="plx-adv__seo-split">
          <div className="plx-adv__stack">
            <Card>
              <CardHeader title={page ? (page.isRoot ? "Your home page" : page.name) : "Pick a page"} description="What Google and link previews show for this page." />
              {page && draft ? (
                page.isRaw ? (
                  <p className="plx-body">This page is your own code, so its title and description live in the code. Open it under <b>Code</b> and edit the title and description tags there.</p>
                ) : (
                  <form className="plx-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    <Input label="Title" help={seoLengthHint("title", draft.title) ?? "The big blue line on Google, and the text in the browser tab."} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={page.name || siteName} />
                    <Textarea label="Short description" help={seoLengthHint("description", draft.description) ?? "One or two sentences under the title on Google and in shared links."} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3} />
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                      <span className="plx-hrow__thumb" style={{ width: 64, height: 64 }}>{draft.image ? <img src={draft.image} alt="" /> : <ImagePlus size={22} aria-hidden />}</span>
                      <input ref={imageRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "image")} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <b style={{ fontSize: 14 }}>Picture for shared links</b>
                        <span className="plx-small">Shown when this page is shared on WhatsApp, Facebook or X. A wide picture works best.</span>
                      </div>
                      <Button variant="secondary" type="button" loading={uploading === "image"} onClick={() => imageRef.current?.click()}>{draft.image ? "Change picture" : "Add a picture"}</Button>
                      {draft.image ? <Button variant="ghost" type="button" onClick={() => setDraft({ ...draft, image: "" })}>Remove</Button> : null}
                    </div>
                    {page.isRoot ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <span className="plx-hrow__thumb" style={{ width: 48, height: 48 }}>{shownFavicon ? <img src={shownFavicon} alt="" /> : <Globe size={20} aria-hidden />}</span>
                        <input ref={iconRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "icon")} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <b style={{ fontSize: 14 }}>Small icon</b>
                          <span className="plx-small">The tiny picture in the browser tab. A square works best.</span>
                        </div>
                        <Button variant="secondary" type="button" loading={uploading === "icon"} onClick={() => iconRef.current?.click()}>{shownFavicon ? "Change icon" : "Add an icon"}</Button>
                      </div>
                    ) : null}
                    {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
                    <div><Button type="submit" loading={busy} disabled={!dirty}>Save</Button></div>
                  </form>
                )
              ) : null}
            </Card>
            {page && draft && !page.isRaw ? (
              <div className="plx-adv__preview" aria-label="How this page looks on Google">
                <span className="u">{host ?? "yoursite.com"}{page.path === "/" ? "" : page.path}</span>
                <span className="t">{draft.title.trim() || page.name || siteName}</span>
                <span className="d">{draft.description.trim() || "No description yet. Google will pick some words from the page."}</span>
              </div>
            ) : null}
          </div>
          <Card padding="none">
            <div style={{ padding: "16px 16px 8px" }}><CardHeader title="Your pages" titleAs="h3" description="Pick one to change how it appears in search." /></div>
            <div className="plx-adv__pages">
              {pages.map((p) => {
                const gap = seoGap(p);
                return (
                  <button key={p.id} type="button" className="plx-adv__page-btn" aria-pressed={p.id === picked} onClick={() => setPicked(p.id)}>
                    <FileText size={18} aria-hidden />
                    <span className="n"><b>{p.isRoot ? "Home" : p.name}</b><span>{p.isRaw ? `${p.path}, your own code` : gap || p.path}</span></span>
                    {!p.isRaw && gap ? <Badge tone="warning">To do</Badge> : null}
                  </button>
                );
              })}
            </div>
            {truncated ? <p className="plx-small" style={{ padding: 16 }}>Showing the first 200 pages.</p> : null}
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Plexo already does this for you" description="You don't have to set any of it up." />
        <div className="plx-adv__facts">
          <div className="plx-adv__fact"><b>Sitemap</b>{host ? <a href={`${host}/sitemap.xml`} target="_blank" rel="noreferrer">{address}/sitemap.xml</a> : <span>A list of every live page for Google, made as soon as your site has a web address.</span>}</div>
          <div className="plx-adv__fact"><b>Robots file</b>{host ? <a href={`${host}/robots.txt`} target="_blank" rel="noreferrer">{address}/robots.txt</a> : <span>Tells search engines what they may read.</span>}</div>
          <div className="plx-adv__fact"><b>Main address</b><span>Every page names its own address, so Google never counts the same page twice.</span></div>
          <div className="plx-adv__fact"><b>Business details for Google</b><span>A short description of your site is added to every page so Google understands what it is.</span></div>
          <div className="plx-adv__fact"><b>Unfinished work stays hidden</b><span>Preview addresses are kept out of Google. A page you wrote yourself that says &quot;noindex&quot; is left out of the sitemap too.</span></div>
        </div>
      </Card>
    </div>
  );
}
