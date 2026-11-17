# SOL discovery: why output was bland, and what changed

## Diagnosis (how it worked before)

- `lib/ai/solAgent.ts` `buildSolSystemPrompt` already told the model to "ask ONE compact round" before a new build, but only as advice. Nothing in code decided whether to ask: the model chose, every time, from a prompt that also said "build straight away" and "never ask for things you can default". A one-line prompt like "build me a landing page" therefore usually went straight to building.
- The brief the model saw was only `SolBuildProfile` (`lib/ai/solBuildContext.ts`): the account's onboarding brand (name, about, industry, tone, colours, logoUrl). The site's own brand (`Template.brand`, `lib/dashboardV3/brandLook.ts`) never reached SOL, so it could neither reuse a site's colours and logo nor know it should not ask for them. Conversations are only bound to an app (`appId`), never to a site.
- Nothing parsed the owner's message. A 400-word brief and "build me a landing page" were handled by the same instructions, so details in a rich brief were left to the model's attention and the missing pieces of a thin one were left to its guesswork.
- The ask tool (`ask_user_question`, `lib/ai/solToolSchema.ts`) allowed at most 4 questions, had no "you choose" path, and the card (`app/dashboard/_v3/sol/AskCard.tsx`) had no way to skip or say "just build it".
- Build quality: `site_create` / `page_create_from_template` pick a layout from `industry` and `style` (SDK `detectIndustry`/`detectStyle`, `designSystemFromBrief`) and fill sections the model passes. With no brand facts and no copy plan the model passed little, so the kit's sample wording and a default palette showed through: bland. The prompt asked for "specific, believable copy" but gave no quality bar, no example of bland vs good, and no forming of a direction (positioning, palette roles, type, section jobs) before calling the tool.
- A logo attached in chat reached the model only as an image; nothing told it to take its colours, and "no logo" had no rule (risk of an empty image slot).

## What changed

