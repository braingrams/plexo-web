# Plexo app redesign — spec (v3 dashboard)

Approved direction: clickable prototype https://claude.ai/artifact/9WST8RZFca3mawMkP5QzfH
(screens: Onboarding, Home (guided / skipped setup / pro), Site hub with "Add a page").

## The bar
Usable by a 14-year-old with no design, developer or internet-business experience.
Every screen: one obvious main action, plain words, only what this person needs now,
help where they expect it. Spacious, never cramped. Never jargon on beginner screens
(no "template", "deploy", "DNS", "SDK", "React", "HTML", "subdomain", "slug", "compile").
No sparkle/wand icons. No narrow column floating in empty space on working screens
(question-at-a-time onboarding steps are the one place a single roomy column is right).
Every screen works at phone width (mobile is most users) and in light, dark and system.

## Brand (from plexopages.com; will later be read live from Strata — see "Tokens")
- Primary (action) lime `#B8F34A`, text on it `#121212`.
- Deep green `#517A12` (links/emphasis on light; on dark use lime).
- Accent amber `#F5AC05`; violet `#8A7BFF` / `#5545D6` (sparingly, e.g. SOL).
- Light: bg `#F7F8F3`, surface `#FFFFFF`, elevated `#F4F5F0`, border `#E8E8E4`, tint `#F0F6DF`,
  text `#121212`, muted `#5B5B58`.
- Dark: bg `#0B0B12`, surface `#15161C`, elevated `#1D1F26`, border `#2C2E35`, tint `#1F2614`,
  text `#F4F5F0`, muted `#A6A7A2`.
- Type: Plus Jakarta Sans (UI), JetBrains Mono (code only). Headlines 800 weight, tight tracking.
- Logos: `docs/redesign/logo-dark.svg` (dark wordmark, for light backgrounds),
  `logo-light.svg` (for dark backgrounds), `logo-giant.svg`, `logo-footer.svg`.
  Icon mark = the 2-shape "p" (lime square + rounded shape). Favicon/app icon/email logo PNG from it.
- Radius: 12px controls, 16–22px cards. Touch targets ≥ 44px. Text contrast ≥ 4.5:1.

## Tokens
All UI colour comes from CSS variables with Strata names (`--color-bg-canvas`,
`--color-bg-surface`, `--color-bg-elevated`, `--color-border-default`, `--color-text-primary`,
`--color-text-secondary`, `--color-action-primary-bg`, `--color-action-primary-text`,
`--color-brand-accent`, …) plus Plexo semantic aliases. **No hex literals in v3 components.**
`lib/brandTokens.ts` holds the bundled default token set (light + dark) and is the fallback;
a later step reads the Plexo brand Strata project's published tokens server-side (short revalidate)
and overrides these — so a Strata publish restyles the app with no deploy.

## Theme
Light / Dark / System, default **System**. Switch in the top bar (segmented) and in Settings.
Stored per user (profile) + cookie so first paint is right (no flash).

## Information architecture
Beginner nav: **Home · My site(s) · Ask SOL · Settings** (+ "Orders" when they sell, "Learners"
for courses — only what their goal needs). Intermediate adds Emails, Domains.
Pro adds Developers (API keys, SDK, MCP connectors, server apps) and a denser Home.
- **Home** = guided next steps for their goal (checklist of real tasks, each completable inline)
  + their site preview + Ask SOL. Pro Home = stats + all sites/apps table + quick actions.
- **Sites** = every site/app/store/course/blog as a card with a plain label
  ("Online store", "Website", "Course", "Blog", "App with sign-in", "Link page").
- **Site hub** `/dashboard/sites/[id]` = one place per site. Tabs appear only for what the site
  uses: Pages · Products · Orders · Blog · Course · Brand · Web address · Visits · Settings.
  "Add more to your site" cards turn on Blog / Course / Bookings / Newsletter / Store as a
  guided task (no hunting through menus).
- "Templates" disappears as a word. Users pick "a design". Marketplace = "Designs" inside creation.
- Pages vs apps: users never choose a technology. They choose what they're making; we pick
  the builder (visual by default; app when they need sign-ins/accounts/data; own code only when
  they bring it). Pro users can see/override the builder.

