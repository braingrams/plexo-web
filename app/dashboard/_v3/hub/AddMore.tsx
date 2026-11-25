"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRight, Check, Clock, HeartHandshake } from "lucide-react";
import { Button, ButtonLink, Modal, useToast } from "../ui";
import { addOnsFor, hubTabHref, type AddOnId, type HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { solStudioHref } from "@/lib/dashboardV3/solStudioLink";
import { addMoreExample, type ExamplePage } from "@/lib/dashboardV3/addMoreExamples";
import { errMsg, hubApi } from "./hubApi";
import { TourAnchorAbsent } from "../tour/TourAnchorAbsent";

/** A little picture of what each add-on gives you, drawn with tokens so it follows the theme. */
function Art({ id }: { id: AddOnId }) {
  switch (id) {
    case "store":
      return (
        <span className="plx-art plx-art--store" aria-hidden>
          {[0, 1, 2].map((n) => (
            <span key={n} className="plx-art__prod"><i /><b /><u /></span>
          ))}
        </span>
      );
    case "blog":
      return (
        <span className="plx-art plx-art--blog" aria-hidden>
          <span className="plx-art__post"><i /><b /><u /><u /></span>
          <span className="plx-art__post plx-art__post--2"><i /><b /><u /></span>
        </span>
      );
    case "course":
      return (
        <span className="plx-art plx-art--course" aria-hidden>
          <span className="plx-art__video"><span /></span>
          <span className="plx-art__lessons"><b /><b /><b /></span>
        </span>
      );
    case "bookings":
      return (
        <span className="plx-art plx-art--bookings" aria-hidden>
          <span className="plx-art__cal">{Array.from({ length: 21 }, (_, n) => <i key={n} className={n === 9 ? "on" : n === 16 ? "dot" : ""} />)}</span>
          <span className="plx-art__slot"><Clock size={12} />10:30</span>
        </span>
      );
    case "donations":
      return (
        <span className="plx-art plx-art--donations" aria-hidden style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <HeartHandshake size={32} style={{ color: "var(--plx-brand)" }} />
        </span>
      );
    default:
      return (
        <span className="plx-art plx-art--news" aria-hidden>
          <span className="plx-art__form"><i /><b>Join</b></span>
          <span className="plx-art__note"><u /><u /></span>
        </span>
      );
  }
}

const WHAT: Record<AddOnId, { title: string; lead: string; items: string[]; go: string }> = {
  store: { title: "Start selling", lead: "We'll set up everything a shop needs. You don't have to design anything.", items: ["A shop page that shows your products", "A basket and checkout", "A thank-you page and order tracking"], go: "Turn on my shop" },
  donations: { title: "Accept donations", lead: "Take gifts from supporters, one-off or every month. We set up everything you need.", items: ["A donation form for your site", "One-off and monthly gifts by card or bank transfer", "Track every gift and donor in your hub"], go: "Turn on donations" },
  bookings: { title: "Take bookings", lead: "People pick a service and pay for it. We set up the shop part for you.", items: ["A shop page for your services", "Checkout and payment", "You add your first service next"], go: "Turn on bookings" },
  blog: { title: "Add a blog", lead: "A place for your news and stories, ready to fill.", items: ["A blog page on your site", "A page for each post", "You write your first post next"], go: "Add my blog" },
  course: { title: "Add a course", lead: "People sign up and learn from your lessons.", items: ["Your home page becomes the sign-up page (your other pages stay as they are)", "A first lesson to start from", "You add the rest next"], go: "Make it a course" },
  newsletter: { title: "Add an email sign-up", lead: "SOL adds a sign-up form where you want it, and you can ask for changes.", items: ["A sign-up form placed on your page", "Ask SOL to move it or change how it looks"], go: "Ask SOL to add it" },
};

/** The "Add more to your site" cards. Each turns a feature on as a short guided task and lands where the next step is. */
export function AddMoreCards({ siteId, siteName, features, pages = [] }: { siteId: string; siteName: string; features: HubFeatures; /** The site's pages today, so the dialog can show what changes on THIS site. */ pages?: ExamplePage[] }) {
  const router = useRouter();
  const { show } = useToast();
  const [which, setWhich] = useState<AddOnId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = addOnsFor(features);
  // Nothing to add (an app manages its own features through SOL): tell the walkthrough, so it does not wait for this section.
  if (!cards.length) return <TourAnchorAbsent anchor="hub-add-more" />;
  const what = which ? WHAT[which] : null;
  const example = which ? addMoreExample(which, siteName, pages) : null;

  async function run() {
    if (!which) return;
    setBusy(true);
    setError(null);
    try {
      let next: string = hubTabHref(siteId, "pages");
      if (which === "store" || which === "bookings") {
        await hubApi(`/api/v1/commerce/${siteId}/settings`, { method: "PUT", json: { enabled: true } }, "We couldn't turn your shop on. Please try again.");
        next = `${hubTabHref(siteId, "products")}${which === "bookings" ? "&new=service" : ""}`;
      } else if (which === "donations") {
        await hubApi(`/api/v1/commerce/${siteId}/settings`, { method: "PUT", json: { donationsEnabled: true } }, "We couldn't turn donations on. Please try again.");
        next = `/dashboard/sites/${siteId}?tab=shop&section=donations`;
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

  const solHref = solStudioHref(`Add an email sign-up form to my site "${siteName}".`, { siteId });

  return (
    <>
    <section aria-labelledby="addmore" data-tour="hub-add-more" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TourAnchorAbsent anchor="hub-add-more" absent={false} />
      <div>
        <h2 id="addmore" className="plx-h2">Add more to your site</h2>
        <p className="plx-hub__sub">Turn these on whenever you need them. They are added to &ldquo;{siteName}&rdquo;, the site you are in, not to a new one. Each takes about a minute.</p>
      </div>
      <div className="plx-aogrid">
        {cards.map((c) => (
          <button key={c.id} type="button" className={`plx-ao plx-ao--${c.id}`} onClick={() => { setError(null); setWhich(c.id); }}>
            <span className="plx-ao__art"><Art id={c.id} /></span>
            <span className="plx-ao__txt">
              <b>{c.title}</b>
              <span>{c.body}</span>
            </span>
            <span className="plx-ao__foot">
              <span className="plx-ao__time"><Clock size={13} aria-hidden /> 1 min</span>
              <span className="plx-ao__go" title={c.action}><span className="plx-ao__golabel">{c.action}</span><ArrowRight size={16} aria-hidden /></span>
            </span>
          </button>
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
            <ButtonLink href={solHref} leftIcon={<SolGlyph size={18} />}>{what?.go}</ButtonLink>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setWhich(null)}>Not now</Button>
              <Button loading={busy} onClick={run}>{what?.go}</Button>
            </>
          )
        }
      >
        {which && what ? (
          <div className={`plx-aomodal plx-ao--${which}`}>
            <div className="plx-aomodal__art"><Art id={which} /></div>
            {example ? (
              <div className="plx-aomodal__same" role="note">
                <p className="plx-aomodal__samehead">Added to &ldquo;{siteName}&rdquo;, the same website</p>
                {example.today ? <p>Your pages today: <b>{example.today}</b></p> : null}
                {example.adds.length ? <p>New pages added: <b>{example.adds.join(", ")}</b></p> : null}
                {example.summary ? <p>{example.summary}</p> : null}
              </div>
            ) : null}
            <p className="plx-aomodal__h">What you get</p>
            <ul className="plx-aomodal__list">
              {what.items.map((i) => (
                <li key={i}><span aria-hidden><Check size={14} strokeWidth={3} /></span>{i}</li>
              ))}
            </ul>
            <p className="plx-aomodal__note"><Clock size={14} aria-hidden /> Takes about a minute. You stay in control of everything it adds.</p>
          </div>
        ) : null}
        {error ? <GateOrError error={error}><p className="plx-field__error" role="alert" style={{ marginTop: 16 }}>{error}</p></GateOrError> : null}
      </Modal>
    </section>
    <FloatingAddMoreButton />
    </>
  );
}

export function FloatingAddMoreButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => {
      const el = document.getElementById("addmore");
      if (!el) {
        setVisible(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      setVisible(rect.top > window.innerHeight * 0.7);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check, { passive: true });
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="plx-floating-cta">
      <button
        type="button"
        className="plx-floating-btn"
        onClick={() => {
          const el = document.getElementById("addmore");
          el?.scrollIntoView({ behavior: "smooth" });
        }}
        aria-label="Add more to your site"
      >
        <span>Add more to your site</span>
        <ArrowDown size={16} aria-hidden />
      </button>
    </div>
  );
}
