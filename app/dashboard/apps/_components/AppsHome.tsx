"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, BookOpen, Briefcase, CalendarClock, Check, CheckCircle2, CreditCard, FileText, FolderOpen, Globe,
  GraduationCap, ListChecks, Loader2, LogIn, MessagesSquare, Newspaper, PenLine, Search, Share2, Star, TrendingUp, Users, type LucideIcon,
} from "lucide-react";
import { api, ApiError } from "./api";
import { timeAgo } from "./ui";
import { PageContainer } from "../../_components/PageContainer";

// The Apps home (wireframe "D"): pick up where you left off, or answer three quick questions —
// one at a time — while a preview of the app takes shape beside them. Plain words only.

export type HomeApp = { id: string; name: string; previewUrl: string | null; published: boolean; updatedAt: string | null; needsFix: boolean };

// ------------------------------------------------------------------ theme (light ↔ dark)

const ink = "var(--text-main)";
const muted = "var(--text-muted)";
const faint = "var(--text-faint)";
const surface = "var(--surface)";
const border = "color-mix(in srgb, var(--text-main) 16%, transparent)";
const fill = (pct: number) => `color-mix(in srgb, var(--text-main) ${pct}%, transparent)`;

// ------------------------------------------------------------------ the questions

type AudienceId = "customers" | "team" | "members" | "public";
type FeatureId =
  | "book" | "pay" | "signin" | "remind" | "reviews"
  | "tasks" | "files" | "approve" | "reports"
  | "lessons" | "progress" | "posts"
  | "browse" | "form" | "share" | "updates"
  | "other";

const AUDIENCES: Array<{ id: AudienceId; title: string; body: string; icon: LucideIcon; phrase: string }> = [
  { id: "customers", title: "My customers", body: "People who buy from you", icon: Users, phrase: "my customers" },
  { id: "team", title: "My team", body: "People you work with", icon: Briefcase, phrase: "my team" },
  { id: "members", title: "Members or students", body: "People who join or learn", icon: GraduationCap, phrase: "my members and students" },
  { id: "public", title: "Anyone online", body: "A tool for the public", icon: Globe, phrase: "anyone online" },
];

const FEATURES: Record<Exclude<FeatureId, "other">, { title: string; body: string; icon: LucideIcon; phrase: string; name: string }> = {
  book: { title: "Book a time", body: "Choose a day and time slot", icon: CalendarClock, phrase: "book a time", name: "Bookings" },
  pay: { title: "Pay", body: "Card or bank transfer", icon: CreditCard, phrase: "pay online", name: "Shop" },
  signin: { title: "Sign in", body: "Their own account", icon: LogIn, phrase: "sign in to their own account", name: "Members" },
  remind: { title: "Get reminders", body: "By email before it starts", icon: Bell, phrase: "get email reminders", name: "Reminders" },
  reviews: { title: "Leave reviews", body: "Stars and a few words", icon: Star, phrase: "leave reviews", name: "Reviews" },
  tasks: { title: "Track tasks", body: "Who's doing what, and when", icon: ListChecks, phrase: "track tasks and who owns them", name: "Team tasks" },
  files: { title: "Share files", body: "Everything in one place", icon: FolderOpen, phrase: "share files", name: "Team files" },
  approve: { title: "Approve requests", body: "Say yes or no in one tap", icon: CheckCircle2, phrase: "send and approve requests", name: "Requests" },
  reports: { title: "See reports", body: "Simple charts and totals", icon: BarChart3, phrase: "see simple reports and totals", name: "Reports" },
  lessons: { title: "Watch lessons", body: "Videos and notes in order", icon: BookOpen, phrase: "watch lessons in order", name: "Academy" },
  progress: { title: "Track progress", body: "See how far they've come", icon: TrendingUp, phrase: "track their progress", name: "Progress" },
  posts: { title: "Post and chat", body: "Talk with each other", icon: MessagesSquare, phrase: "post and chat with each other", name: "Community" },
  browse: { title: "Search and browse", body: "Find what they need", icon: Search, phrase: "search and browse listings", name: "Directory" },
  form: { title: "Fill in a form", body: "Sign-ups, requests or orders", icon: FileText, phrase: "fill in a form", name: "Sign-ups" },
  share: { title: "Share with friends", body: "Invite others in a tap", icon: Share2, phrase: "share it with friends", name: "Invites" },
  updates: { title: "Get updates", body: "News when something changes", icon: Newspaper, phrase: "get updates", name: "Updates" },
};

