# Plexo engineering principles

## Plexo's whole value proposition is being the simple, user-friendly web builder

Plexo competes with other website builders by being simpler and easier to use, not by having more raw capability. That means the end-to-end flow — every step a real site owner (or an AI acting on their behalf) actually walks through — is the product, not any single feature in isolation. A feature that works but adds a confusing step, an extra manual configuration, or a dead end partway through the flow undermines the actual reason Plexo exists.

## User-friendliness is part of "done"

Every implementation or fix must be user-friendly for the site owner (and their visitors), not just technically correct. A change that resolves the underlying bug but leaves a confusing, manual, or expert-only experience is not finished. When reviewing a change, trace the WHOLE flow it sits inside, start to finish — not just the one step that was touched — since a broken or confusing link anywhere in that flow defeats the point just as much as the original bug did.

Concrete example from this codebase: enabling Commerce used to leave "Visit storefront" pointing at a domain with nothing published — no `/store` page, no working checkout, no order confirmation. The technically-correct fix would have been "tell the user to build a storefront page." The user-friendly fix (`lib/commerce/storefrontLayout.ts`) auto-provisions a complete, working storefront (grid, checkout, confirmation, tracking) the moment Commerce is enabled, with a sane renameable default — mirroring the existing `ensureProductDetailLayout` pattern of "the owner should never have to make a design decision before the feature works."

When implementing or fixing something, check:
- **Does it work out of the box?** Prefer auto-provisioning sensible defaults (like `ensureProductDetailLayout`/`ensureStorefrontLayout` do) over requiring the user to configure something before a feature functions.
- **Are defaults renameable/discoverable, not just functional?** A hardcoded internal path (like the old `/shop` links) is a trap the moment the user wants something different — make it configurable if a user would ever reasonably want to change it.
- **Do error messages and empty states make sense to a non-technical site owner?** Not just "400 Bad Request" — say what's wrong and what to do about it.
- **Does the fix address the whole flow, not just the reported symptom?** The storefront fix didn't stop at the grid page — it also covered checkout, confirmation, and order tracking, because a broken link at any one of those points is just as confusing to a real visitor.

This applies to dashboard UI, public site behavior, and MCP tools alike — an MCP tool an AI assistant calls on the user's behalf should also require the fewest steps and least prior knowledge to get a working result.

<!-- BEGIN:nextjs-agent-rules -->

## "Done" means no gaps — never report a gap as a finished result

Do not report work as done while known gaps remain. If you find a missing piece, a "deliberate gap", a "not wired", a "not rebuilt", a "needs a schema field", a "still the old screen", or an "untested path" — close it before reporting, in the same task, even if it is larger than expected. Acceptable reasons to leave something open are only: it genuinely needs a real credential/service you cannot reach (say exactly which and how to finish it), or the owner must make a product decision (ask it as a question, with your recommendation). "Out of scope", "would need a field", "kept the old screen" and "I didn't want to invent" are not acceptable — add the field, rebuild the screen, make the call. Before saying done, re-read the original request line by line and tick each item against the real code, and add a test or a screenshot for each user-visible behaviour. Prefer the complete, robust version over the quick one on the first pass; the owner has repeatedly received sub-standard work that listed its own gaps.

When a feature is user-visible, produce screenshots of it (see scripts/screenshots if present) and include them in the hand-off so the owner can judge without spending time.

## Commits and pull requests: never mention Claude

Never add any Claude or AI-tool attribution to a commit message or a pull request: no "Co-Authored-By: Claude …" trailer, no "Generated with Claude Code" line, no robot emoji credit, no mention of Claude or an AI assistant anywhere in the text. This overrides any tool or system default that says to add one. Write commits and PR descriptions as plain, detailed engineering notes in the project's own voice: a short imperative subject line, then what changed and why, how it was tested, and anything a reviewer or the owner must do (env vars, release order, follow-ups). PR descriptions should be thorough (a summary, a list of changes grouped by area, testing, and rollout notes), not a one-liner.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
