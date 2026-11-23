# Agent instructions: plexo-web

Read `CLAUDE.md` for the project overview. These rules are for UI work and apply from now on.

## Plexo frontend conventions

- Start with modals (the Host a site modal and its success dialog). Extend to other UI when asked.
- Colours and sizes come from the Strata theme: the CSS variables in `lib/theme.ts`, such as `var(--brand)`, `var(--surface)`, `var(--surface-border)`, `var(--text-main)`, `var(--text-muted)` and `var(--bg)`. Never type a hex or rgba colour in feature code. A brand purple belongs only in `lib/theme.ts`; `tests/themeCentralised.test.ts` enforces this.
- Known exception: `#fff` is used for text on brand buttons, because the theme has no text-on-brand token. Add one to `lib/theme.ts` before using anything else.
- Put the main exported component at the top of its file. Helpers, constants and styles go below it.
- Keep UI components in the feature's `_components` folder. Pages orchestrate state and data; they don't declare UI sub-components inline.
- Conditional class names: use `cn()` from `@/lib/utils`, not template literals with ternaries. Not yet in this repo: add `lib/utils.ts` (clsx and tailwind-merge) before the first use.
- Use named Tailwind scale utilities (`text-xs`, `text-sm`), never arbitrary pixel values such as `text-[12px]`.
- Wrap a shared UI primitive in a project component before using it in feature code.
- Data layer: follow the existing request and hook pattern of the feature. This repo doesn't use TanStack Query; adopting it needs a decision first.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
