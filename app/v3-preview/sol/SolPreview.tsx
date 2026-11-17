"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SolChatFrame } from "@/app/dashboard/_v3/sol/Chat";
import { ShareDialog } from "@/app/dashboard/_v3/sol/ShareDialog";
import { SolV3Shell } from "@/app/dashboard/_v3/sol/SolV3Context";
import { SolSettingsV3 } from "@/app/dashboard/_v3/sol/SolSettingsV3";
import { SolMemoryV3 } from "@/app/dashboard/_v3/sol/SolMemoryV3";
import { SolSplash } from "@/app/dashboard/_v3/sol/SolSplash";
import { useSolSidebar } from "@/app/dashboard/sol/_components/SolSidebarContext";
import type { ActiveArtifact } from "@/app/dashboard/sol/_components/ArtifactCanvas";
import type { SolMemoryItem } from "@/app/dashboard/sol/memory/page";
import type { SolPreferencesData } from "@/app/dashboard/sol/settings/page";
import type { ContentBlock, ConversationSummary, ModelTier, SolMessage, ToolUseBlock } from "@/app/dashboard/sol/_components/types";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const TITLES = [
  "Build my bakery website", "Write my About page", "Set up my shop", "Change my homepage photo", "Blog post about jollof", "Fix the contact form",
  "Add opening hours", "Prices for cake orders", "Newsletter sign-up", "Translate the menu to French", "Wedding cake gallery", "Why is my site slow?",
  "Delivery fees for Lagos", "Holiday banner", "A name for my new course", "Show reviews on the homepage",
];
const THREADS: ConversationSummary[] = TITLES.map((title, i) => {
  const at = i < 3 ? hoursAgo(i * 2 + 0.2) : i < 6 ? daysAgo(i - 2) : daysAgo(i * 2);
  return { id: `c${i}`, title: i === 15 ? null : title, modelTier: "MEDIUM", status: "ACTIVE", lastMessageAt: at, messageCount: 6, createdAt: at, updatedAt: at };
});

const text = (t: string): ContentBlock => ({ type: "text", text: t });
const tool = (name: string, status: ToolUseBlock["status"], input: unknown = {}, result?: unknown): ToolUseBlock => ({ type: "tool_use", id: `t-${name}-${status}`, name, input, status, result });
const msg = (id: string, role: SolMessage["role"], content: ContentBlock[], ago = 2): SolMessage => ({ id, role, content, createdAt: hoursAgo(ago) });

const ASK = tool("ask_user_question", "awaiting_confirmation", {
  questions: [
    { header: "Style", question: "What feel do you want for the bakery site?", options: [{ label: "Warm and friendly", description: "Soft colours, round shapes" }, { label: "Bold and modern", description: "Strong colours, big type" }, { label: "Calm and clean", description: "Lots of white space" }], multiSelect: false },
    { header: "Pages", question: "Which pages should I make?", options: [{ label: "Menu" }, { label: "About us" }, { label: "Contact" }], multiSelect: true },
  ],
});

// The intake card for a thin prompt ("build me a landing page"): the first questions of the planned set (lib/ai/solBrief.ts).
const INTAKE = tool("ask_user_question", "awaiting_confirmation", {
  questions: [
    { header: "Your business", question: "What do you do or sell, in a sentence?", options: [{ label: "I sell products", description: "Things people can buy" }, { label: "I offer a service", description: "Bookings, quotes or enquiries" }, { label: "I teach or coach", description: "Courses, lessons, programmes" }, { label: "I run a cause or community", description: "Donations, members, events" }] },
    { header: "Name", question: "What's the business called?", options: [{ label: "Suggest a name for me" }, { label: "Use my own name" }] },
    { header: "Your audience", question: "Who is it for?", options: [{ label: "Local customers", description: "People nearby" }, { label: "Busy professionals" }, { label: "Families and parents" }, { label: "Other businesses" }] },
    { header: "Main action", question: "What's the one thing visitors should do?", options: [{ label: "Buy or order now" }, { label: "Book a call or appointment" }, { label: "Get in touch" }, { label: "Sign up or subscribe" }] },
    { header: "Feel", question: "What feel should it have?", options: [{ label: "Warm and friendly", description: "Soft colours, round shapes" }, { label: "Bold and modern", description: "Strong colours, big type" }, { label: "Calm and clean", description: "Lots of space" }, { label: "Elegant and premium", description: "Refined, quiet luxury" }] },
    { header: "Colours and logo", question: "Do you have brand colours or a logo?", options: [{ label: "I'll attach my logo", description: "I'll use its colours" }, { label: "I have colours", description: "I'll type them" }, { label: "No logo, make a simple wordmark", description: "You choose the palette" }, { label: "Show me palette ideas", description: "You choose" }] },
  ],
});

