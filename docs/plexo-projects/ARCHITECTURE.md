# Plexo Projects — full-stack React apps on Plexo

Status: in progress on `feat/plexo-projects`.

**Goal:** Plexo builds any kind of web app from a prompt (SOL / MCP) or by hand (Code Mode),
at Lovable's standard or better. Someone arriving from Lovable should find everything they
rely on, working the same way or better, and nothing missing. Other Charisol apps can also
deploy React code to Plexo and get links back (Deploy API).

Raw HTML pages (`RAW_UPLOAD`) and builder pages (`BUILDER`) keep working exactly as they do.
A project is a third kind of site: `Template.sourceType = "REACT_PROJECT"`.

## What "done" means

Ten benchmark prompts must each build, run, and publish with no human code fixes:
todo app with accounts · booking system · CRM · members-only portal · marketplace with
checkout · SaaS dashboard with charts · blog/CMS with admin · internal tool over a table ·
form-to-email workflow with a server function · multi-page marketing site.

## Where Plexo goes beyond Lovable

| Area | Plexo |
| --- | --- |
| Edits | Targeted find/replace edits, not whole-file rewrites: faster, cheaper, can't drop code |
| Builds | Every build is of an immutable version, so any preview is reproducible and revertable |
| Database | Separate **preview** and **live** databases: migrations hit preview first, live only on publish |
| Security | RLS on by default for every new table; sessions in http-only cookies, not localStorage |
| Backend code | Real server functions with secrets and cron schedules, built in |
| Git | GitHub sync never force-pushes; conflicts become a pull request |
| Manual editing | Code Mode never spends AI credits |
| Scaling cost | App database pauses to $0 compute when idle |

## The pieces

```
 SOL / MCP / Code Mode / Deploy API / GitHub push
            │  writeFiles · editFile · deleteFiles · renameFile
            ▼
 ProjectFile rows (working copy) ──snapshot──► ProjectVersion (manifest in S3)
            │                                   file bodies: S3 …/blobs/<sha256> (stored once)
            ▼
 startBuild ─► SQS ─► ProjectBuildFn (container Lambda)
                       ├ parent: scoped STS creds (this project's S3 prefix + this build row)
                       └ child (no AWS creds): install → Vite build ∥ tsc → bundle functions/
                       → S3 …/builds/<buildId>/site, result.json, log.txt; updates the build row
            ▼
 Template.latestBuildId (preview)  ·  Template.liveBuildId (published)
            ▼
 preview--<id>.<pagesDomain>  and  <site domain>
   → middleware → /pub/[domain] → lib/projects/serve.ts (SPA fallback, injections)
   /__plexo/assets/<buildId>/*  immutable, cached a year at the edge
   /__plexo/api/*  → middleware → /api/runtime/[domain]/* (data, auth, storage, functions)
                     → AppDbFn (VPC) → Aurora Serverless v2 (per-app database + roles)
```

## 1. Project files and versions — `lib/projects/fileStore.ts`
- Working copy = `ProjectFile` rows; content is content-addressed in S3, so versions are
  manifests and identical files are stored once. Paths are case-sensitive.
- Limits: 3,000 files, 10 MB per file, 300 MB per project, 200 files per write.
- `editFile` applies exact find/replace edits (each must match once, or `all: true`).
- `snapshotVersion` / `restoreVersion` / `diffManifests`. A restore is itself a new version,
  so history is linear and every step is undoable.

## 2. Scaffold — `lib/projects/scaffold/template/`
Vite 8 + React 19 + TypeScript 7 + Tailwind CSS v4 + React Router + shadcn/ui-style
components (Radix primitives via `radix-ui`) + Lucide icons + TanStack Query + sonner +
react-hook-form/zod + recharts + motion. Path alias `@/*` → `src/*`. Includes:
- `src/lib/plexo.ts`: the backend client (Supabase-js shape) — `from()`, `auth`,
  `functions`, `storage`, `rpc`.
- `src/lib/plexo-react.tsx`: `AuthProvider`, `useAuth`, `<RequireAuth role?>`.
- `db/migrations/`, `functions/types.ts`, and `PLEXO.md` (conventions the AI follows).
Edit the template, then run `node scripts/build-project-scaffold.mjs` (a test fails if the
generated module is stale).

## 3. Build — `lambda/project-build`
- SQS → container Lambda (x86_64, 10 GB `/tmp`, 15 min, reserved concurrency for
  backpressure; DLQ). A newer build of the same project cancels queued, unstarted ones.
