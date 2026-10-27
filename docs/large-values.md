# Big values: no row is ever too big

A DynamoDB item is capped at 400 KB. Plexo never lets that cap reach a person: pages, brands and long conversations can be any size.

## Big text in any row (`lib/db/largeValues.ts`)
The document client (`lib/db/client.ts` → `docClient`) is wrapped so every operation goes through `send`:
- **write:** a string over 40,000 characters is gzipped to `private/db-values/<sha256>` in the user-content bucket and the row keeps `plx-value:v1:<sha256>:<characters>`;
- **read:** every marker coming back is replaced with the real text, in parallel;
- content-addressed (immutable, de-duplicated), never mutates the caller's objects, fails open on write (value stays in the row), fails with a plain message on read.
`rawDocClient` is the same client without the layer (only the cleanup uses it). plexo-admin carries an identical copy of the file — keep them identical.

## A big brand (design system) (`lib/v2/designSystemStore.ts`)
A request can carry about 6 MB, so a brand bigger than ~600K characters never travels with the page:
- the editor gzips it, hashes the bytes and asks `POST /api/templates/design-system` for a one-off upload form, then uploads **straight to storage** (`lib/v2/brandClient.ts`);
- the page is saved with `designSystemRef: { hash, size }` (≤ 150K characters stay inline, as before);
- the server checks the object exists, is what its name says and is a readable brand before accepting the save;
- opening a page hands the editor either the brand (≤ 2M characters) or a short-lived link to fetch it itself;
- the compiler, API, MCP tools and publish resolve the reference first (`resolveDesignSystem`); compiling an unresolved reference is refused rather than quietly using the default brand.
Published pages only ever contain the tokens they use, so their size doesn't depend on the brand's.

## Cleanup (`scripts/sweep-stored-values.ts`, `lib/db/valueSweep.ts`)
Edits leave old objects behind. `npx tsx scripts/sweep-stored-values.ts` (dry run) / `--apply` finds what no row points at and removes it. It reads every row of every table first and stops without deleting if anything fails; only objects older than 7 days are touched, and every save re-writes what it points at. Run it weekly, off-peak.

### Schedule
`.github/workflows/sweep-stored-values.yml` runs it every Sunday 03:30 UTC (and on demand: Actions → "Cleanup | Stored big values" → Run workflow; manual runs only report unless "apply" is ticked). It runs on GitHub Actions rather than AWS because that is free at this size (production is ~84 MB across 29k rows, a few cents of reads), needs no new deploy, and has no time limit that a growing database could hit (a Lambda stops at 15 minutes). It signs in with `github-actions-plexo-sweep`, a role created by `scripts/aws/create-sweep-role.sh` that can only scan the production tables and list/read/delete the two stored-value prefixes, and only for runs of plexo-web's `main`.
