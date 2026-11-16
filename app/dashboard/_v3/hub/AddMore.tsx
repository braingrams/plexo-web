"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarClock, Mail, MessagesSquare, Newspaper, ShoppingBag } from "lucide-react";
import { Button, ButtonLink, Card, Modal, useToast } from "../ui";
import { addOnsFor, hubTabHref, type AddOnId, type HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { errMsg, hubApi } from "./hubApi";

const ICON: Record<AddOnId, React.ReactNode> = {
  store: <ShoppingBag size={22} aria-hidden />,
  blog: <Newspaper size={22} aria-hidden />,
  course: <BookOpen size={22} aria-hidden />,
  bookings: <CalendarClock size={22} aria-hidden />,
  newsletter: <Mail size={22} aria-hidden />,
};

const WHAT: Record<AddOnId, { title: string; lead: string; items: string[]; go: string }> = {
  store: { title: "Start selling", lead: "We'll set up everything a shop needs. You don't have to design anything.", items: ["A shop page that shows your products", "A basket and checkout", "A thank-you page and order tracking"], go: "Turn on my shop" },
  bookings: { title: "Take bookings", lead: "People pick a service and pay for it. We set up the shop part for you.", items: ["A shop page for your services", "Checkout and payment", "You add your first service next"], go: "Turn on bookings" },
  blog: { title: "Add a blog", lead: "A place for your news and stories, ready to fill.", items: ["A blog page on your site", "A page for each post", "You write your first post next"], go: "Add my blog" },
  course: { title: "Add a course", lead: "People sign up and learn from your lessons.", items: ["Your home page becomes the sign-up page (your other pages stay as they are)", "A first lesson to start from", "You add the rest next"], go: "Make it a course" },
  newsletter: { title: "Add an email sign-up", lead: "SOL adds a sign-up form where you want it, and you can ask for changes.", items: [], go: "Ask SOL to add it" },
};

/** The "Add more to your site" cards. Each turns a feature on as a short guided task and lands where the next step is. */
export function AddMoreCards({ siteId, siteName, features }: { siteId: string; siteName: string; features: HubFeatures }) {
  const router = useRouter();
  const { show } = useToast();
  const [which, setWhich] = useState<AddOnId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = addOnsFor(features);
  if (!cards.length) return null;
  const what = which ? WHAT[which] : null;

  async function run() {
    if (!which) return;
    setBusy(true);
    setError(null);
    try {
      let next: string = hubTabHref(siteId, "pages");
      if (which === "store" || which === "bookings") {
        await hubApi(`/api/v1/commerce/${siteId}/settings`, { method: "PUT", json: { enabled: true } }, "We couldn't turn your shop on. Please try again.");
        next = `${hubTabHref(siteId, "products")}${which === "bookings" ? "&new=service" : ""}`;
      } else if (which === "blog") {
        await hubApi(`/api/blog/${siteId}/site`, { method: "PATCH", json: { enabled: true } }, "We couldn't turn your blog on. Please try again.");
        next = hubTabHref(siteId, "blog");
      } else if (which === "course") {
        await hubApi("/api/v1/lms/funnels", { method: "POST", json: { templateId: siteId } }, "We couldn't set up your course. Please try again.");
        next = hubTabHref(siteId, "course");
      }
      show({ title: `${what?.title ?? "Done"}: done`, description: "It's ready. Here's the next step.", tone: "success" });
      setWhich(null);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const solHref = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Add an email sign-up form to my site "${siteName}".`)}`;

  return (
    <section aria-labelledby="addmore" data-tour="hub-add-more" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 id="addmore" className="plx-h2">Add more to your site</h2>
        <p className="plx-hub__sub">Turn these on whenever you need them. Each one takes about a minute.</p>
      </div>
      <div className="plx-hub__grid">
        {cards.map((c) => (
          <Card key={c.id} className="plx-addon">
            <span className="plx-addon__ic">{ICON[c.id]}</span>
            <div>
              <h3 className="plx-h3">{c.title}</h3>
              <p>{c.body}</p>
            </div>
            <Button variant="secondary" onClick={() => { setError(null); setWhich(c.id); }}>
              {c.action}
            </Button>
          </Card>
        ))}
      </div>
      <Modal
        open={!!which}
        onClose={() => setWhich(null)}
        title={what?.title ?? ""}
        description={what?.lead}
        closeOnBackdrop={!busy}
        footer={
          which === "newsletter" ? (
            <ButtonLink href={solHref} leftIcon={<MessagesSquare size={18} aria-hidden />}>{what?.go}</ButtonLink>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setWhich(null)}>Not now</Button>
              <Button loading={busy} onClick={run}>{what?.go}</Button>
            </>
          )
        }
      >
        {what && what.items.length ? (
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {what.items.map((i) => (
              <li key={i} className="plx-body" style={{ color: "var(--plx-text)" }}>{i}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="plx-field__error" role="alert" style={{ marginTop: 16 }}>{error}</p> : null}
      </Modal>
    </section>
  );
}
