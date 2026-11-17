// Pure helpers for the new SOL screens (grouping the conversation list, the "Working on" chip).
import type { ConversationSummary } from "../../sol/_components/types";

export type ConversationGroup = { id: "today" | "yesterday" | "week" | "earlier"; label: string; items: ConversationSummary[] };

const GROUP_LABELS: Record<ConversationGroup["id"], string> = { today: "Today", yesterday: "Yesterday", week: "Previous 7 days", earlier: "Earlier" };

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** When a conversation was last touched (falls back from the last message to its own update). */
function touchedAt(c: ConversationSummary): number {
  const t = Date.parse(c.lastMessageAt ?? c.updatedAt ?? c.createdAt ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Groups conversations by calendar day (the viewer's own) — Today, Yesterday, the week before
 * that, then Earlier — newest first inside each. Empty groups are left out.
 */
export function groupConversationsByDay(conversations: ConversationSummary[], now: Date = new Date()): ConversationGroup[] {
  const today = startOfDay(now);
  const day = 86_400_000;
  const buckets: Record<ConversationGroup["id"], ConversationSummary[]> = { today: [], yesterday: [], week: [], earlier: [] };
  for (const c of [...conversations].sort((a, b) => touchedAt(b) - touchedAt(a))) {
    const t = touchedAt(c);
    const id: ConversationGroup["id"] = t >= today ? "today" : t >= today - day ? "yesterday" : t >= today - 7 * day ? "week" : "earlier";
    buckets[id].push(c);
  }
  return (Object.keys(buckets) as ConversationGroup["id"][]).filter((id) => buckets[id].length).map((id) => ({ id, label: GROUP_LABELS[id], items: buckets[id] }));
}

/** Narrows the list to titles that contain what was typed (blank shows everything). */
export function filterConversations(conversations: ConversationSummary[], query: string): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => (c.title || "New conversation").toLowerCase().includes(q));
}

export type SiteContext = { id: string; name: string };

/** `?site=` from the link onboarding hands over (an id); anything odd is ignored. */
export function parseSiteParam(value: string | string[] | undefined | null): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[A-Za-z0-9_-]{6,80}$/.test(v) ? v : null;
}