const CONVERSATION: SolMessage[] = [
  msg("m1", "user", [text("Can you build me a website for my bakery in Accra? We sell cakes, pastries and take custom orders.")], 3),
  msg("m2", "assistant", [
    text("Lovely, **Ama's Bakery** sounds delicious. I'll start with a home page and an order form, then we can add more.\n\nHere is the plan:\n\n1. A warm home page with your best cakes\n2. A *custom order* form that emails you\n3. A short About page with your story\n\nI'll keep the words simple and the photos big."),
    tool("get_user_profile", "success", {}, { name: "Ama" }),
    tool("page_create_from_template", "success", { name: "Home" }, { templateId: "tpl1", name: "Home" }),
    tool("page_edit", "running", { name: "Home" }),
    tool("page_publish", "preparing"),
  ], 2.9),
  msg("m3", "user", [text("Yes please, and make the buttons green.")], 2.5),
  msg("m4", "assistant", [text("Done. Your buttons are now green across the site.\n\n- Home\n- Order a cake\n- About\n\n> Tip: you can change any word on the page by tapping it.\n\nWant me to **publish** it now?")], 2.4),
];

const MEMORIES: SolMemoryItem[] = [
  { id: "m1", text: "My shop is called Ama's Bakery and we deliver across Accra.", category: "FACT", source: "USER_ADDED", sourceConversationId: null, createdAt: hoursAgo(30) },
  { id: "m2", text: "I like short, warm replies with no jargon.", category: "TONE", source: "LLM_EXTRACTED", sourceConversationId: "c0", createdAt: hoursAgo(50) },
  { id: "m3", text: "Most of my customers are young families who order cakes for birthdays.", category: "FACT", source: "LLM_EXTRACTED", sourceConversationId: "c1", createdAt: hoursAgo(80) },
  { id: "m4", text: "Prices are in Ghana cedis.", category: "PREFERENCE", source: "USER_ADDED", sourceConversationId: null, createdAt: hoursAgo(120) },
];
const PREFS: SolPreferencesData = { tonePreset: "FRIENDLY", customInstructions: "I run a bakery in Accra. Keep things warm and simple.", defaultModelTier: "MEDIUM", memoryEnabled: true, responseLength: "BALANCED" };

const ARTIFACT: ActiveArtifact = { templateId: "tpl1", name: "Home", publishedUrl: null };

const PAGE_HTML = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#fbf7ef"><div style="padding:48px 32px;text-align:center"><h1 style="font-size:40px;margin:0 0 12px">Ama's Bakery</h1><p style="color:#555">Fresh cakes and pastries, baked in Accra.</p><a style="display:inline-block;margin-top:16px;padding:14px 24px;border-radius:12px;background:#1f6f4a;color:#fff">Order a cake</a></div></body></html>`;

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
function installFake() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __solFake?: boolean };
  if (w.__solFake) return;
  w.__solFake = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const q = new URLSearchParams(window.location.search);
    if (/\/api\/v1\/sol\/conversations\/[^/]+\/share/.test(url)) return json(q.get("shared") === "1" ? { shared: true, url: "https://plexo.example/s/Xk29aLm", upTo: hoursAgo(2.4) } : { shared: false, url: null, upTo: null });
    if (/\/api\/v1\/sol\/conversations$/.test(url)) return q.get("state") === "empty-list" ? json({ conversations: [] }) : q.get("state") === "loading" ? new Promise<Response>(() => {}) : json({ conversations: THREADS });
    if (/\/api\/v1\/profile/.test(url)) return json({ user: { totalCredits: q.get("low") === "1" ? 12 : 1240 } });
    if (/\/api\/billing\/topup-packs/.test(url)) return json({ packs: [{ pack: "SMALL", credits: 500, price: "$2.50" }, { pack: "MEDIUM", credits: 1500, price: "$6" }, { pack: "LARGE", credits: 4000, price: "$14" }] });
    if (/\/api\/templates\//.test(url)) return json({ page: { id: "tpl1", name: "Home", kind: "BUILDER", compiledHtml: PAGE_HTML, previewHtml: PAGE_HTML } });
    if (/\/api\/v1\/sol\/whatsapp/.test(url)) return json({ available: true, phone: q.get("wa") === "1" ? "233201234567" : null });
    if (/\/api\/v1\/sol\/(preferences|memories)/.test(url) && (init?.method ?? "GET") !== "GET") return json({ memory: { id: "m-new", text: "New", category: "PREFERENCE", source: "USER_ADDED", sourceConversationId: null, createdAt: new Date().toISOString() } });
    if (url.startsWith("/api/") && (init?.method ?? "GET") === "GET") return json({});
    return real(input, init);
  };
}

