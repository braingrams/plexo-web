"use client";

import type { CSSProperties } from "react";
import {
  BarChart3, Bell, BookOpen, Briefcase, CalendarClock, CheckCircle2, CreditCard, FileText, FolderOpen, Globe, GraduationCap, ListChecks,
  LogIn, MessagesSquare, Newspaper, PenLine, Search, Share2, Star, TrendingUp, Users, type LucideIcon,
} from "lucide-react";

// The three questions on the Apps home, what they turn into (the prompt SOL builds from, the
// plain-words build checklist) and the sketch of the app they describe — shared by the Apps
// home and the editor, so the sketch an owner sees while answering is the one they watch turn
// into the real app.

// ------------------------------------------------------------------ theme (light ↔ dark)

export const ink = "var(--text-main)";
export const muted = "var(--text-muted)";
export const faint = "var(--text-faint)";
export const surface = "var(--surface)";
export const border = "color-mix(in srgb, var(--text-main) 16%, transparent)";
export const fill = (pct: number) => `color-mix(in srgb, var(--text-main) ${pct}%, transparent)`;
export const accent = "var(--ed-accent-text)";
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
export const brandGradient = "var(--ed-cta-wide)";

/** Colours for app thumbnails and choice icons, picked per name so an app keeps its colour. */
// Plexo's purple family only (never a rainbow): brand, orchid, lavender, indigo, deep violet.
export const HUES = ["var(--brand)", "var(--brand-light)", "var(--ed-violet)", "var(--brand-deep)", "var(--brand-soft)", "var(--brand-deeper)", "var(--ed-violet)", "var(--ed-lavender)"];
export function hueFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
export const gradientFor = (key: string) => {
  const a = hueFor(key);
  const b = HUES[(HUES.indexOf(a) + 3) % HUES.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
};

// ------------------------------------------------------------------ the questions

export type AudienceId = "customers" | "team" | "members" | "public";
export type FeatureId =
  | "book" | "pay" | "signin" | "remind" | "reviews"
  | "tasks" | "files" | "approve" | "reports"
  | "lessons" | "progress" | "posts"
  | "browse" | "form" | "share" | "updates"
  | "other";

export const AUDIENCES: Array<{ id: AudienceId; title: string; body: string; icon: LucideIcon; phrase: string }> = [
  { id: "customers", title: "My customers", body: "People who buy from you", icon: Users, phrase: "my customers" },
  { id: "team", title: "My team", body: "People you work with", icon: Briefcase, phrase: "my team" },
  { id: "members", title: "Members or students", body: "People who join or learn", icon: GraduationCap, phrase: "my members and students" },
  { id: "public", title: "Anyone online", body: "A tool for the public", icon: Globe, phrase: "anyone online" },
];

export const FEATURES: Record<Exclude<FeatureId, "other">, { title: string; body: string; icon: LucideIcon; phrase: string; name: string }> = {
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

export const FEATURES_FOR: Record<AudienceId, Array<Exclude<FeatureId, "other">>> = {
  customers: ["book", "pay", "signin", "remind", "reviews"],
  team: ["tasks", "files", "approve", "reports", "signin"],
  members: ["signin", "lessons", "progress", "pay", "posts"],
  public: ["browse", "form", "share", "updates", "signin"],
};

export const STARTERS: Array<{ title: string; audience: AudienceId; features: FeatureId[]; name: string }> = [
  { title: "Bookings", audience: "customers", features: ["book", "pay", "remind"], name: "Bookings" },
  { title: "Sales tracker", audience: "team", features: ["tasks", "reports", "signin"], name: "Sales tracker" },
  { title: "Course portal", audience: "members", features: ["signin", "lessons", "progress", "pay"], name: "Academy" },
  { title: "Marketplace", audience: "public", features: ["browse", "form", "share"], name: "Marketplace" },
];

function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function describeAnswers(audience: AudienceId, features: FeatureId[], other: string, name: string): string {
  const a = AUDIENCES.find((x) => x.id === audience)!;
  const doing = features.filter((f): f is Exclude<FeatureId, "other"> => f !== "other").map((f) => FEATURES[f].phrase);
  const parts = [`Build an app for ${a.phrase}${doing.length ? ` where they can ${listPhrase(doing)}` : ""}.`];
  if (features.includes("other") && other.trim()) parts.push(`They should also be able to: ${other.trim()}.`);
  if (name.trim()) parts.push(`It's called ${name.trim()}.`);
  return parts.join(" ");
}

export function suggestName(features: FeatureId[]): string {
  const first = features.find((f): f is Exclude<FeatureId, "other"> => f !== "other");
  return first ? FEATURES[first].name : "My app";
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "your-app";

/** The answers, carried from the Apps home to the editor (?plan=…) for the build checklist and sketch. */
export type AppPlan = { audience: AudienceId; features: FeatureId[]; other: string; name: string };

export function encodePlan(plan: AppPlan): string {
  return JSON.stringify({ a: plan.audience, f: plan.features, o: plan.other, n: plan.name });
}

export function decodePlan(raw: string | null | undefined): AppPlan | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!AUDIENCES.some((x) => x.id === v.a) || !Array.isArray(v.f)) return null;
    const features = (v.f as unknown[]).filter((f): f is FeatureId => f === "other" || (typeof f === "string" && f in FEATURES));
    return { audience: v.a, features, other: typeof v.o === "string" ? v.o.slice(0, 300) : "", name: typeof v.n === "string" ? v.n.slice(0, 60) : "" };
  } catch {
    return null;
  }
}