/** Picks the chosen site out of the owner's sites. */
export function siteContextFor(sites: Array<{ id: string; name: string }>, siteId: string | null): SiteContext | null {
  const hit = siteId ? sites.find((s) => s.id === siteId) : undefined;
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** What SOL is told with the first message so it works on the right site (the bubble still shows only what was typed). */
export function withSiteContext(text: string, site: SiteContext | null): string {
  return site ? `${text}\n\n(I'm working on my site "${site.name}" — its id is ${site.id}.)` : text;
}

/** The time-of-day greeting. */
export function greetingFor(hour: number): string {
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export const SUGGESTIONS = [
  { id: "site", title: "Make a website", hint: "Tell me about your business and I'll build the pages.", prompt: "Help me make a website for my business. Ask me what you need to know first." },
  { id: "shop", title: "Add a shop", hint: "Sell products and take payments.", prompt: "I want to add an online shop to my site so I can sell my products. Walk me through it." },
  { id: "blog", title: "Write a blog post", hint: "A first draft in your voice, ready to edit.", prompt: "Write a blog post for my site. Ask me what it should be about." },
  { id: "improve", title: "Improve my site", hint: "Better words, clearer pages, a nicer look.", prompt: "Look at my site and tell me the three things that would improve it most. Then offer to do them." },
  { id: "app", title: "Build an app", hint: "Sign-in, saved information, the lot.", prompt: "I want to build an app where people can sign in. Ask me what it should do." },
  { id: "help", title: "Ask anything", hint: "Not sure where to start? Just ask.", prompt: "I'm new here. What can you help me with?" },
] as const;

// ── Steps in plain words ───────────────────────────────────────────────────────────────
// SOL's tools have technical names (create_raw_landing_page). Owners see "Building your page…"
// while it runs and "Built your page" once it's done.

const VERBS: Record<string, [now: string, done: string]> = {
  get: ["Checking", "Checked"], list: ["Looking up", "Looked up"], find: ["Looking up", "Looked up"], search: ["Searching", "Searched"],
  create: ["Building", "Built"], add: ["Adding", "Added"], delete: ["Deleting", "Deleted"], remove: ["Removing", "Removed"],
  update: ["Updating", "Updated"], edit: ["Updating", "Updated"], set: ["Setting up", "Set up"], publish: ["Publishing", "Published"],
  unpublish: ["Taking down", "Took down"], archive: ["Archiving", "Archived"], restore: ["Restoring", "Restored"],
  duplicate: ["Copying", "Copied"], rename: ["Renaming", "Renamed"], move: ["Moving", "Moved"], enable: ["Turning on", "Turned on"],
  disable: ["Turning off", "Turned off"], connect: ["Connecting", "Connected"], refund: ["Refunding", "Refunded"],
  cancel: ["Cancelling", "Cancelled"], send: ["Sending", "Sent"], generate: ["Creating", "Created"], upload: ["Uploading", "Uploaded"],
  import: ["Importing", "Imported"], export: ["Exporting", "Exported"], read: ["Reading", "Read"], write: ["Writing", "Wrote"],
  request: ["Requesting", "Requested"], approve: ["Approving", "Approved"], moderate: ["Reviewing", "Reviewed"], resolve: ["Sorting out", "Sorted out"],
  reorder: ["Reordering", "Reordered"], design: ["Designing", "Designed"], describe: ["Looking at", "Looked at"], sell: ["Setting up selling for", "Set up selling for"],
  start: ["Starting", "Started"], preview: ["Previewing", "Previewed"], verify: ["Checking", "Checked"], resend: ["Resending", "Resent"], reset: ["Resetting", "Reset"],
  adopt: ["Adopting", "Adopted"], app: ["Working on", "Worked on"], page: ["Working on", "Worked on"], site: ["Setting up", "Set up"],
};
const NOUN_WORDS: Record<string, string> = { landing: "", raw: "", template: "page", templates: "pages", pages: "pages", commerce: "shop", funnel: "funnel", strata: "brand", user: "your", subpage: "page", layout: "layout", app: "app" };
const SPECIAL: Record<string, [string, string]> = {
  page_create_from_template: ["Building your page", "Built your page"],
  page_edit: ["Updating your page", "Updated your page"],
  page_publish: ["Publishing your page", "Published your page"],
  site_create: ["Setting up your site", "Set up your site"],
  app_build: ["Building your app", "Built your app"],
  app_publish: ["Publishing your app", "Published your app"],
  app_screenshot: ["Looking at your app", "Looked at your app"],
  app_write_files: ["Writing your app", "Wrote your app"],
  app_edit_file: ["Updating your app", "Updated your app"],
  app_read_files: ["Reading your app", "Read your app"],
  app_list_files: ["Looking through your app", "Looked through your app"],
  ask_user_question: ["Asking you a question", "Asked you a question"],
  get_user_profile: ["Checking your account", "Checked your account"],
  get_analytics: ["Checking your visits", "Checked your visits"],
};
const OWNED = new Set(["page", "pages", "site", "shop", "blog post", "blog", "product", "products", "order", "orders", "funnel", "app", "profile", "layout", "form", "settings", "domain", "discount", "customers"]);

/** One short step in plain words — still in progress ("Building your page") or done ("Built your page"). */
export function friendlyStep(toolName: string, phase: "doing" | "done"): string {
  const special = SPECIAL[toolName];
  if (special) return special[phase === "doing" ? 0 : 1];
  const [verb, ...rest] = toolName.split("_").filter(Boolean);
  const v = verb ? VERBS[verb.toLowerCase()] : undefined;
  const words = rest.map((w) => (w in NOUN_WORDS ? NOUN_WORDS[w] : w)).filter(Boolean);
  const noun = words.join(" ").replace(/^your\s+/, "");
  const owned = words[0] === "your" || OWNED.has(noun) || OWNED.has(noun.split(" ").at(-1) ?? "");
  const object = noun ? `${owned ? "your " : ""}${noun}` : "";
  if (!v) return toolName.split("_").filter(Boolean).map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return `${v[phase === "doing" ? 0 : 1]}${object ? ` ${object}` : ""}`;
}
