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

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
