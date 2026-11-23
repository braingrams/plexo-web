import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-ops. Field shapes ported 1:1 from schema.prisma.
//
// Correction to the original roadmap's "TTL-heavy by design" framing: AdminAuditLog and
// FormSubmission are real, permanent data (a compliance trail; a site owner's actual
// contact-form leads) — not ephemeral operational noise like PageView/RateLimit/
// StockCache. DynamoDB's TTL is opt-in per item even though the table designates one
// attribute name for it (see cdk/lib/data-stack.ts) — these two entities simply never
// populate `ttl`, so they're never auto-deleted, while the other three are.

const table = TABLES.ops;

const days = (n: number): number => Math.floor(Date.now() / 1000) + n * 24 * 60 * 60;
const hours = (n: number): number => Math.floor(Date.now() / 1000) + n * 60 * 60;
const minutes = (n: number): number => Math.floor(Date.now() / 1000) + n * 60;

export const PageView = new Entity(
  {
    model: { entity: "pageView", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      domain: { type: "string" },
      ipHash: { type: "string" },
      userAgent: { type: "string" },
      country: { type: "string" },
      region: { type: "string" },
      city: { type: "string" },
      deviceType: { type: "string" },
      browser: { type: "string" },
      os: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // 180 days — enough for year-over-year-lite comparisons on a dashboard without
      // unbounded analytics growth, matching the original cost model's assumption.
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "PAGEVIEW#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Pre-aggregated rollup for platform-wide PageView analytics (plexo-admin's Overview
// dashboard: daily totals, hour-of-day heatmap, device/browser/OS breakdown, top sites).
// PageView's own primary key is templateId-scoped (one partition per site) — great for
// "this site's traffic," but a platform-wide aggregate has no realistic per-key access
// pattern to hang a GSI off of, and raw PageView volume grows unboundedly with real
// traffic, unlike every other entity plexo-admin's dashboard bounded-scans (accounts,
// domains, templates, admin actions — all bounded by account/catalog size, not traffic).
// So instead of a GSI or a scan, every PageView write also atomically increments a small,
// fixed set of rollup counters for that day — the dashboard then reads N days of small,
// bounded rollup rows instead of scanning however many millions of raw page views exist.
//
// One row per (date, dimension#value) — not one row per date with nested map counters,
// because ElectroDB/DynamoDB's atomic `ADD` only increments plain top-level numeric
// attributes cleanly; a dynamic key inside a map attribute needs a hand-rolled
// UpdateExpression per key, which doesn't compose with ElectroDB's `.add()` builder the
// same way. Sparse rows per dimension avoids that entirely at the cost of a few more
// small items per day (bounded by device/browser/OS cardinality + daily distinct
// templates-with-traffic, not by raw view count).
export const PageViewDailyStat = new Entity(
  {
    model: { entity: "pageViewDailyStat", version: "1", service: "plexoOps" },
    attributes: {
      date: { type: "string", required: true }, // "YYYY-MM-DD", UTC
      // "TOTAL" | "HOUR#<0-23>" | "DEVICE#<type>" | "BROWSER#<name>" | "OS#<name>" |
      // "SITE#<templateId>" — see recordPageViewRollup in lib/analyticsRollup.ts, the
      // only writer. Kept as a plain string (not a union) since device/browser/os/site
      // values are open-ended, unlike PageView's own attributes.
      dimension: { type: "string", required: true },
      views: { type: "number", default: 0 },
      // Matches PageView's own 180-day retention — a rollup for data that's about to be
      // deleted has nothing left to roll up.
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      // One partition per day (not one global partition) — spreads write load across
      // days instead of funneling every page view platform-wide into a single hot
      // partition, while still making "read the last N days" a small, bounded number of
      // single-partition queries (one per day) rather than a scan.
      primary: {
        pk: { field: "pk", composite: ["date"], template: "PVDAY#${date}" },
        sk: { field: "sk", composite: ["dimension"], template: "DIM#${dimension}" },
      },
    },
  },
  { table, client: docClient },
);

export const RateLimit = new Entity(
  {
    model: { entity: "rateLimit", version: "1", service: "plexoOps" },
    attributes: {
      key: { type: "string", required: true },
      count: { type: "number", required: true, default: 0 },
      lastRequest: { type: "number", required: true },
      // 1 hour — rate-limit windows are short-lived by nature; a stale counter beyond
      // its window is meaningless and should vanish, not accumulate.
      ttl: { type: "number", default: () => hours(1) },
    },
    indexes: {
      // Single item per key — no separate id needed the way Prisma's cuid() gave it one;
      // the key itself IS the natural, sufficient primary key.
      primary: {
        pk: { field: "pk", composite: ["key"], template: "RATELIMIT#${key}" },
        sk: { field: "sk", composite: [], template: "RATELIMIT" },
      },
    },
  },
  { table, client: docClient },
);

export const StockCache = new Entity(
  {
    model: { entity: "stockCache", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      provider: { type: "string", required: true },
      query: { type: "string", required: true },
      results: { type: "any", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // 7 days — a stock-photo search-result cache going stale after a week is fine;
      // permanent caching isn't worth the storage for search terms that rarely repeat.
      ttl: { type: "number", default: () => days(7) },
    },
    indexes: {
      // provider+query as the key enforces @@unique([provider, query]) for free.
      primary: {
        pk: { field: "pk", composite: ["provider", "query"], template: "STOCKCACHE#${provider}#${query}" },
        sk: { field: "sk", composite: [], template: "STOCKCACHE" },
      },
    },
  },
  { table, client: docClient },
);

// An OAuth authorization code (RFC 6749 §4.1.2 / RFC 6749 §10.5's short-lifetime
// requirement — 10 minutes here). Replaces the previous /mcp/login behavior of handing
// back a real, long-lived API key directly as the "code" — this is a genuinely
// short-lived, single-use, PKCE-bound value that only /api/v1/auth/oauth/token can
// redeem for a real credential, so the code itself is worthless if intercepted in transit
// or logged (e.g. in a proxy's access log) the way a real API key handed over in a URL
// query string would not be.
export const OAuthAuthorizationCode = new Entity(
  {
    model: { entity: "oauthAuthorizationCode", version: "1", service: "plexoOps" },
    attributes: {
      code: { type: "string", required: true },
      clientId: { type: "string", required: true },
      redirectUri: { type: "string", required: true },
      // PKCE (RFC 7636) — optional at the type level since a confidential client could in
      // principle skip it, but every real MCP client uses PKCE, and /token requires it
      // whenever codeChallenge is present on the record.
      codeChallenge: { type: "string" },
      codeChallengeMethod: { type: ["S256", "plain"] as const },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // Explicit single-use flag, checked in application code — DynamoDB's own TTL sweep
      // (via `ttl` below) can lag up to 48 hours behind the actual expiry, so it's a
      // storage-cost cleanup, not the thing enforcing single-use or the 10-minute window.
      used: { type: "boolean", default: false },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: () => minutes(10) },
    },
    indexes: {
      // The code itself is the natural, sufficient key — same "no separate id needed"
      // reasoning as RateLimit above.
      primary: {
        pk: { field: "pk", composite: ["code"], template: "OAUTHCODE#${code}" },
        sk: { field: "sk", composite: [], template: "OAUTHCODE" },
      },
    },
  },
  { table, client: docClient },
);

export const AdminAuditLog = new Entity(
  {
    model: { entity: "adminAuditLog", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      actorId: { type: "string", required: true },
      action: { type: "string", required: true },
      targetType: { type: "string", required: true },
      targetId: { type: "string", required: true },
      metadata: { type: "any" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // No ttl attribute populated — see file header. A compliance/audit trail must not
      // silently disappear.
    },
    indexes: {
      // "what has this admin done" (prisma: @@index([actorId])).
      primary: {
        pk: { field: "pk", composite: ["actorId"], template: "ACTOR#${actorId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "AUDIT#${createdAt}#${id}" },
      },
      // "what has happened to this target" (prisma: @@index([targetType, targetId])) —
      // e.g. every admin action ever taken on a specific user or org.
      byTarget: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["targetType", "targetId"], template: "TARGET#${targetType}#${targetId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "AUDIT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// createdAt-only listing (prisma: @@index([createdAt]) — a platform-wide activity feed
// across all admins) stays a documented gap, same "real but didn't earn the GSI slot"
// discipline as elsewhere — actorId and target are the two patterns actually exercised.

/**
 * A short record of things that look like an attack or abuse (lib/security/events.ts). Expires after 90 days on its own, so it can
 * never grow without bound. Partitioned by day so "what happened lately" is a handful of cheap queries, never a scan.
 */
export const SecurityEvent = new Entity(
  {
    model: { entity: "securityEvent", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      // YYYY-MM-DD, set from createdAt so callers never pass it.
      day: { type: "string", required: true, default: () => new Date().toISOString().slice(0, 10) },
      type: { type: "string", required: true },
      detail: { type: "string", required: true },
      ip: { type: "string", required: true },
      actorId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: () => days(90) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["day"], template: "SECEVENT#${day}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "EVT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

/**
 * Addresses visitors asked for that don't exist on a site, with how many times (Redirects, "Pages people couldn't find").
 * One row per site and address; a row expires 30 days after the last visit, so the list can never grow without bound.
 */
export const NotFoundHit = new Entity(
  {
    model: { entity: "notFoundHit", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      path: { type: "string", required: true },
      count: { type: "number", default: 0 },
      lastSeen: { type: "string", default: () => new Date().toISOString() },
      referrer: { type: "string" },
      ttl: { type: "number", default: () => days(30) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "NOTFOUND#${templateId}" },
        sk: { field: "sk", composite: ["path"], template: "PATH#${path}" },
      },
    },
  },
  { table, client: docClient },
);

export const FormSubmission = new Entity(
  {
    model: { entity: "formSubmission", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      formName: { type: "string", default: "Website Form" },
      fields: { type: "any", required: true },
      submitterIp: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // No ttl attribute populated — see file header. These are a site owner's real
      // contact-form leads, not disposable operational data.
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "SUBMISSION#${createdAt}#${id}" },
      },
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "SUBMISSION#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

/**
 * Where a site's form sends each submission besides the Form Submissions inbox and the
 * owner's email: a MailDrip list (the site's own connected account) and/or a webhook
 * (Zapier, Make, a CRM). One row per form, keyed by the form's name — the same name
 * submissions are filed under. Written from the Form Submissions page, the MCP tool, or a
 * WordPress migration carrying over what the form did on WordPress.
 */
export const FormSettings = new Entity(
  {
    model: { entity: "formSettings", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      formName: { type: "string", required: true },
      maildripGroupId: { type: "string" },
      maildripGroupTitle: { type: "string" },
      webhookUrl: { type: "string" },
      /** How the webhook receives it: JSON (Plexo's default), or form-encoded fields under their labels — what a WordPress form plugin's webhook sent, so an existing receiver keeps working. */
      webhookFormat: { type: ["json", "form"] as const },
      /** Where visitors go after submitting (a thank-you page) — a path on the site or a full address. */
      redirectUrl: { type: "string" },
      /** Where this setup came from, e.g. "wordpress" when a migration carried it over. */
      source: { type: "string" },
      /** What the form did on WordPress that Plexo couldn't repeat, in plain words — shown beside it. */
      note: { type: "string" },
      /** The "I'm not a robot" check this form had (lib/forms/captcha.ts): provider and the owner's public site key. */
      captchaProvider: { type: ["turnstile", "recaptcha", "hcaptcha"] as const },
      captchaSiteKey: { type: "string" },
      /** The owner's secret key, encrypted. The check only runs once this is saved — until then the form uses the honeypot alone. */
      captchaSecretEncrypted: { type: "string" },
      lastDeliveredAt: { type: "string" },
      /** The last delivery problem, shown to the owner until a delivery succeeds again. */
      lastDeliveryError: { type: "string" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["formName"], template: "FORMSETTINGS#${formName}" },
      },
    },
  },
  { table, client: docClient },
);

// Queryable record of every transactional/notification email send attempt — replaces the
// previous state of scattered, inconsistent console.error/console.info calls with no way
// to answer "did this email actually send." Covers both send paths: MailDrip (HTTP API)
// and direct SMTP (no longer used; kept so old rows still read) — see lib/mail/logEmail.ts, the one writer.
export const EmailLog = new Entity(
  {
    model: { entity: "emailLog", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      // Not every send has an organization — a pre-signup account-security email
      // (verification, password reset) fires before the user has one.
      organizationId: { type: "string" },
      templateId: { type: "string" },
      kind: { type: ["maildrip", "smtp"] as const, required: true },
      to: { type: "string", required: true },
      subject: { type: "string", required: true },
      status: { type: ["sent", "failed"] as const, required: true },
      errorMessage: { type: "string" },
      // Short, stable free-text label identifying the call site (e.g.
      // "verification_email", "invitation", "commerce_receipt") — see
      // lib/mail/logEmail.ts's EmailDeliveryContext for the full set.
      context: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // Kept six months, then removed by DynamoDB itself, so the log can't grow without bound. (Rows written before
      // this was added have no ttl and stay.)
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      // id is the only attribute every row is guaranteed to have (organizationId isn't),
      // so it's the natural primary key — same "no realistic per-key access pattern to
      // hang the primary index off of" situation OAuthAuthorizationCode/RateLimit/
      // StockCache solve by keying on their own single natural id and giving sk no
      // composite of its own.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "EMAILLOG#${id}" },
        sk: { field: "sk", composite: [], template: "EMAILLOG" },
      },
      // "list recent logs for an organization" — the dashboard's actual read pattern.
      // Reuses GSI1, already provisioned on this table (see cdk/lib/data-stack.ts) and
      // already shared by AdminAuditLog.byTarget and FormSubmission.byOrg — single-table
      // design means multiple entities can each define their own GSI1PK/GSI1SK template
      // on the same physical index without any CDK change. Same shape as
      // FormSubmission.byOrg exactly (organizationId partition, createdAt+id sort).
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "EMAILLOG#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// SolUsageEvent: a permanent, no-TTL analytics log of every completed SOL chat turn — the
// SOL-specific counterpart to AdminAuditLog above (same "real, permanent event log, no ttl
// populated" discipline, see file header) and PageViewDailyStat's atomic-rollup precedent
// for SolDailyStat below. Written by lib/solAnalytics.ts's recordSolUsageEvent, fired
// fire-and-forget right after lib/db/ledgerOperations.ts's chargeUsage() charges credits
// for the turn (see that file — this is a sibling write, not a replacement). Holds no
// prompt/response text itself — see SolUsageEventContent, a separate short-TTL entity,
// for that. Byte-for-byte mirrored in plexo-admin's lib/db/opsEntities.ts (read-only
// there) — keep both copies identical.
export const SolUsageEvent = new Entity(
  {
    model: { entity: "solUsageEvent", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      provider: { type: "string", required: true }, // e.g. "bedrock_claude"
      tier: { type: ["BASIC", "MEDIUM", "HIGH"] as const, required: true },
      inputTokens: { type: "number", default: 0 },
      outputTokens: { type: "number", default: 0 },
      creditsCharged: { type: "number", default: 0 },
      latencyMs: { type: "number" },
      outcome: { type: ["success", "error", "timeout"] as const, required: true },
      errorCode: { type: "string" },
      // Array of {name, destructive, confirmed, executed, errorCode} — schema-free, same
      // "replay-verbatim, don't force a rigid shape" reasoning as SolMessage.content in
      // lib/db/solEntities.ts.
      toolCalls: { type: "any" },
      attachmentCount: { type: "number", default: 0 },
      // string[] of attachment mime/kind labels — kept as "any" rather than a typed list
      // since the open-ended set of attachment kinds isn't worth a union here.
      attachmentTypes: { type: "any" },
      voiceTranscriptUsed: { type: "boolean", default: false },
      // Set later, after the turn completes, by recordSolFeedback's .patch() — absent at
      // creation time.
      feedback: { type: ["UP", "DOWN"] as const },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // No ttl attribute populated — permanent, same discipline as AdminAuditLog/
      // FormSubmission/EmailLog above.
    },
    indexes: {
      // A conversation's SOL usage history, chronological — mirrors SolMessage's own
      // primary index shape (lib/db/solEntities.ts).
      primary: {
        pk: { field: "pk", composite: ["conversationId"], template: "CONVO#${conversationId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "TURN#${createdAt}#${id}" },
      },
      // "this user's SOL history" — a support/debugging lookup with no other access path
      // (the primary index above is conversation-scoped, not user-scoped). Reuses GSI1,
      // already provisioned on this table and already shared by AdminAuditLog.byTarget/
      // FormSubmission.byOrg/EmailLog.byOrg — see EmailLog's comment on why that's safe.
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// SolUsageEventContent: the ONLY place any SOL prompt/response text is stored for
// analytics purposes — split out from SolUsageEvent (which is permanent) so the actual
// conversation content this entity holds ages out automatically after a short window.
// Text is truncated and passed through lib/privacy/redact.ts's best-effort scrub before
// being written here (see lib/solAnalytics.ts's recordSolUsageEvent) — this is not a
// substitute for SolMessage/SolConversation (lib/db/solEntities.ts), the real, unredacted
// transcript; it exists purely so a SUPERADMIN/SUPPORT admin can sanity-check a flagged
// conversation without querying plexo-sol's own table.
export const SolUsageEventContent = new Entity(
  {
    model: { entity: "solUsageEventContent", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true }, // same id as the matching SolUsageEvent row
      conversationId: { type: "string", required: true },
      createdAt: { type: "string", required: true },
      promptPreview: { type: "string" }, // redacted, truncated to 8000 chars
      responsePreview: { type: "string" }, // redacted, truncated to 8000 chars
      // 30 days — short-lived by design, unlike SolUsageEvent's permanent metadata row.
      ttl: { type: "number", default: () => days(30) },
    },
    indexes: {
      // Same pk, and the same {createdAt, id} composite, as SolUsageEvent's own primary
      // key — so a given turn's content row is a direct .get() away from its metadata row
      // with no extra lookup. The sk's literal prefix ("TURNCONTENT" vs SolUsageEvent's
      // "TURN") deliberately differs, though: both entities live in the same physical
      // table under this same service, and an identical template would make them compute
      // to the literal same DynamoDB item — their two .create() calls (run concurrently
      // via Promise.all in lib/solAnalytics.ts) would then race for one physical row,
      // guaranteeing a ConditionalCheckFailedException on whichever loses. Caught in local
      // testing: this was firing on every single completed turn.
      primary: {
        pk: { field: "pk", composite: ["conversationId"], template: "CONVO#${conversationId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "TURNCONTENT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// SolDailyStat: SOL's usage rollup, following PageViewDailyStat's exact sparse-dimension,
// atomic-`.add()` pattern above (see that entity's comment for the full "why sparse rows
// per dimension, not nested map counters" reasoning — it applies identically here).
// Written by lib/solAnalytics.ts's recordSolUsageEvent/recordSolFeedback; read by
// plexo-admin's lib/solAnalytics.ts for its /sol dashboard.
export const SolDailyStat = new Entity(
  {
    model: { entity: "solDailyStat", version: "1", service: "plexoOps" },
    attributes: {
      date: { type: "string", required: true }, // "YYYY-MM-DD", UTC
      // "TOTAL" | "MODEL#<provider>/<tier>" | "TOOL#<name>" | "TOOL#<name>#DECLINED" |
      // "USER#<userId>" (sparse DAU rows) | "ERROR#<errorCode>" | "FEEDBACK#UP" |
      // "FEEDBACK#DOWN" — see lib/solAnalytics.ts, the only writer. Plain string, same
      // "open-ended dimension values" reasoning as PageViewDailyStat.dimension.
      dimension: { type: "string", required: true },
      count: { type: "number", default: 0 },
      inputTokens: { type: "number", default: 0 },
      outputTokens: { type: "number", default: 0 },
      creditsCharged: { type: "number", default: 0 },
      latencyMsSum: { type: "number", default: 0 }, // divide by count for an average
      // 180 days — longer runway than SolUsageEvent's own retention needs, since a
      // rollup row stays tiny regardless of how much raw volume feeds it.
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      // One partition per day, same write-load-spreading reasoning as PageViewDailyStat.
      primary: {
        pk: { field: "pk", composite: ["date"], template: "SOLDAY#${date}" },
        sk: { field: "sk", composite: ["dimension"], template: "DIM#${dimension}" },
      },
    },
  },
  { table, client: docClient },
);

// ExperienceDailyStat: how the simple vs full editor view is used. Same sparse-dimension, atomic-`.add()` pattern as
// PageViewDailyStat/SolDailyStat above. Written by lib/experienceStats.ts (the only writer); read by plexo-admin's
// /experience page. Counts only — no page content, no personal data beyond the account id on the ACTIVE rows.
export const ExperienceDailyStat = new Entity(
  {
    model: { entity: "experienceDailyStat", version: "1", service: "plexoOps" },
    attributes: {
      date: { type: "string", required: true }, // "YYYY-MM-DD", UTC
      // "OPEN#simple|full" (editor opened) | "PUBLISH#simple|full" | "SWITCH#simple>full" | "SWITCH#full>simple" |
      // "ACTIVE#simple|full#<userId>" (sparse: one row per person per day, for distinct counts).
      dimension: { type: "string", required: true },
      count: { type: "number", default: 0 },
      ttl: { type: "number", default: () => days(400) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["date"], template: "XPDAY#${date}" },
        sk: { field: "sk", composite: ["dimension"], template: "DIM#${dimension}" },
      },
    },
  },
  { table, client: docClient },
);

// A site's Google Analytics connection (lib/googleAnalytics). One row per site. The refresh
// token is encrypted (lib/crypto.ts encryptGoogleAnalyticsToken) and never leaves the server.
export const SiteGoogleAnalytics = new Entity(
  {
    model: { entity: "siteGoogleAnalytics", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      connectedByUserId: { type: "string", required: true },
      googleEmail: { type: "string" },
      // Empty for a Plexo-managed property: Plexo's own service account reads it, so there is no owner token to keep.
      refreshTokenEncrypted: { type: "string" },
      // "managed": Plexo made and owns the property inside its own Google account (the owner never touches Google).
      // "own": the owner signed in with their own Google account.
      mode: { type: ["managed", "own"] as const, default: "own" },
      // Managed only: which of Plexo's Google accounts holds the property (lib/googleAnalytics/managed.ts), so reads and
      // clean-up go to the right place.
      poolAccountName: { type: "string" },
      // Managed only: the Google email the owner asked us to hand the property to (access binding), if any.
      handedOverTo: { type: "string" },
      handedOverAt: { type: "string" },
      // Managed only: when the owner's paid plan was first seen to have ended. After the retention period the property is
      // deleted from Plexo's Google account; paying again before then restores everything.
      lapsedAt: { type: "string" },
      // "connected": reports work. "needs_reconnect": Google said the permission was taken back.
      status: { type: ["connected", "needs_reconnect"] as const, default: "connected" },
      // Set after sign-in, when the owner picks (or we create) a property. Until measurementId
      // is set the owner is still on the "pick your property" step and no tag is added.
      accountName: { type: "string" },
      propertyName: { type: "string" },
      propertyDisplayName: { type: "string" },
      streamName: { type: "string" },
      measurementId: { type: "string" },
      connectedAt: { type: "string", default: () => new Date().toISOString() },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "SITE#${templateId}" },
        sk: { field: "sk", composite: [], template: "GOOGLEANALYTICS" },
      },
    },
  },
  { table, client: docClient },
);

// What visitors in regions that need consent see before Google's tag loads (lib/consent). One row per site; no row means the defaults.
export const SiteConsentSettings = new Entity(
  {
    model: { entity: "siteConsentSettings", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // On by default: visitors in Europe, the UK, Switzerland and Brazil see the notice. Off is the owner's own call.
      enabled: { type: "boolean", default: true },
      message: { type: "string" },
      acceptLabel: { type: "string" },
      declineLabel: { type: "string" },
      // "bar" across the bottom, or a "card" in the corner.
      position: { type: ["bar", "card"] as const, default: "bar" },
      // A #rrggbb colour. Missing means the site's brand colour (Strata) or a calm dark default.
      accentColor: { type: "string" },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "SITE#${templateId}" },
        sk: { field: "sk", composite: [], template: "CONSENTSETTINGS" },
      },
    },
  },
  { table, client: docClient },
);

// Per-site "Site health" options the owner turned on with "Fix it for me" (lib/siteHealth/fixes.ts).
// Every one is applied when a page is served and undone by turning it off: nothing in the owner's pages is rewritten.
export const SiteHealthSettings = new Entity(
  {
    model: { entity: "siteHealthSettings", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // Shown to search engines and AI tools when a page has no description of its own.
      fallbackDescription: { type: "string" },
      // A short plain-text file that tells AI tools what the site is about (/llms.txt).
      llmsTxt: { type: "boolean", default: false },
      // Business details for search engines (Organization markup).
      organizationSchema: { type: "boolean", default: false },
      // Videos and maps further down the page wait to load until scrolled to.
      lazyEmbeds: { type: "boolean", default: false },
      // Pictures with no description get one made from their file name.
      altFromFilename: { type: "boolean", default: false },
      // The page's language (<html lang>) when it does not say.
      language: { type: "string" },
      // The extra fixes, as { fixId: true } (lib/siteHealth/types.ts EXTRA_FIX_IDS). Absent or false = off.
      extras: { type: "any" },
      // Business details the owner confirmed for search engines (lib/siteHealth/business.ts): name, phone, address, hours...
      business: { type: "any" },
      // Page titles and picture descriptions written once when the fix was switched on (editable by the owner), served as stored.
      // aiTitles: { "/about": "About us | Mama Tee Bakery" }, aiAlts: { "https://.../cake.jpg": "A chocolate cake on a stand" }
      aiTitles: { type: "any" },
      aiAlts: { type: "any" },
      // The weekly "Your site health" email: on unless the owner switched it off (digestOff), and the numbers in the last one sent,
      // so the next can say what changed (lib/siteHealth/digest.ts).
      digestOff: { type: "boolean", default: false },
      digestSentAt: { type: "string" },
      digestScores: { type: "any" },
      // Moves when a FIX changes (it means "run a fresh check"). The email's own bookkeeping must not move it, so the fix fields are listed.
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: ["fallbackDescription", "llmsTxt", "organizationSchema", "lazyEmbeds", "altFromFilename", "language", "extras", "business", "aiTitles", "aiAlts"], set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "SITE#${templateId}" },
        sk: { field: "sk", composite: [], template: "HEALTHSETTINGS" },
      },
    },
  },
  { table, client: docClient },
);

// How big a picture is (pixels), so pages can reserve its space before it loads (lib/siteHealth/imageSize.ts).
// Written when a picture is uploaded to Plexo, or looked up once for pictures linked from elsewhere. One row per
// picture address, shared by every site that uses it. `failed` rows remember "could not be read" so we do not retry
// the same dead link on every check.
export const ImageDimension = new Entity(
  {
    model: { entity: "imageDimension", version: "1", service: "plexoOps" },
    attributes: {
      key: { type: "string", required: true },
      url: { type: "string", required: true },
      width: { type: "number" },
      height: { type: "number" },
      source: { type: ["upload", "probe"] as const },
      failed: { type: "boolean", default: false },
      checkedAt: { type: "string", default: () => new Date().toISOString(), set: () => new Date().toISOString() },
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["key"], template: "IMGDIM#${key}" },
        sk: { field: "sk", composite: [], template: "DIM" },
      },
    },
  },
  { table, client: docClient },
);

// Sites waiting for an automatic health re-check (lib/siteHealth/recheck.ts). One row per site, so a burst of edits is one
// row whose due time keeps moving later (that is the debounce). The row is removed once the check ran.
export const SiteHealthRecheck = new Entity(
  {
    model: { entity: "siteHealthRecheck", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      reason: { type: ["changed", "weekly"] as const, required: true },
      dueAt: { type: "string", required: true },
      queuedAt: { type: "string", default: () => new Date().toISOString() },
      attempts: { type: "number", default: 0 },
      ttl: { type: "number", default: () => days(30) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: [], template: "HEALTHRECHECK" },
        sk: { field: "sk", composite: ["templateId"], template: "SITE#${templateId}" },
      },
    },
  },
  { table, client: docClient },
);

// One row per speed check. The newest is the "last result" shown on the page; the rest draw the trend.
export const SiteHealthCheck = new Entity(
  {
    model: { entity: "siteHealthCheck", version: "1", service: "plexoOps" },
    attributes: {
      templateId: { type: "string", required: true },
      createdAt: { type: "string", required: true },
      url: { type: "string", required: true },
      // The whole normalized report (lib/siteHealth/types.ts), small enough for one item.
      report: { type: "any", required: true },
      speedScore: { type: "number" },
      aeoScore: { type: "number" },
      // A year of trend is plenty.
      ttl: { type: "number", default: () => days(400) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "SITE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt"], template: "HEALTHCHECK#${createdAt}" },
      },
    },
  },
  { table, client: docClient },
);

// SolFeedback: one row per rated SOL answer (thumbs up or down, from the dashboard or a
// WhatsApp reaction), holding the full question and answer so plexo-admin can show what
// was asked, what SOL said, and (for a thumbs down) what the owner expected instead. Kept
// 180 days. Text is passed through lib/privacy/redact.ts before it is written. The real
// transcript stays in SolMessage (plexoSol table).
export const SolFeedback = new Entity(
  {
    model: { entity: "solFeedback", version: "1", service: "plexoOps" },
    attributes: {
      id: { type: "string", required: true }, // the rated assistant message's id
      conversationId: { type: "string", required: true },
      userId: { type: "string", required: true },
      rating: { type: ["UP", "DOWN"] as const, required: true },
      // "What did you expect instead?" for a thumbs down; optional for a thumbs up.
      comment: { type: "string" },
      question: { type: "string" },
      answer: { type: "string" },
      // Names of the tools SOL used for that answer (e.g. get_analytics), for spotting wrong choices.
      tools: { type: "string" },
      source: { type: ["dashboard", "whatsapp"] as const, default: "dashboard" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: () => days(180) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["conversationId"], template: "SOLFEEDBACK#${conversationId}" },
        sk: { field: "sk", composite: ["id"], template: "MSG#${id}" },
      },
      // Newest first, per rating: one partition each, which is fine at feedback volumes.
      byRating: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["rating"], template: "SOLFEEDBACKRATING#${rating}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoOpsService = new Service(
  {
    PageView,
    PageViewDailyStat,
    RateLimit,
    StockCache,
    AdminAuditLog,
    FormSubmission,
    NotFoundHit,
    FormSettings,
    EmailLog,
    SolUsageEvent,
    SolUsageEventContent,
    SolFeedback,
    SolDailyStat,
    ExperienceDailyStat,
    SiteGoogleAnalytics,
    SiteConsentSettings,
    SiteHealthSettings,
    SiteHealthCheck,
    ImageDimension,
    SiteHealthRecheck,
  },
  { table, client: docClient },
);
