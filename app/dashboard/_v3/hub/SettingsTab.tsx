"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppWindow, BookOpen, ChevronRight, CornerUpRight, Database, Download, GraduationCap, MessageSquare, PanelTop, ShoppingBag, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button, Card, Input, useToast } from "../ui";
import { builderLabel } from "./HubFrame";
import type { HubFrameSite } from "./HubFrame";
import type { HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { TabBar } from "./HubFrame";
import { LinkPending } from "../ui/LinkPending";
import { errMsg, hubApi } from "./hubApi";
import { advancedHref, advancedKind } from "@/lib/dashboardV3/hubAdvanced";

export function SettingsTab({ site, features, experience }: { site: HubFrameSite; features: HubFeatures; experience: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [name, setName] = useState(site.name);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rename() {
    if (!name.trim()) return setError("Please type a name for your site.");
    setBusy("save");
    setError(null);
    try {
      await hubApi(`/api/templates/${site.id}`, { method: "PATCH", json: { name: name.trim() } }, "We couldn't rename your site. Please try again.");
      show({ title: "Name saved", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete "${site.name}" for good? Its pages, and anything on it, will be gone. This can't be undone.`)) return;
    setBusy("delete");
    try {
      await hubApi(`/api/templates/${site.id}`, { method: "DELETE" }, "We couldn't delete this site. Please try again.");
      router.push("/dashboard/sites");
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  const pro = experience === "pro";
  const nameChanged = name.trim() !== site.name && name.trim() !== "";
  const shopLinks: Row[] = [
    ...(features.store ? [{ href: `/dashboard/commerce/${site.id}/settings`, icon: ShoppingBag, title: "Shop settings", desc: "Payments, delivery and checkout." }] : []),
    ...(features.blog ? [{ href: `/dashboard/templates/${site.id}/blog/settings`, icon: BookOpen, title: "Blog settings", desc: "Comments, authors and how posts look." }] : []),
    ...(features.course ? [{ href: `/dashboard/funnels/${site.id}/settings`, icon: GraduationCap, title: "Course price and settings", desc: "What learners pay and how they join." }] : []),
  ];
  // Pros with a website get these tools in place, inside Advanced. Everyone else keeps the simple pages.
  const inAdvanced = pro && advancedKind(features) === "site";
  const pageLinks: Row[] = [
    { href: inAdvanced ? advancedHref(site.id, "forms") : `/dashboard/templates/${site.id}/form-submissions`, icon: MessageSquare, title: "Form replies", desc: "Read what visitors send you and choose where it goes." },
    { href: inAdvanced ? advancedHref(site.id, "redirects") : `/dashboard/templates/${site.id}/redirects`, icon: CornerUpRight, title: "Old links", desc: "Send an old web address to a new page so nobody hits a dead end." },
    { href: inAdvanced ? advancedHref(site.id, "layout") : `/dashboard/templates/${site.id}/site-layout`, icon: PanelTop, title: "Top and bottom of every page", desc: "Edit the header and footer once for the whole site." },
    { href: inAdvanced ? advancedHref(site.id, "copy") : `/dashboard/templates/${site.id}/site-import`, icon: Download, title: "Bring in pages", desc: "Copy pages over from another site." },
    ...(pro ? [{ href: inAdvanced ? advancedHref(site.id, "lists") : `/dashboard/templates/${site.id}/content-types`, icon: Database, title: "Your own lists", desc: "Keep lists like team members or events and show them on pages." }] : []),
  ];
  const advancedLinks: Row[] = [
    { href: advancedHref(site.id), icon: SlidersHorizontal, title: "Advanced settings", desc: `Search, code, servers, GitHub and more for ${builderLabel(site)}.` },
    { href: "/dashboard/apps", icon: AppWindow, title: "My apps", desc: "See every app you have built." },
  ];
  return (
    <>
      <TabBar title="Settings" sub="Everything about this site, in one place." />
      <div className="plx-hs plx-hs--solo" data-tour="hub-settings">
        <div className="plx-hs__body">
          <section id="set-general" className="plx-hs__sec">
            <h3 className="plx-hs__h">General</h3>
            <Card padding="none">
              <div className="plx-hs__row">
                <div className="plx-hs__lab">
                  <b>Site name</b>
                  <span>Only you see this. Visitors see what is on your pages.</span>
                </div>
                <form className="plx-hs__ctl" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <Input label="Site name" hideLabel value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} />
                  <Button type="submit" loading={busy === "save"} disabled={!nameChanged}>Save</Button>
                </form>
              </div>
            </Card>
          </section>

          {shopLinks.length ? (
            <section id="set-more" className="plx-hs__sec">
              <h3 className="plx-hs__h">Shop, blog and course</h3>
              <LinkTiles rows={shopLinks} />
            </section>
          ) : null}

          <section id="set-pages" className="plx-hs__sec">
            <h3 className="plx-hs__h">Pages and visitors</h3>
            <LinkTiles rows={pageLinks} />
          </section>

          {pro ? (
            <section id="set-advanced" className="plx-hs__sec">
              <h3 className="plx-hs__h">Advanced</h3>
              <LinkTiles rows={advancedLinks} />
            </section>
          ) : null}

          <section id="set-danger" className="plx-hs__sec plx-hs__sec--danger">
            <h3 className="plx-hs__h">Delete</h3>
            <Card padding="none" className="plx-hs__danger">
              <div className="plx-hs__row">
                <div className="plx-hs__lab">
                  <b>Delete this site</b>
                  <span>Removes the site and all its pages. You can&apos;t get it back.</span>
                </div>
                <div className="plx-hs__ctl plx-hs__ctl--end">
                  <Button variant="danger" loading={busy === "delete"} onClick={remove}>Delete site</Button>
                </div>
              </div>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}

type Row = { href: string; icon: LucideIcon; title: string; desc: string };

function LinkTiles({ rows }: { rows: Row[] }) {
  return (
    <div className="plx-hs__tiles">
      {rows.map(({ href, icon: Icon, title, desc }) => (
        <Link key={href} href={href} className="plx-hs__tile">
          <span className="plx-hs__ico" aria-hidden><Icon size={20} /></span>
          <span className="plx-hs__txt">
            <b>{title}</b>
            <span>{desc}</span>
          </span>
          <ChevronRight size={18} className="plx-hs__go" aria-hidden />
          <LinkPending />
        </Link>
      ))}
    </div>
  );
}