## Experience levels
`experience: "beginner" | "intermediate" | "pro"` on the user (switchable in Settings and
from Home). Beginner = guided view, fewer items, plain words, a help video link per section.
Pro = everything, denser.

## Onboarding (`/welcome/setup`, shown to every user once for this redesign — existing users too)
Steps (header: logo · "Step N of 5" + thin bar · **"Continue later →"** to the dashboard):
1. You: brand/business name; "What do you do, in one sentence?" (+ tap-to-fill ideas).
2. Goal: Sell products · Website for my business · Blog · Course · One link for all my links ·
   One page to promote something · App people sign into · Just looking around.
3. Experience: "I'm new to this" / "I've made a site before" / "I build websites for a living".
4. Look: logo upload (optional; colours suggested from it; no logo → one made from the name),
   main colour, feel (Warm & friendly / Bold / Calm & clean / Elegant), "Connect Strata" link.
   **The live preview panel appears from this step on** (enough answers to make it look real).
5. Design: 3 designs chosen for their goal + industry, each already rendered with their name,
   logo, colours, fonts and words; "See all designs". "Use this design" creates the site
   (store/blog/course switched on per goal, using SOL's `site_create`/site kit) and lands on Home.
Steps 1–3: one roomy column, generous whitespace, nothing else on screen.
Stored on user: `buildProfile {goal, experience, brand{name, about, industry, tone, colors, logoUrl}}`,
`onboardingVersion` (3 = done), `onboardingDeferredAt` (Continue later). SOL reads buildProfile
(`lib/ai/solBuildContext.ts` → `loadBuildProfile`).
"Continue later" → Home shows "Your site is ready when you are — Set up your first site" card.

## Guided tasks (task completion, per goal — computed from real data)
- Store: Pick design ✓ · Logo & colours ✓ · Add first product (inline form) · Get paid
  (Paystack card+transfer recommended / bank transfer) · Web address · Go live.
- Business site: design · logo & colours · check your pages' words · contact details · address · live.
- Blog: design · write first post (inline, SOL can draft) · address · live.
- Course: design · add first lesson · set price (or free) · address · live.
- Link page: add links · address · live. App: describe it (SOL builds) · sign-in on · live.
Each task shows a 1-minute video link. Finishing all → "You're live — copy link / share".

## After "You're live" (owner, 2026-11-16)
The live moment has a **"Go to my dashboard"** button. The dashboard then shows what matters:
the site's stats (visits, orders/sales or sign-ups for its goal), **Edit site**, **Preview**,
and **"Create another website"**. Beginners see **one site at a time** with a site switcher
(name + "Switch site" + "Create another website"); intermediate/pro see all their sites together
(cards / table with status and stats).

## Help along the way
- Every guided step and every section has **"Watch how"**: a short looping animation (GIF/video)
  of exactly that step, playable inline again whenever the user is stuck (HelpMedia component;
  animated placeholder until real recordings exist; recordings come from the video pipeline).
- **Walkthrough tour**: on first arrival at the dashboard ask "Want a quick tour?" —
  **Short** (key areas, ~1 min) / **Detailed** (every page one by one, including Settings) / **Later**.
  Coach-mark tooltips spotlight each part with a plain description; Next / Back / Skip; progress;
  continues across pages; resumable; re-open any time from the help menu ("Take the tour again").

## Regional pricing (owner, 2026-11-16)
Prices live in a database price book edited in **plexo-admin**: country groups by default
(Nigeria, Ghana, Kenya, South Africa, Rest of Africa, Rest of world), each with currency,
provider (Paystack/Stripe) and price per plan × interval + AI top-up; any country can be pulled
out of its group with its own settings (e.g. South Africa in USD at its own price). Saving goes
live immediately (short cache), audited and validated; checkout creates provider prices on demand.

## Launch
Behind `DASHBOARD_V3` (env + per-user override for staff/testing) until every section is done;
launch all at once with the announcement email; on launch existing users see onboarding once.
Emails and plexo-admin get the new logo/palette in the same release.