- Dependencies: the image pre-installs the scaffold's set in `/opt/base`. If every
  dependency in `package.json` is satisfied by it, `node_modules` is a symlink and there's no
  install. Otherwise `npm install --ignore-scripts` runs, and the resulting `node_modules`
  is cached per dependency-set hash in S3 for the next build. Only registry versions are
  allowed (no git/file/url specs).
- Plexo owns the build config (plugins, alias, asset prefix `/__plexo/assets/<buildId>/`,
  hidden sourcemaps). A project's own `vite.config.ts` is for local development only.
- Isolation: the toolchain can be made to run project code (Tailwind JS plugins), so the
  build runs in a child process with no AWS credentials. The parent does all AWS I/O with
  credentials narrowed by an STS session policy to this project's S3 prefix and this build's
  DynamoDB row.
- Output: structured errors (`file`, `line`, `column`, `message`, `snippet`, plus a plain
  "what to do" hint), type-check problems (reported, never blocking), function bundles,
  timings and a log.
- A project without `package.json` but with an `index.html` is a static site (or a `dist/`
  built elsewhere, sent through the Deploy API): its files are published as they are.
- When a build finishes it announces itself on BuildEventsQueue; BuildFinalizeFn runs the
  post-build steps (migrations, function deploys, the live switch) exactly once — claimed on
  the build row — so finishing never depends on anyone polling.
- Preview builds tag JSX with `data-plexo-loc` (Select & Edit); release builds don't.

## 4. Serving — `lib/projects/serve.ts`
- Real files are served from the build; any other path gets `index.html` (client routing).
  `.map` files are never served publicly.
- Injected into `index.html`: canonical/robots/JSON-LD defaults, the branding bar (plan-
  gated), the white-label favicon, the analytics beacon (SPA route changes). On **preview
  hosts** only: the error reporter + element inspector bridge (§9).
- Preview: `preview--<10 chars>.<pagesDomain>` serves `latestBuildId`. Published domains
  serve `liveBuildId`. `--` is rejected in published subdomains, so the two can't collide.
- CloudFront behaviors on the published-sites distribution: `__plexo/assets/*` (long cache)
  and `__plexo/api/*` (no cache, all methods).

## 5. App database — `lib/appData`, `lambda/app-db`
- **Aurora Serverless v2 PostgreSQL** in a private VPC (isolated subnets, no NAT), in every
  environment **auto-pausing to 0 ACU** when idle. A paused database wakes in ~15 s. The page
  itself is unaffected (static assets come from the CDN); only the first data call waits.
- Queries run in **AppDbFn**, a small Lambda inside the VPC invoked over the AWS API by the
  app server. It connects with **IAM database authentication** (tokens signed locally, no
  stored passwords, no Secrets Manager per app) and closes idle connections after a few
  seconds so the cluster can pause. Client side: retries `DatabaseResumingException` /
  connection refusal with backoff inside a ~30 s budget; connect timeout 30 s; the Lambda,
  gateway and CloudFront timeouts all sit above that.
- Why not the RDS Data API: it executes every statement under one stored credential. App SQL
  (migrations, RLS policy expressions) run under a shared admin login can switch roles back
  to admin and reach other tenants. Per-app logins remove that whole class of attack.
- Per app, two databases: `app_<id>_dev` (preview) and `app_<id>_live` (published). Roles
  per database: `…_owner` (owns objects, runs migrations, used by server functions) and
  `…_api` (login role for the REST gateway) which can only `SET ROLE` to `plexo_anon` /
  `plexo_authenticated`. Nothing the app runs can reach the platform's admin role.
- Provisioning (platform SQL only, through the RDS Data API as the cluster admin — never
  app SQL) installs the `plexo` schema: `plexo.users`, `plexo.identities`, sessions/tokens,
  `plexo.uid()`, `plexo.role()`, `plexo.email()`, `plexo.migrations`, plus default privileges
  for the two client roles and common extensions (pgcrypto, citext, pg_trgm, uuid-ossp,
  unaccent, vector).
- **RLS on by default**: the migration runner and SQL editor snapshot the tables before
  running owner SQL and switch RLS on for every new `public` table in the same transaction
  (unless that SQL explicitly disables it). Deterministic, and needs no superuser (event
  triggers would). A security check reports tables without RLS, tables nobody can reach, and
  views that bypass RLS.
- Migrations: `db/migrations/*.sql` in name order, applied as `…_owner`, each in a
  transaction, recorded in `plexo.migrations`. Applied to dev on every build and to live on
  publish. A migration never re-runs.