const FEATURES_FOR: Record<AudienceId, Array<Exclude<FeatureId, "other">>> = {
  customers: ["book", "pay", "signin", "remind", "reviews"],
  team: ["tasks", "files", "approve", "reports", "signin"],
  members: ["signin", "lessons", "progress", "pay", "posts"],
  public: ["browse", "form", "share", "updates", "signin"],
};

const STARTERS: Array<{ title: string; audience: AudienceId; features: FeatureId[]; name: string }> = [
  { title: "Bookings", audience: "customers", features: ["book", "pay", "remind"], name: "Bookings" },
  { title: "Sales tracker", audience: "team", features: ["tasks", "reports", "signin"], name: "Sales tracker" },
  { title: "Course portal", audience: "members", features: ["signin", "lessons", "progress", "pay"], name: "Academy" },
  { title: "Marketplace", audience: "public", features: ["browse", "form", "share"], name: "Marketplace" },
];

function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function describeAnswers(audience: AudienceId, features: FeatureId[], other: string, name: string): string {
  const a = AUDIENCES.find((x) => x.id === audience)!;
  const doing = features.filter((f): f is Exclude<FeatureId, "other"> => f !== "other").map((f) => FEATURES[f].phrase);
  const parts = [`Build an app for ${a.phrase}${doing.length ? ` where they can ${listPhrase(doing)}` : ""}.`];
  if (features.includes("other") && other.trim()) parts.push(`They should also be able to: ${other.trim()}.`);
  if (name.trim()) parts.push(`It's called ${name.trim()}.`);
  return parts.join(" ");
}

function suggestName(features: FeatureId[]): string {
  const first = features.find((f): f is Exclude<FeatureId, "other"> => f !== "other");
  return first ? FEATURES[first].name : "My app";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "your-app";

// ------------------------------------------------------------------ small pieces

function Tile({ icon: Icon, title, body, on, onClick }: { icon: LucideIcon; title: string; body: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="ah-tile"
      style={{ display: "flex", gap: 14, alignItems: "center", padding: 16, borderRadius: 16, textAlign: "left", fontFamily: "inherit", color: ink, cursor: "pointer", border: on ? `2px solid ${ink}` : `1px solid ${border}`, background: on ? fill(5) : surface, margin: on ? 0 : 1 }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: on ? ink : fill(8), color: on ? "var(--bg)" : muted }}>
        <Icon size={19} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 700 }}>{title}</span>
        <span style={{ display: "block", fontSize: 13, color: muted }}>{body}</span>
      </span>
      <span style={{ width: 24, height: 24, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", background: on ? ink : "transparent", border: on ? "none" : `1.5px solid ${border}`, color: "var(--bg)" }}>
        {on && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}

const primaryButton = (enabled: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: 15, fontWeight: 700, padding: "14px 24px", borderRadius: 13, border: "none",
  background: enabled ? ink : fill(22), color: "var(--bg)", cursor: enabled ? "pointer" : "default", transition: "background 0.2s",
});
const secondaryButton: CSSProperties = { fontFamily: "inherit", fontSize: 14.5, fontWeight: 600, padding: "13px 18px", borderRadius: 13, border: `1px solid ${border}`, background: surface, color: ink, cursor: "pointer" };
const linkButton: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: "var(--brand)", cursor: "pointer" };
const eyebrow: CSSProperties = { fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: muted };

