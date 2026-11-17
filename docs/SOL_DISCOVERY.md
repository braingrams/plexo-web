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
5. `lib/ai/solSiteContext.ts` + `solChatHandler.ts`: the most recently edited site's own brand is added to the profile as `currentSite`.
6. `site_save_look` tool (`lib/mcp/siteTools.ts`) through `lib/sites/saveLook.ts`, the same code the Brand tab's `PUT /api/v1/sites/[id]/look` now uses, so SOL saves colours and logo choice (after the owner agrees, asked in plain words) and Home's "logo and colours" step ticks.
7. `AskCard` (V3 only): "Question 2 of 5", "Skip, you choose" per question, "Just build it" for the rest. `ask_user_question` takes up to 6 questions.
8. Eval: `tests/fixtures/solEvalPrompts.json` (16 prompts) and `scripts/sol-eval.ts`.

## Running the eval

Offline (no key, no cost), records the extracted brief, richness, questions and direction per prompt:

    npx tsx scripts/sol-eval.ts > eval-after.json

To compare with before, run it on the previous commit's checkout of the prompt (or just compare questions asked live):

    ANTHROPIC_API_KEY=... npx tsx scripts/sol-eval.ts --live > eval-live.json

`--live` sends each prompt with the real system prompt and records the first reply (the questions it asked). It spends credits; it is never run in CI.

## Known limits

- Colours of an attached logo are read by the model (it sees the image); the server does not decode images (no image library in the bundle). `dominantColors` (`lib/onboarding/logoColors.ts`) is used where pixels exist in the browser.
- The intake card is enforced by instruction ("your first action is exactly this call"), not by pausing the loop in code. A live run is needed to measure how reliably the model obeys it.
- The site brand is the most recently edited site's; the chat is not yet bound to a site.