1. `lib/ai/solBrief.ts` (pure): `parseBrief` builds a structured brief from the message, earlier turns, answers, the account and site brand and attachments. Each field is `known | inferred | missing` with its source. It parses names, hex and named colours, logo state (have / attached / link / none), fonts, URLs, emails, phones, socials, prices, quoted copy, section lists, audience, main action, tone, language and constraints, and scores richness (simple / medium / rich).
2. `planQuestions`: simple prompts get up to 6 questions (offer, name, audience, main action, feel, colours-and-logo), medium up to 4, rich at most 1 (only a missing name or business). Nothing already known is asked; after one round it never asks again; "just build it" / "surprise me" and changes to existing work skip it and the plan carries the assumptions to state in one line. A business named in the prompt that differs from the one on file does not inherit the old colours or logo.
3. `lib/ai/solDiscovery.ts`: `creativeDirection` (positioning, voice, palette with roles from the owner's colours or a contrast-checked palette, type pairing, imagery, logo/wordmark rule, a section plan with a job per section, copy rules), `discoveryPrompt` (exact intake card or "do not ask", known facts, assumptions), the short `QUALITY_BAR` with bland-vs-good examples, and `briefFromConversation`.
4. `lib/ai/solAgent.ts`: step 1 of the prompt now defers to the per-request block; the quality bar and save-brand guide are included; the block is built from the conversation on every round, so resumed turns see the answers.
5. `lib/ai/solSiteContext.ts` + `solChatHandler.ts`: all of the owner's sites (name, own brand) are loaded with the signal for which one was chosen. See "Never guess which site" below.
6. `site_save_look` tool (`lib/mcp/siteTools.ts`) through `lib/sites/saveLook.ts`, the same code the Brand tab's `PUT /api/v1/sites/[id]/look` now uses, so SOL saves colours and logo choice (after the owner agrees, asked in plain words) and Home's "logo and colours" step ticks.
7. `AskCard` (V3 only): "Question 2 of 5", "Skip, you choose" per question, "Just build it" for the rest. `ask_user_question` takes up to 6 questions.
8. Eval: `tests/fixtures/solEvalPrompts.json` (16 prompts) and `scripts/sol-eval.ts`.

## Running the eval

Offline (no key, no cost), records the extracted brief, richness, questions and direction per prompt:

    npx tsx scripts/sol-eval.ts > eval-after.json   # { prompts: [...], gateFixtures: {...} }

To compare with before, run it on the previous commit's checkout of the prompt (or just compare questions asked live):

    ANTHROPIC_API_KEY=... npx tsx scripts/sol-eval.ts --live > eval-live.json

`--live` sends each prompt with the real system prompt and records the first reply (the questions it asked). It spends credits; it is never run in CI.

## Known limits

- Colours of an attached logo are read by the model (it sees the image); the server does not decode images (no image library in the bundle). `dominantColors` (`lib/onboarding/logoColors.ts`) is used where pixels exist in the browser.
- The intake card is enforced by instruction ("your first action is exactly this call"), not by pausing the loop in code. A live run is needed to measure how reliably the model obeys it.

## Never guess which site

`lib/ai/solSiteResolution.ts` (pure, tested in `tests/solSiteResolution.test.ts`) decides which site a request is about, in this order: the site the owner explicitly picked in this chat (the chip, sent as `siteId` + `siteChosen`) > the site bound to the conversation (`SolConversation.siteId`, written when the owner picks one, so later turns don't re-ask) > a pick made by answering the which-site card (read back from the conversation) > the owner's only site > ask.

- The dashboard's current-site cookie (`CURRENT_SITE_COOKIE`) is sent as `siteHintId` and is only a HINT: it orders the choices (that site first), it never decides.
- Two or more sites, none chosen, and the request touches an existing site ("my site", its pages or brand, an edit): SOL's first action is a tap-to-pick card, "Which website is this for?", listing the sites by name plus "A new website". A thin new build folds that question into the intake card as its first question. Classic SOL uses the same tool (and the prompt gives a plain-message fallback).
- A new build for a business the message names, with no site chosen, is simply new (no site is asked about, none lent its brand). With a site chosen and a different business named: "Is this a new website, or part of <Site>?".
- One site: used, and SOL says "I'll work on <Site>." once. No sites: new.
- Only the chosen site's own brand ever enters the brief; an unchosen site's colours, logo or name never do (tested).

## The quality gate (enforced in code)

`lib/ai/solQuality.ts` (pure, `tests/solQuality.test.ts`) scores a compiled page and returns specific findings, each with a fix. `lib/ai/solQualityRun.ts` runs it inside the tool-result path in `lib/ai/solAgent.ts`: after `site_create`, `page_create_from_template`, `page_edit` and `create_site_from_template`, the stored page (working copy first) is checked and the result carries a `qualityCheck` note. If SOL then tries to finish with a must-fix item open, the loop refuses and sends it back to fix it (at most 3 rounds per turn, and never beyond the step limit); after that SOL is told to say plainly what is left.

What it checks (must = blocks "done", should = costs score):
- Placeholders: lorem ipsum, "Your headline here", "Welcome to our website", John Doe, example emails and fake phones, "Service 1", editor placeholder text, the page kit's own sample wording (must).
- Sections: no empty sections (must); a finished page has 4+ content sections (should).
- Headings: exactly one h1, none empty (must); no level jumps, headlines not too long (should).
- Calls to action: a button in the hero, and one in the last two sections (must); too many hero buttons or vague labels (should).
- Images: no empty grey slots or empty-block placeholders, alt text on every image, no placeholder or private sources (must).
- Contrast: every text colour against its real background, computed from the compiled CSS variables (WCAG AA, 4.5:1, 3:1 for large text) (must).
- Brand: the owner's main colour is used, the business name is on the page and spelled consistently, their logo is in the header when they gave one (must); their other colours and fonts (should).
- Search and sharing: a specific title and a search description (must); title/description quality, og:image (should).
- Links: no "#" or empty links, in-page anchors exist, internal paths exist on the site, mailto and tel are well formed and not placeholders (must).
- Forms: a destination, fields and a send button (must).
- Mobile: viewport tag (must); fixed widths over 480px, text under 12px, buttons under 44px (should).
- Rhythm and copy: one consistent section spacing, no repeated sentences, no generic filler ("world-class", "high quality"), reading grade at most about 10 (should); "Feature"/"Service" headings (must).
- Weight and motion: over 900 KB is a must; heavy pages, embedded large images, over 40 images, lots of animation (should).

Enforced in code: running the gate, attaching the verdict to the tool result, refusing to finish with open must-fix items (bounded). By instruction only: the creative bar (distinctive layouts per industry, typography, whitespace, social-proof structure, restrained motion, following a rich brief's structure exactly), the plain-words summary and 2-3 next improvements, and not mentioning scores to the owner.

Known gaps: the form success state can't be seen in compiled markup, so it isn't checked. The kit's own default muted text colour (`--color-text-muted`, #A8A29E) is 2.5:1 on white, so kit pages that use it fail the contrast check until SOL darkens that text or the SDK's default is fixed (a follow-up for the SDK). The visual review (desktop and phone screenshots described back to the model) is not built: the existing screenshot service (`lib/projects/screenshot.ts`, `lambda/browser`) needs a public address, and a draft page has none, so it only works after publishing. Follow-up: a `page_screenshot` tool for published pages, called once after publish and shown to the model for self-critique.