function Thumb({ name, size }: { name: string; size: { w: number; h: number } }) {
  return (
    <span aria-hidden style={{ width: size.w, height: size.h, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: `repeating-linear-gradient(135deg, ${fill(4)} 0 8px, ${fill(8)} 8px 16px)`, color: muted, fontSize: Math.round(size.h * 0.36), fontWeight: 800 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function AppCard({ app, large }: { app: HomeApp; large?: boolean }) {
  return (
    <Link href={`/dashboard/apps/${app.id}`} className="ah-card" style={{ display: "flex", gap: 14, alignItems: "center", borderRadius: 14, background: surface, padding: 10, textDecoration: "none", color: ink, border: app.needsFix ? `1.5px solid ${ink}` : `1px solid ${border}`, minWidth: 0 }}>
      <Thumb name={app.name} size={large ? { w: 132, h: 84 } : { w: 116, h: 72 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.name}</span>
        <span style={{ display: "block", fontSize: 12.5, color: muted, marginTop: 2 }}>
          {app.published ? "● Live" : "○ Draft"} · {timeAgo(app.updatedAt)}
        </span>
      </span>
      {app.needsFix && <span style={{ padding: "6px 10px", borderRadius: 99, background: ink, color: "var(--bg)", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>Needs a fix</span>}
    </Link>
  );
}

// ------------------------------------------------------------------ live preview

function Bar({ w, o = 14, h = 6 }: { w: string; o?: number; h?: number }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 99, background: fill(o) }} />;
}

function Block({ id, other }: { id: FeatureId; other: string }) {
  const box: CSSProperties = { borderRadius: 10, border: `1px solid ${border}`, background: surface, padding: 10, display: "flex", flexDirection: "column", gap: 7, minHeight: 0 };
  const button = (label: string) => <span style={{ alignSelf: "flex-start", padding: "4px 10px", borderRadius: 7, background: ink, color: "var(--bg)", fontSize: 10, fontWeight: 700 }}>{label}</span>;
  switch (id) {
    case "book":
      return (
        <div style={box}>
          <Bar w="50%" o={22} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {Array.from({ length: 21 }, (_, i) => <span key={i} style={{ aspectRatio: "1", borderRadius: 3, background: [3, 4, 9, 15, 16].includes(i) ? ink : fill(8) }} />)}
          </div>
          {button("Book")}
        </div>
      );
    case "pay":
      return <div style={box}><Bar w="40%" o={22} /><span style={{ fontSize: 16, fontWeight: 800, color: ink }}>$49</span><Bar w="70%" />{button("Pay now")}</div>;
    case "signin":
      return <div style={box}><Bar w="45%" o={22} /><span style={{ height: 14, borderRadius: 5, border: `1px solid ${border}` }} /><span style={{ height: 14, borderRadius: 5, border: `1px solid ${border}` }} />{button("Sign in")}</div>;
    case "remind":
      return <div style={box}>{[0, 1, 2].map((i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><Bell size={11} color={muted} /><Bar w={`${70 - i * 15}%`} /></div>)}</div>;
    case "reviews":
      return <div style={box}><div style={{ display: "flex", gap: 2 }}>{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={12} fill={i < 4 ? "currentColor" : "none"} color={ink} />)}</div><Bar w="85%" /><Bar w="60%" /></div>;
    case "tasks":
      return <div style={box}>{[1, 1, 0, 0].map((d, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: d ? ink : "transparent", border: `1.5px solid ${d ? ink : border}` }} /><Bar w={`${75 - i * 10}%`} /></div>)}</div>;
    case "files":
      return <div style={{ ...box, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} style={{ aspectRatio: "4 / 5", borderRadius: 5, background: fill(i % 2 ? 8 : 12) }} />)}</div>;
    case "approve":
      return <div style={box}>{[0, 1].map((i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><Bar w="45%" /><span style={{ marginLeft: "auto", padding: "2px 7px", borderRadius: 6, background: ink, color: "var(--bg)", fontSize: 9, fontWeight: 700 }}>Yes</span><span style={{ padding: "2px 7px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 9, color: muted }}>No</span></div>)}</div>;
    case "reports":
      return <div style={{ ...box, flexDirection: "row", alignItems: "flex-end", gap: 5, height: 86 }}>{[40, 65, 50, 85, 70, 95].map((h, i) => <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, background: i === 5 ? ink : fill(16) }} />)}</div>;
    case "lessons":
      return <div style={box}>{[0, 1, 2].map((i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: `8px solid ${i === 0 ? ink : faint}` }} /><Bar w={`${70 - i * 12}%`} /></div>)}</div>;
    case "progress":
      return <div style={box}>{[85, 55, 25].map((p, i) => <div key={i} style={{ height: 7, borderRadius: 99, background: fill(8) }}><div style={{ width: `${p}%`, height: "100%", borderRadius: 99, background: ink }} /></div>)}</div>;
    case "posts":
      return <div style={box}>{[0, 1].map((i) => <div key={i} style={{ display: "flex", gap: 6 }}><span style={{ width: 16, height: 16, borderRadius: 99, background: fill(16), flexShrink: 0 }} /><span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><Bar w="80%" /><Bar w="50%" o={10} /></span></div>)}</div>;
    case "browse":
      return <div style={box}><span style={{ display: "flex", alignItems: "center", gap: 5, height: 16, padding: "0 6px", borderRadius: 6, border: `1px solid ${border}` }}><Search size={9} color={muted} /></span><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>{[0, 1, 2].map((i) => <span key={i} style={{ aspectRatio: "1", borderRadius: 5, background: fill(10 + i * 3) }} />)}</div></div>;
    case "form":
      return <div style={box}>{[0, 1, 2].map((i) => <span key={i} style={{ height: 13, borderRadius: 5, border: `1px solid ${border}` }} />)}{button("Send")}</div>;
    case "share":
      return <div style={box}><Bar w="60%" o={22} /><div style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 20, height: 20, borderRadius: 99, background: fill(12) }} />)}</div>{button("Invite")}</div>;
    case "updates":
      return <div style={box}>{[0, 1, 2].map((i) => <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}><Bar w={`${80 - i * 10}%`} /><Bar w="35%" o={8} h={4} /></div>)}</div>;
    case "other":
      return <div style={{ ...box, borderStyle: "dashed", justifyContent: "center" }}><PenLine size={13} color={muted} /><span style={{ fontSize: 10.5, lineHeight: 1.35, color: muted, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{other.trim() || "Your idea"}</span></div>;
  }
}

const NAV_FOR: Record<AudienceId, string[]> = {
  customers: ["Home", "Book", "About"],
  team: ["Dashboard", "Tasks", "Files"],
  members: ["Lessons", "Community", "Account"],
  public: ["Explore", "Submit", "About"],
};

function AppPreview({ audience, features, other, name }: { audience: AudienceId | null; features: FeatureId[]; other: string; name: string }) {
  const title = name.trim() || (audience ? suggestName(features) : "");
  return (
    <div style={{ flex: 1, minHeight: 0, borderRadius: 14, border: `1px solid ${border}`, background: surface, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${border}` }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: 99, background: fill(16) }} />)}
        <span style={{ marginLeft: 10, padding: "3px 10px", borderRadius: 99, fontSize: 11, color: muted, background: fill(6), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{slug(title)}.plexopages.com</span>
      </div>
      {!audience ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", background: `repeating-linear-gradient(135deg, ${fill(2)} 0 12px, ${fill(4)} 12px 24px)` }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ink }}>Your app will appear here</span>
          <span style={{ fontSize: 12.5, color: muted, maxWidth: 240 }}>It takes shape as you answer.</span>
        </div>
      ) : (
        <div key={`${audience}-${features.join(",")}`} className="ah-fade" style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "45%" }}>{title}</span>
            <span style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
              {NAV_FOR[audience].map((n) => <span key={n} style={{ fontSize: 11, color: muted }}>{n}</span>)}
            </span>
          </div>
          <div style={{ padding: "16px 14px", borderRadius: 12, background: fill(5), display: "flex", flexDirection: "column", gap: 7 }}>
            <Bar w="55%" o={26} h={9} />
            <Bar w="75%" o={12} />
          </div>
          {features.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {features.slice(0, 4).map((f) => <Block key={f} id={f} other={other} />)}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {[0, 1].map((i) => <span key={i} style={{ height: 80, borderRadius: 10, border: `1px dashed ${border}` }} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the page

export function AppsHome(props: { apps: HomeApp[]; userName: string | null; showAll: boolean; fontClassName?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [audience, setAudience] = useState<AudienceId | null>(null);
  const [features, setFeatures] = useState<FeatureId[]>([]);
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasApps = props.apps.length > 0;
  const audienceInfo = AUDIENCES.find((a) => a.id === audience) ?? null;
  const featureChoices = useMemo(() => (audience ? FEATURES_FOR[audience] : []), [audience]);

  async function create(prompt: string, appName: string) {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api<{ id: string }>("/api/v1/apps", { method: "POST", json: { name: appName } });
      router.push(`/dashboard/apps/${res.id}?prompt=${encodeURIComponent(prompt)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't start your app. Please try again.");
      setCreating(false);
    }
  }

  const chooseAudience = (id: AudienceId) => {
    if (id !== audience) setFeatures((f) => f.filter((x) => x === "other" || FEATURES_FOR[id].includes(x as Exclude<FeatureId, "other">)));
    setAudience(id);
  };
  const toggleFeature = (id: FeatureId) => setFeatures((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const goTo = (next: 1 | 2 | 3) => {
    if (next === 3 && !name.trim()) setName(suggestName(features));
    setStep(next);
  };
  const startFrom = (s: (typeof STARTERS)[number]) => {
    setDescribing(false);
    setAudience(s.audience);
    setFeatures(s.features);
    setName(s.name);
    setStep(3);
  };

  const canContinue = step === 1 ? !!audience : step === 2 ? features.length > 0 && (!features.includes("other") || other.trim().length > 0) : name.trim().length > 0;
  const onContinue = () => {
    if (!canContinue) return;
    if (step < 3) return goTo((step + 1) as 2 | 3);
    void create(describeAnswers(audience!, features, other, name), name.trim());
  };

  // ---------------------------------------------------------------- all apps

  if (props.showAll) {
    return (
      <PageContainer>
        <div className={props.fontClassName} style={{ display: "flex", flexDirection: "column", gap: 22, color: ink }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/dashboard/apps" aria-label="Back" style={{ display: "inline-flex", color: muted }}><ArrowLeft size={20} /></Link>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>All apps</h1>
            <span style={{ color: muted, fontSize: 15 }}>{props.apps.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
            {props.apps.map((app) => <AppCard key={app.id} app={app} large />)}
          </div>
        </div>
        <style>{STYLES}</style>
      </PageContainer>
    );
  }

  // ---------------------------------------------------------------- home

  const answers: Array<{ label: string; step: 1 | 2 }> = [];
  if (audienceInfo && step > 1) answers.push({ label: `For ${audienceInfo.phrase}`, step: 1 });
  if (step > 2 && features.length) answers.push({ label: `${features.length} thing${features.length > 1 ? "s" : ""} they can do`, step: 2 });

  const question =
    step === 1
      ? { title: "Who is it for?", hint: "This helps us shape what your app does." }
      : step === 2
        ? { title: "What should they be able to do?", hint: "Pick as many as you like." }
        : { title: "What's it called?", hint: "We've suggested a name. Change it if you like — you can rename it any time." };

  return (
    <PageContainer>
      <div className={props.fontClassName} style={{ display: "flex", flexDirection: "column", gap: 28, color: ink }}>
        {hasApps ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>{props.userName ? `Welcome back, ${props.userName}` : "Welcome back"}</h1>
              <Link href="/dashboard/apps?view=all" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap" }}>All apps ({props.apps.length}) →</Link>
            </div>
            <div style={eyebrow}>Continue where you left off</div>
            <div className="ah-recent" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
              {props.apps.slice(0, 3).map((app) => <AppCard key={app.id} app={app} />)}
            </div>
          </section>
        ) : (
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>Let&rsquo;s make your first app</h1>
            <p style={{ margin: "8px 0 0", fontSize: 16, color: muted }}>Three quick questions and we&rsquo;ll build it. You can change anything later.</p>
          </div>
        )}

        <section className="ah-builder" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", borderRadius: 22, border: `1px solid ${border}`, background: surface, overflow: "hidden", minHeight: hasApps ? 540 : 600 }}>
          {describing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim()) void create(description.trim(), description.trim().split(/\s+/).slice(0, 4).join(" ").replace(/[^\w\s-]/g, "") || "My app");
              }}
              style={{ padding: "32px 36px", display: "flex", flexDirection: "column", gap: 20 }}
            >
              <div>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>Describe your app</div>
                <div style={{ fontSize: 15, color: muted, marginTop: 6 }}>Say who it&rsquo;s for and what they should be able to do.</div>
              </div>
              <textarea
                autoFocus
                aria-label="Describe your app"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                placeholder="A booking app for my salon where clients pick a stylist and a time, pay a deposit and get a reminder the day before…"
                style={{ width: "100%", resize: "vertical", padding: 16, borderRadius: 14, border: `1px solid ${border}`, background: surface, color: ink, fontSize: 16, lineHeight: 1.55, fontFamily: "inherit", outline: "none" }}
              />
              {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: "#f87171" }}>{error}</p>}
              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <button type="submit" disabled={!description.trim() || creating} style={primaryButton(!!description.trim() && !creating)}>
                  {creating ? <><Loader2 size={16} className="ah-spin" /> Starting…</> : "Build my app"}
                </button>
                <button type="button" onClick={() => setDescribing(false)} style={{ ...linkButton, marginLeft: "auto" }}>Answer three quick questions instead</button>
              </div>
            </form>
          ) : (
            <div style={{ padding: "32px 36px", display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: muted, whiteSpace: "nowrap" }}>Step {step} of 3</div>
                <div style={{ flex: 1, display: "flex", gap: 6 }}>
                  {[1, 2, 3].map((i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i <= step ? ink : fill(12), transition: "background 0.3s" }} />)}
                </div>
              </div>

              {answers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: muted }}>Your answers:</span>
                  {answers.map((a) => (
                    <button key={a.label} type="button" onClick={() => setStep(a.step)} style={{ padding: "6px 12px", borderRadius: 99, border: "none", background: fill(7), color: ink, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {a.label} <span style={{ color: faint, fontWeight: 500 }}>· change</span>
                    </button>
                  ))}
                </div>
              )}

              <div key={step} className="ah-fade">
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>{question.title}</div>
                <div style={{ fontSize: 15, color: muted, marginTop: 6 }}>{question.hint}</div>
              </div>

              {step === 1 && (
                <div className="ah-tiles ah-fade" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  {AUDIENCES.map((a) => <Tile key={a.id} icon={a.icon} title={a.title} body={a.body} on={audience === a.id} onClick={() => chooseAudience(a.id)} />)}
                </div>
              )}
              {step === 2 && (
                <div className="ah-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="ah-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    {featureChoices.map((f) => <Tile key={f} icon={FEATURES[f].icon} title={FEATURES[f].title} body={FEATURES[f].body} on={features.includes(f)} onClick={() => toggleFeature(f)} />)}
                    <Tile icon={PenLine} title="Something else" body="Tell us in a sentence" on={features.includes("other")} onClick={() => toggleFeature("other")} />
                  </div>
                  {features.includes("other") && (
                    <input
                      autoFocus
                      aria-label="What else should they be able to do?"
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      placeholder="e.g. choose which stylist they want"
                      style={{ padding: "14px 16px", borderRadius: 14, border: `1px solid ${border}`, background: surface, color: ink, fontSize: 15, fontFamily: "inherit", outline: "none" }}
                    />
                  )}
                </div>
              )}
              {step === 3 && (
                <input
                  autoFocus
                  className="ah-fade"
                  aria-label="Your app's name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onContinue()}
                  maxLength={60}
                  style={{ padding: "18px 20px", borderRadius: 16, border: `2px solid ${ink}`, background: surface, color: ink, fontSize: 22, fontWeight: 700, fontFamily: "inherit", outline: "none" }}
                />
              )}

              {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: "#f87171" }}>{error}</p>}

              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {step > 1 && <button type="button" onClick={() => setStep((step - 1) as 1 | 2)} style={secondaryButton}>Back</button>}
                <button type="button" onClick={onContinue} disabled={!canContinue || creating} style={primaryButton(canContinue && !creating)}>
                  {creating ? <><Loader2 size={16} className="ah-spin" /> Starting…</> : step === 3 ? <>Build my app <ArrowRight size={16} /></> : "Continue"}
                </button>
                <button type="button" onClick={() => setDescribing(true)} style={{ ...linkButton, marginLeft: "auto" }}>Rather describe it in your own words?</button>
              </div>
            </div>
          )}

          <div className="ah-preview" style={{ background: fill(4), padding: 28, display: "flex", flexDirection: "column", gap: 12, borderLeft: `1px solid ${border}` }}>
            {describing ? (
              <div style={{ flex: 1, borderRadius: 14, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, color: muted, fontSize: 13.5, background: `repeating-linear-gradient(135deg, ${fill(2)} 0 12px, ${fill(4)} 12px 24px)` }}>
                We&rsquo;ll show your app here as soon as it&rsquo;s built.
              </div>
            ) : (
              <AppPreview audience={audience} features={features} other={other} name={step === 3 ? name : ""} />
            )}
            <div style={{ fontSize: 12.5, color: muted, textAlign: "center" }}>A preview of what we&rsquo;ll build</div>
          </div>
        </section>

        {!hasApps && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13.5, color: muted }}>
            Or start from an example:
            {STARTERS.map((s) => (
              <button key={s.title} type="button" onClick={() => startFrom(s)} style={{ padding: "7px 13px", borderRadius: 99, border: `1px solid ${border}`, background: "transparent", color: ink, fontFamily: "inherit", fontSize: 13.5, cursor: "pointer" }}>
                {s.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{STYLES}</style>
    </PageContainer>
  );
}

const STYLES = `
  .ah-tile { transition: border-color 0.15s, background 0.15s, transform 0.15s; }
  .ah-tile:hover { transform: translateY(-1px); }
  .ah-card { transition: transform 0.15s, border-color 0.15s; }
  .ah-card:hover { transform: translateY(-1px); }
  .ah-fade { animation: ah-fade 0.3s ease-out; }
  @keyframes ah-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .ah-spin { animation: ah-spin 0.9s linear infinite; }
  @keyframes ah-spin { to { transform: rotate(360deg); } }
  @media (max-width: 1100px) { .ah-builder { grid-template-columns: minmax(0, 1fr) !important; } .ah-preview { border-left: none !important; min-height: 380px; } }
  @media (max-width: 900px) { .ah-recent { grid-template-columns: minmax(0, 1fr) !important; } }
  @media (max-width: 640px) { .ah-tiles { grid-template-columns: minmax(0, 1fr) !important; } }
  @media (prefers-reduced-motion: reduce) { .ah-fade, .ah-spin { animation: none; } .ah-tile:hover, .ah-card:hover { transform: none; } }
`;