- `clusterId` is recorded per app database, so apps can be spread across clusters later.

## 6. Visitor auth — `lib/appAuth`
- Email + password (scrypt), magic link, password reset, email verification, Google OAuth.
  Accounts live in the app's own `plexo.users`, so app tables reference them with real
  foreign keys and RLS uses `plexo.uid()`.
- Sessions: an opaque random token in an http-only, `SameSite=Lax`, host-only cookie; the
  database stores only its hash, so sign-out and "disable user" are immediate. Sliding expiry.
- Rate limits per IP and per email on every auth endpoint; responses don't reveal whether an
  email has an account.
- Emails (verify, magic link, reset) are sent from Plexo with the app's name, using
  editable defaults.

## 7. Storage — `lib/appStorage`
- Buckets need no setup: `{public|private}/apps/<appId>/<env>/<bucket>/<path>` in the
  user-content bucket. Uploads are presigned POSTs bound to size and content type.
- Access, simple enough to state in one line: visitors upload, list and remove only in their
  own folder (`<user id>/…`); `avatars`/`images`/`media`/`public`/`public-*` buckets are
  publicly viewable, every other bucket is private (signed URLs for the uploader only);
  owners can change a bucket's access and size limit; server functions can do anything. HTML
  and SVG never go in public buckets (no same-site phishing pages).

## 8. Server functions & secrets — `lib/appFunctions`
- `functions/<name>.ts` default-exports `(req: Request, ctx) => Response`. `ctx` = `{ user,
  db (full access), env (secrets), sendEmail }`. `export const schedule = "<cron>"` runs it
  on a schedule (EventBridge Scheduler).
- Each function is its own Lambda (Node 24) with an execution role that has **no**
  permissions, deployed on publish (preview builds deploy a separate `-dev` copy).
  Optional `FUNCTIONS_ACCOUNT_ROLE_ARN` moves them into a separate AWS account.
- Secrets vault: values encrypted with AES-256-GCM under a dedicated platform key
  (APP_SECRETS_ENCRYPTION_SECRET, from SSM), never shown again after saving, fetched by the
  function at cold start through the gateway with the app's service key (so a changed secret
  needs no redeploy). Separate values for preview and live are optional.
- Each environment has a service key whose hash lives in AppSettings; deploys reuse it when
  the deployed functions still hold it, so a deploy never breaks calls in flight.
- Logs: CloudWatch, surfaced in the dashboard per function.

## 9. The editor — `app/dashboard/projects/[id]`
One screen: chat on the left, the app on the right, with these tools:
- **Preview** with viewport toggles (Desktop 1440 / Tablet 768 / Mobile 375), a route bar,
  refresh, open in new tab, and shareable preview link.
- **Select & Edit**: an inspector mode where hovering highlights an element and clicking it
  pins it to the next prompt as `{ file, line, component, text, classes }`. The source
  location comes from `data-plexo-loc` attributes that Plexo's preview builds add to JSX
  elements; published builds never include them.
- **Errors**: preview builds include a reporter for uncaught errors, unhandled rejections,
  React error boundaries and failed `plexo` calls. Errors show as a banner with **Fix with
  AI**, which sends the stack trace, mapped to source through the sourcemap, plus the file to
  SOL. Build errors from §3 get the same button.
- **Code**: a self-hosted Monaco file tree and editor with tabs, search and TypeScript
  IntelliSense. Saves are free (no AI). The preview rebuilds automatically a moment after
  saving. Decision: there is no separate in-browser bundler — the server build (typically a
  few seconds with the pre-installed dependency set) is the single source of truth, so what
  the preview shows is exactly what publishing ships.
- **Changes**: after every AI turn, a side-by-side Monaco diff of what changed, with
  "Keep" (default) or "Revert" for the whole turn. Every turn is already a version.
  **Plan mode** makes SOL propose a plan and wait for approval before editing.
- **Database**: tables list, a spreadsheet-style grid (filter, sort, inline edit, add or
  delete rows, run as owner), a SQL editor, migration history, an RLS warning per table,
  and a preview/live switch.
- **Users**: list, search, disable, set role, send password reset. **Auth settings**: which
  sign-in methods, Google client, email templates.
- **Storage**, **Functions** (logs, schedule, run now), **Secrets**.
- **History**: versions with restore, builds with logs.
- **Publish**: preview → live with a diff summary, a pending-migrations check, and an RLS
  warning. Custom domains reuse the existing CloudFront tenant + ACM flow.
- **GitHub** (§11).

