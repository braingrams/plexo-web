# Plexo's own brand, live from Strata

Plexo's colours, font, radii and logos come from the Plexo project in Strata
(project id `01a1e54e-ab9a-779c-be4f-dba969d7bb45`). Change them there and Plexo follows with no
code change and no deploy.

## The contract

Roles and metadata, never URLs or asset ids.

| Plexo uses | Strata LOGO asset |
| --- | --- |
| `wordmark-on-light` | role `PRIMARY` (SVG) |
| `wordmark-on-dark` | role `MONO_LIGHT` (SVG) |
| `email-on-light` | no role, metadata `usage: email`, `background: light`, PNG/JPEG/WebP (Gmail cannot show SVG) |
| `email-on-dark` | no role, metadata `usage: email`, `background: dark`, PNG/JPEG/WebP |
| `icon` | role `FAVICON` |
| `app-icon` | role `SOCIAL_AVATAR` (also the browser-tab and home-screen icon) |

If several active assets match, the newest wins (`updatedAt`/`createdAt` if present, otherwise the
last in the list). Tokens: `--color-brand-primary/secondary/accent`, `--color-action-primary(-hover)`,
`--color-bg-page/surface/muted`, `--color-border-default/strong`, `--color-text-primary/secondary`,
`--color-focus-ring`, `--font-family-base`, `--radius-md/lg`. Values may be `var(--other)` references.
Dark mode stays derived inside Plexo; it takes primary, accent, font and radii from Strata.
Not mapped on purpose: `text-inverse`, `action-secondary` (see `mapStrataTokens`).

## Changing things

- Logo: in Strata, replace the asset that has the same role (or the same email metadata). No Publish needed; live within about 5 minutes.
- Colours/fonts: edit the tokens and press **Publish**; live within about 60 seconds.
- A new font family must also be loaded by Plexo (a system font works immediately; "Plus Jakarta Sans" is already loaded).

## Safety rules

Colours must be hex, `rgb()` or `hsl()`; fonts only letters, digits, spaces, commas, quotes, `.-_`;
radii `px`/`rem`; logo URLs https on the snapshot host or `*.cloudfront.net`. Anything else is dropped for
that token only and the bundled value is used. The text colour on the brand colour is chosen
automatically (`#121212` or `#FFFFFF`, whichever has more contrast), so a dark primary gets white text.
If background/text pairs would fall below 4.5:1 the bundled pair is kept. Logos: max 2MB, content type
png/jpeg/webp/svg, scripted SVGs refused, SVG served with `Content-Security-Policy: default-src 'none'`.

## Where it is used

Dashboard (`V3Root`), `PlexoLogo`, auth pages (`plexoBrandCssVars()`), emails (`EMAIL_COLORS`, `EMAIL_LOGO`),
receipt PDF, favicon and apple icon. Logos are served from our own stable URL
`/api/brand/logo/<kind>` (public, cached 5 minutes), which is what emails embed forever.

## Switches and caching

| Env (all optional) | Default |
| --- | --- |
| `PLEXO_BRAND_STRATA` | on; `off` = bundled brand only, no network |
| `PLEXO_BRAND_STRATA_PROJECT_ID` | the Plexo project above |
| `STRATA_PUBLIC_API` | `https://api-production-charisol-design-system-be.aws.charisol.io` (root, without `/v1`) |
| `STRATA_SNAPSHOT_BASE` | `https://snapshot.strata.charisol.io` |

Tokens: in-memory, 60s, one refresh at a time, 3s timeout, last good value served for up to 24h when
Strata fails; a slow refresh never delays a render by more than about 0.8s once a value exists. Emails are
built synchronously, so they use the last-known-good palette (bundled on the first email after a cold start).
Fallback: bundled files in `lib/brand/fallback/` (embedded in `lib/brand/fallbackAssets.ts`; regenerate with
`node scripts/genBrandFallback.mjs`).

## Adding a logo variant

1. Publish the asset in Strata with a role or metadata that identifies it.
2. Add the kind to `LOGO_KINDS` and a matcher in `lib/brand/strataTokens.ts`, the field in `PlexoBrand.logos` and `lib/brand/plexoLogos.ts`.
3. Add its bundled file to `scripts/genBrandFallback.mjs`, regenerate, and add it to the tests.
