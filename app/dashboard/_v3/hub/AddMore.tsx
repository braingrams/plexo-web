"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRight, BookOpen, Calendar, Check, Clock, GraduationCap, HeartHandshake, Mail, ShoppingBag } from "lucide-react";
import { Button, ButtonLink, Modal, useToast } from "../ui";
import { addOnsFor, hubTabHref, type AddOnId, type HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { addMoreExample, type ExamplePage } from "@/lib/dashboardV3/addMoreExamples";
import { errMsg, hubApi } from "./hubApi";

function AddOnIcon({ id }: { id: AddOnId }) {
  switch (id) {
    case "store":
      return <ShoppingBag size={22} aria-hidden />;
    case "blog":
      return <BookOpen size={22} aria-hidden />;
    case "course":
      return <GraduationCap size={22} aria-hidden />;
    case "bookings":
      return <Calendar size={22} aria-hidden />;
    case "donations":
      return <HeartHandshake size={22} aria-hidden />;
    default:
      return <Mail size={22} aria-hidden />;
  }
}

/** Clean icon badge representation for add-ons, following the brand tokens. */
function Art({ id }: { id: AddOnId }) {
  return (
    <div className="plx-aomodal__badge" aria-hidden>
      <AddOnIcon id={id} />
    </div>
  );
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
  if (!cards.length) return null;
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

  const solHref = `/dashboard/sol?new=1&draft=${encodeURIComponent(`Add an email sign-up form to my site "${siteName}".`)}`;

  return (
    <>
    <section aria-labelledby="addmore" data-tour="hub-add-more" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 id="addmore" className="plx-h2">Add more to your site</h2>
        <p className="plx-hub__sub">Turn these on whenever you need them. They are added to &ldquo;{siteName}&rdquo;, the site you are in, not to a new one. Each takes about a minute.</p>
      </div>
      <div className="plx-aogrid">
        {cards.map((c) => (
          <button key={c.id} type="button" className={`plx-ao plx-ao--${c.id}`} onClick={() => { setError(null); setWhich(c.id); }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 12 }}>
              <span className="plx-ao__badge" aria-hidden>
                <AddOnIcon id={c.id} />
              </span>
              <span className="plx-ao__time">
                <Clock size={12} aria-hidden /> 1 min setup
              </span>
            </div>
            <div className="plx-ao__txt">
              <b>{c.title}</b>
              <span>{c.body}</span>
            </div>
            <div className="plx-ao__foot">
              <span className="plx-ao__go" title={c.action}>
                <span className="plx-ao__golabel">{c.action}</span>
                <ArrowRight size={15} aria-hidden />
              </span>
            </div>
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
