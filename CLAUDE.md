# Plexo engineering principles

## User-friendliness is part of "done"

Every implementation or fix must be user-friendly for the site owner (and their visitors), not just technically correct. A change that resolves the underlying bug but leaves a confusing, manual, or expert-only experience is not finished.

Concrete example from this codebase: enabling Commerce used to leave "Visit storefront" pointing at a domain with nothing published — no `/store` page, no working checkout, no order confirmation. The technically-correct fix would have been "tell the user to build a storefront page." The user-friendly fix (`lib/commerce/storefrontLayout.ts`) auto-provisions a complete, working storefront (grid, checkout, confirmation, tracking) the moment Commerce is enabled, with a sane renameable default — mirroring the existing `ensureProductDetailLayout` pattern of "the owner should never have to make a design decision before the feature works."

When implementing or fixing something, check:
- **Does it work out of the box?** Prefer auto-provisioning sensible defaults (like `ensureProductDetailLayout`/`ensureStorefrontLayout` do) over requiring the user to configure something before a feature functions.
- **Are defaults renameable/discoverable, not just functional?** A hardcoded internal path (like the old `/shop` links) is a trap the moment the user wants something different — make it configurable if a user would ever reasonably want to change it.
- **Do error messages and empty states make sense to a non-technical site owner?** Not just "400 Bad Request" — say what's wrong and what to do about it.
- **Does the fix address the whole flow, not just the reported symptom?** The storefront fix didn't stop at the grid page — it also covered checkout, confirmation, and order tracking, because a broken link at any one of those points is just as confusing to a real visitor.

This applies to dashboard UI, public site behavior, and MCP tools alike — an MCP tool an AI assistant calls on the user's behalf should also require the fewest steps and least prior knowledge to get a working result.