const STEP_LABEL: Record<FeatureId, string> = {
  book: "Adding the booking calendar", pay: "Adding online payments", signin: "Adding sign-in", remind: "Setting up email reminders",
  reviews: "Adding reviews", tasks: "Adding the task list", files: "Adding file sharing", approve: "Adding requests and approvals",
  reports: "Adding reports", lessons: "Adding lessons", progress: "Adding progress tracking", posts: "Adding posts and chat",
  browse: "Adding search and listings", form: "Adding your form", share: "Adding sharing", updates: "Adding updates", other: "Adding your extra idea",
};

/** The plain-words checklist shown while SOL builds the first version. */
export function buildSteps(plan: AppPlan | null): string[] {
  return ["Setting up your pages", ...(plan?.features ?? []).map((f) => STEP_LABEL[f]), "Checking it works on phones"];
}

// ------------------------------------------------------------------ live preview

function Bar({ w, o = 14, h = 6 }: { w: string; o?: number; h?: number }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: 99, background: fill(o) }} />;
}

function Block({ id, other }: { id: FeatureId; other: string }) {
  const box: CSSProperties = { borderRadius: 10, border: `1px solid ${tint(accent, 22)}`, background: tint(accent, 5), padding: 10, display: "flex", flexDirection: "column", gap: 7, minHeight: 0 };
  const button = (label: string) => <span style={{ alignSelf: "flex-start", padding: "4px 10px", borderRadius: 7, background: accent, color: "var(--ed-on-brand)", fontSize: 10, fontWeight: 700 }}>{label}</span>;
  switch (id) {
    case "book":
      return (
        <div style={box}>
          <Bar w="50%" o={22} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {Array.from({ length: 21 }, (_, i) => <span key={i} style={{ aspectRatio: "1", borderRadius: 3, background: [3, 4, 9, 15, 16].includes(i) ? accent : fill(8) }} />)}
          </div>
          {button("Book")}
        </div>
      );
    case "pay":
      return <div style={box}><Bar w="40%" o={22} /><span style={{ fontSize: 16, fontWeight: 800, color: ink }}>$49</span><Bar w="70%" />{button("Pay now")}</div>;
    case "signin":
      return <div style={box}><Bar w="45%" o={22} /><span style={{ height: 14, borderRadius: 5, border: `1px solid ${border}` }} /><span style={{ height: 14, borderRadius: 5, border: `1px solid ${border}` }} />{button("Sign in")}</div>;
    case "remind":
      return <div style={box}>{[0, 1, 2].map((i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><Bell size={11} color={"var(--brand-soft)"} /><Bar w={`${70 - i * 15}%`} /></div>)}</div>;
    case "reviews":
      return <div style={box}><div style={{ display: "flex", gap: 2 }}>{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={12} fill={i < 4 ? "currentColor" : "none"} color={"var(--brand-soft)"} />)}</div><Bar w="85%" /><Bar w="60%" /></div>;
    case "tasks":
      return <div style={box}>{[1, 1, 0, 0].map((d, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: d ? "var(--ed-violet)" : "transparent", border: `1.5px solid ${d ? "var(--ed-violet)" : border}` }} /><Bar w={`${75 - i * 10}%`} /></div>)}</div>;
    case "files":
      return <div style={{ ...box, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} style={{ aspectRatio: "4 / 5", borderRadius: 5, background: tint(HUES[i % HUES.length], 35) }} />)}</div>;
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

export function AppPreview({ audience, features, other, name }: { audience: AudienceId | null; features: FeatureId[]; other: string; name: string }) {
  const title = name.trim() || (audience ? suggestName(features) : "");
  return (
    <div style={{ flex: 1, minHeight: 0, borderRadius: 14, border: `1px solid ${border}`, background: surface, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "9px 12px", borderBottom: `1px solid ${border}` }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 7, height: 7, borderRadius: 99, background: fill(16) }} />)}
        <span style={{ marginLeft: 10, padding: "3px 10px", borderRadius: 99, fontSize: 11, color: muted, background: fill(6), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{slug(title)}.plexopages.com</span>
      </div>
      {!audience ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", background: `radial-gradient(70% 60% at 30% 20%, ${tint("var(--brand-light)", 14)}, transparent 70%), radial-gradient(70% 60% at 75% 80%, ${tint(accent, 20)}, transparent 70%)` }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: brandGradient, boxShadow: "0 10px 30px var(--brand-glow)" }} />
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
          <div style={{ padding: "18px 14px", borderRadius: 12, background: brandGradient, display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={{ display: "block", width: "55%", height: 9, borderRadius: 99, background: "var(--ed-w-900)" }} />
            <span style={{ display: "block", width: "75%", height: 6, borderRadius: 99, background: "var(--ed-w-500)" }} />
            <span style={{ alignSelf: "flex-start", marginTop: 4, padding: "4px 10px", borderRadius: 7, background: "#fff", color: "var(--brand-deep)", fontSize: 10, fontWeight: 700 }}>Get started</span>
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


/** Text and icons that sit on the brand colour (dark on the new lime, white on the old green). */
export const onBrand = "var(--plx-on-brand, #fff)";
/** Link colour: deep green on light, lime on dark in the new dashboard. */
export const linkColor = "var(--plx-link, var(--brand))";
export const warnColor = "var(--ed-warning)";
export const okColor = "var(--plx-success, #10b981)";
export const dangerColor = "var(--ed-danger)";