function SheetOpener({ on }: { on: boolean }) {
  const { openMobileSidebar } = useSolSidebar();
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(openMobileSidebar, 600);
    return () => clearTimeout(t);
  }, [on, openMobileSidebar]);
  return null;
}

export function SolPreview() {
  const q = useSearchParams();
  useState(installFake);
  const state = q.get("state") ?? "chat";
  const [tier, setTier] = useState<ModelTier>("MEDIUM");
  const empty = state === "empty" || state === "empty-list" || state === "loading";
  const streaming = state === "streaming";
  const showArtifact = state === "canvas";
  const conversation: ConversationSummary | null = empty ? null : { ...THREADS[0], title: "Build my bakery website" };
  const messages: SolMessage[] = empty ? [] : state === "streaming" ? CONVERSATION.slice(0, 3) : state === "ask" ? CONVERSATION.slice(0, 1) : state === "intake" ? [msg("i1", "user", [text("build me a landing page")], 1), msg("i2", "assistant", [text("Happy to. I'll make it yours, so a few quick questions first. Tap an answer, type your own, or skip any and I'll choose.")], 0.9)] : CONVERSATION;
  const pendingBlocks: ContentBlock[] | null = streaming ? [text("Great choice. I'm adding the order form to the page now, so people can pick a cake, a size and a date"), tool("page_edit", "running")] : null;
  const pendingQuestion = state === "ask" ? ASK : state === "intake" ? INTAKE : null;

  // ?theme=dark|light: press the top bar's own theme switch (headless screenshots cannot set a cookie).
  useEffect(() => {
    const want = q.get("theme");
    if (!want) return;
    const t = setTimeout(() => {
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement>(".plx-topbar__theme button"));
      btns.find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").toLowerCase().includes(want))?.click();
    }, 800);
    return () => clearTimeout(t);
  }, [q]);
  // ?sidebar=menu: start the left column on the Menu view (the switch is a click in real use).
  useEffect(() => {
    try {
      if (q.get("sidebar")) sessionStorage.setItem("plx:solSidebar", q.get("sidebar") as string);
    } catch {
      // fine
    }
  }, [q]);
  if (state === "settings" || state === "memory" || state === "memory-empty" || state === "splash") {
    return <SolV3Shell>{state === "settings" ? <SolSettingsV3 initialPreferences={PREFS} /> : state === "splash" ? <SolSplash /> : <SolMemoryV3 initialMemories={state === "memory" ? MEMORIES : []} />}</SolV3Shell>;
  }
  return (
    <SolV3Shell>
      <SheetOpener on={state === "sheet"} />
      <SolChatFrame
        userName="Ama Owusu"
        conversation={conversation}
        messages={messages}
        pendingBlocks={pendingBlocks}
        streaming={streaming}
        isEmpty={empty}
        composer={{ streaming, modelTier: tier, onModelTierChange: setTier, onSend: () => {}, onStop: () => {}, initialText: state === "typed" ? "Write my about page" : undefined }}
        inlineError={state === "error" ? "SOL couldn't finish that just now. Nothing was lost, so please try sending it again." : null}
        overdraftBalance={state === "overdraft" ? -14 : null}
        onConfirmToolCall={() => {}}
        confirmBusy={false}
        pendingQuestion={pendingQuestion}
        onSubmitAnswers={() => {}}
        activeArtifact={state === "canvas" || state === "chip" ? ARTIFACT : null}
        showArtifact={showArtifact}
        onOpenArtifact={() => {}}
        onCloseArtifact={() => {}}
        creditInfo={state === "credit" ? { requiredCredits: 320, availableCredits: 12 } : null}
        onCloseCredit={() => {}}
        returnTo="/v3-preview/sol"
        onRename={() => {}}
        creditsRefreshKey={0}
        titleJustGenerated={false}
        onTitleRevealDone={() => {}}
        onSuggestion={() => {}}
      />
      {state === "share" ? <ShareDialog conversationId="c0" onClose={() => {}} /> : null}
    </SolV3Shell>
  );
}
