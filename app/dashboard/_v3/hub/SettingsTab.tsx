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
import { errMsg, hubApi } from "./hubApi";

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
  const pageLinks: Row[] = [
    { href: `/dashboard/templates/${site.id}/form-submissions`, icon: MessageSquare, title: "Form replies", desc: "Read what visitors send you and choose where it goes." },
    { href: `/dashboard/templates/${site.id}/redirects`, icon: CornerUpRight, title: "Old links", desc: "Send an old web address to a new page so nobody hits a dead end." },
    { href: `/dashboard/templates/${site.id}/site-layout`, icon: PanelTop, title: "Top and bottom of every page", desc: "Edit the header and footer once for the whole site." },
    { href: `/dashboard/templates/${site.id}/site-import`, icon: Download, title: "Bring in pages", desc: "Copy pages over from another site." },
    ...(pro ? [{ href: `/dashboard/templates/${site.id}/content-types`, icon: Database, title: "Your own lists", desc: "Keep lists like team members or events and show them on pages." }] : []),
  ];
  const advancedLinks: Row[] = [
    { href: `/dashboard/templates/${site.id}/detail?classic=1`, icon: SlidersHorizontal, title: "Advanced site settings", desc: `This site uses ${builderLabel(site)}.` },
    { href: "/dashboard/apps", icon: AppWindow, title: "My apps", desc: "See every app you have built." },
  ];
  const sections = [
    { id: "set-general", label: "General" },
    ...(shopLinks.length ? [{ id: "set-more", label: "Shop, blog and course" }] : []),
    { id: "set-pages", label: "Pages and visitors" },
    ...(pro ? [{ id: "set-advanced", label: "Advanced" }] : []),
    { id: "set-danger", label: "Delete" },
  ];

  return (
    <>
      <TabBar title="Settings" sub="Everything about this site, in one place." />
      <div className="plx-set" data-tour="hub-settings">
        <nav className="plx-set__nav" aria-label="Settings sections">
          {sections.map((x) => (
            <a key={x.id} href={`#${x.id}`}>{x.label}</a>
          ))}
        </nav>
        <div className="plx-set__body">
          <section id="set-general" className="plx-set__sec">
            <h3 className="plx-set__h">General</h3>
            <Card padding="none">
              <div className="plx-set__row">
                <div className="plx-set__lab">
                  <b>Site name</b>
                  <span>Only you see this. Visitors see what is on your pages.</span>
                </div>
                <form className="plx-set__ctl" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <Input label="Site name" hideLabel value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} />
                  <Button type="submit" loading={busy === "save"} disabled={!nameChanged}>Save</Button>
                </form>
              </div>
            </Card>
          </section>

          {shopLinks.length ? (
            <section id="set-more" className="plx-set__sec">
              <h3 className="plx-set__h">Shop, blog and course</h3>
              <LinkTiles rows={shopLinks} />
            </section>
          ) : null}

          <section id="set-pages" className="plx-set__sec">
            <h3 className="plx-set__h">Pages and visitors</h3>
            <LinkTiles rows={pageLinks} />
          </section>

          {pro ? (
            <section id="set-advanced" className="plx-set__sec">
              <h3 className="plx-set__h">Advanced</h3>
              <LinkTiles rows={advancedLinks} />
            </section>
          ) : null}

          <section id="set-danger" className="plx-set__sec">
            <h3 className="plx-set__h">Delete</h3>
            <Card padding="none" className="plx-set__danger">
              <div className="plx-set__row">
                <div className="plx-set__lab">
                  <b>Delete this site</b>
                  <span>Removes the site and all its pages. You can&apos;t get it back.</span>
                </div>
                <div className="plx-set__ctl plx-set__ctl--end">
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
    <div className="plx-set__tiles">
      {rows.map(({ href, icon: Icon, title, desc }) => (
        <Link key={href} href={href} className="plx-set__tile">
          <span className="plx-set__ico" aria-hidden><Icon size={20} /></span>
          <span className="plx-set__txt">
            <b>{title}</b>
            <span>{desc}</span>
          </span>
          <ChevronRight size={18} className="plx-set__go" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