## 10. AI — SOL + MCP
- Tools: `create_app`, `app_list_files`, `app_read_files`, `app_write_files`,
  `app_edit_file`, `app_delete_files`, `app_rename_file`, `app_build` (snapshot → build →
  apply dev migrations → returns errors and type problems), `app_screenshot` (preview host,
  any viewport, returns console errors), `app_runtime_errors`, `app_sql` (dev database, as
  owner), `app_db_schema`, `app_publish`, `app_versions`, `app_restore_version`,
  `app_set_secret` (name only, the value is entered by the owner), `app_function_logs`,
  `app_status`.
- SOL loop for app work: plan → write/edit → `app_build` → fix until clean → screenshot →
  check against the request → summarize. The project's `PLEXO.md` is in context.
- Every tool is also on the MCP server: Claude Desktop and other agents get the same power.
- Destructive tools (`app_delete_files` of many files, `app_restore_version`,
  `app_publish`, SQL that drops/deletes) go through SOL's confirmation gate.

## 11. GitHub sync — `lib/projects/github`
- A Plexo GitHub App (contents read/write, pull requests, metadata, webhooks; "request user
  authorization during installation" on). `ProjectGitLink` stores the installation, repo,
  branch and `lastSyncedCommitSha`.
- Installations are verified before use: the post-install redirect's OAuth code proves which
  installations the person can access (`GET /user/installations`), recorded per organization
  (`GitHubInstallation`). The installation id alone is never trusted.
- Plexo → GitHub: each version becomes one commit via the Git Data API (blobs → tree with
  `base_tree` → commit → fast-forward ref). Only changed files are sent.
- GitHub → Plexo: a signature-verified `push` webhook on the linked branch imports the
  changed files, snapshots a version (source `git`) and builds the preview. Plexo's own
  commits are recognized by sha, so there's no echo loop.
- Conflicts: if both sides changed the same file since the last sync, Plexo commits to
  `plexo/<versionId>` and opens a pull request instead of force-pushing.
- Linking an empty repo pushes the project; linking a non-empty one imports it.

## 12. Deploy API — `app/api/v1/deploy`
For other Charisol apps: send files or a prebuilt `dist`, get a preview link and a live link.

## API schemas

All JSON. Errors are `{ "error": { "message": string, "code"?: string, "hint"?: string } }`
with a message written for a non-technical reader.

### Runtime API (served on the app's own domain at `/__plexo/api`)
| Method & path | Body → response |
| --- | --- |
| `POST /rest/:table` | Query state from `plexo.from()` (`action`, `columns`, `filters[]`, `or[]`, `order[]`, `limit`, `offset`, `count`, `single`, `values`, `onConflict`) → `{ data, count? }` |
| `POST /rpc/:fn` | `{ …args }` → `{ data }` |
| `POST /auth/signup` | `{ email, password, data?, redirectTo? }` → `{ data: { user, needsEmailConfirmation } }` |
| `POST /auth/login` | `{ email, password }` → `{ data: { user } }` + session cookie |
| `POST /auth/magic-link` | `{ email, redirectTo? }` → `{ data: { sent: true } }` |
| `GET /auth/verify?token&type&redirectTo` | → 302 to `redirectTo` + session cookie |
| `GET /auth/oauth/:provider?redirectTo` · `GET /auth/oauth/:provider/callback` | → 302 |
| `POST /auth/logout` | → `{ data: null }` |
| `GET /auth/session` | → `{ data: { user | null } }` |
| `POST /auth/recover` · `POST /auth/reset` · `POST /auth/update` | reset email · `{ token, password }` · `{ password?, currentPassword?, data? }` |
| `POST /storage/:bucket/sign-upload` | `{ path, contentType, size, upsert? }` → `{ data: { url, fields, path, publicUrl } }` |
| `POST /storage/:bucket/sign-download` · `remove` · `GET list` | signed URL · `{ paths }` · `?prefix` |
| `POST /fn/:name` | any → the function's own response |
| `POST /_runtime/errors` (preview only) | `{ message, stack, url, kind }` → 204 |
| `/_service/*` (service key only) | `sql`, `secrets`, `email` — used by server functions |

### Dashboard API (`/api/v1/apps/:id`, session or API key)
| Method & path | Purpose |
| --- | --- |
| `POST /api/v1/apps` | `{ name, prompt? }` → `{ id, previewUrl }` |
| `GET /files` · `GET /files/content?paths=` · `PUT /files` · `PATCH /files` · `DELETE /files` · `POST /files/rename` | list · read · write `{ files[] }` · edit `{ path, edits[] }` · delete `{ paths[] }` · rename |
| `GET /versions` · `POST /versions` · `POST /versions/:v/restore` · `GET /versions/:v/diff?against=` | history · snapshot `{ message }` · restore · diff |
| `POST /builds` · `GET /builds` · `GET /builds/:b` · `GET /builds/:b/log` | start (snapshots first) · list · status + errors · log |
| `POST /publish` | `{ buildId? }` → applies live migrations, deploys functions, flips `liveBuildId` |
| `GET /db/tables` · `GET /db/rows` · `POST /db/rows` · `PATCH /db/rows` · `DELETE /db/rows` · `POST /db/sql` · `GET /db/migrations` | table grid + SQL editor (`?env=dev|live`) |
| `GET /users` · `PATCH /users/:u` · `POST /users/:u/reset` · `GET/PUT /auth-settings` | visitor accounts |
| `GET /secrets` · `PUT /secrets/:name` · `DELETE /secrets/:name` | names only are ever returned |
| `GET /functions` · `GET /functions/:f/logs` · `POST /functions/:f/run` | |
| `GET /runtime-errors` | recent preview errors (for SOL + the error banner) |
| `GET/POST/DELETE /github` · `POST /api/webhooks/github` | link · unlink · inbound pushes |

### Deploy API
| Method & path | Body → response |
| --- | --- |
| `POST /api/v1/deploy` | `{ appId?, name?, files?: [{ path, content? , base64? }], dist?: [...], publish?: boolean, subdomain? }` → `{ appId, versionId, buildId, previewUrl, liveUrl? }` |
| `GET /api/v1/deploy/:buildId` | → `{ status, errors[], previewUrl, liveUrl? }` |

## Visual design (SDK v2 editor) — `lib/projects/designs.ts`
The editor's **Design** tab is the SDK v2 editor (`<V2Editor>` from `@charisol/plexo-sdk/v2`, loaded in the
browser only). Each design is one page of the app, stored as ordinary project files:
- `src/plexo-canvas/<slug>.canvas.json` — the design (`plexo-canvas@2`: the page's node tree, name, route; older `@1` files are upgraded on read) and the
  hash of the code last generated from it.
- `src/plexo-canvas/<Name>Page.tsx` — the page, compiled **on the server** with the
  React-free `@charisol/plexo-sdk/v2/compile` (`compilePageToReact`: desktop, tablet and mobile layouts from the design system; content always emitted as string literals).
- `src/plexo-canvas/routes.tsx` — every design's route; `src/App.tsx` renders them first
  inside `<Routes>` (new apps ship wired; older ones are wired on the first save, or the
  owner gets an "Ask SOL to add it" button when App.tsx was rewritten).
- `src/plexo-canvas/design-system.json` — the app's design system (colours, fonts, shapes, components); changing it restyles every design. A leftover `brand.json` from the old editor is ignored.

Saves happen automatically a moment after each change, then the preview rebuilds. If a
page's `.tsx` was edited by hand (Code Mode, SOL, a GitHub push), saving the design asks
first — "Use the design" or "Keep the code". Page addresses are unique across designs.
API: `GET/POST /api/v1/apps/:id/designs`, `GET/PUT/DELETE /api/v1/apps/:id/designs/:slug`.

## Roadmap (build order)
1. Project model, file store, versions, scaffold, build pipeline, serving, previews.
2. App database (Aurora Serverless v2 + AppDbFn), provisioning, migrations, REST gateway.
3. Visitor auth (password, magic link, reset, verification, Google).
4. Storage, server functions, secrets, schedules, logs.
5. Dashboard API + Deploy API.
6. SOL / MCP app tools and the build → fix → screenshot loop.
7. Editor UI: preview + viewports, Select & Edit, errors + Fix with AI, Code Mode, changes
   diff + Plan mode, database grid + SQL, users, functions, secrets, history, publish.
8. GitHub App sync.
9. SDK v2 canvas → React components; app-type starter templates; benchmark suite.

## Security model
- Every site and every preview has its own origin; dashboard cookies never reach them.
- Builds: no credentials in the process that runs the toolchain; scoped credentials in the
  one that does I/O; registry-only dependencies, install scripts disabled.
- Data: browser code holds no keys; every row access is decided by Postgres RLS under a
  non-owner role; tables are RLS-on by default; per-app database logins via IAM.
- Server functions: zero AWS permissions, optionally a separate account; secrets encrypted
  with KMS and never returned to the dashboard after saving.
- Rate limits on auth endpoints, per-app request quotas, and request size limits on every
  write path.
