import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { FormSubmission } from "@/lib/db/opsEntities";
import { BlogComment, BlogRedirect } from "@/lib/db/contentEntities";
import { CommerceDonationCampaign, CommerceOrder, CommerceOrderItem } from "@/lib/db/commerceEntities";
import { WpMigrationJob, WpMigrationPage } from "@/lib/db/importEntities";
import { normalizeRedirectPath } from "@/lib/blog/redirectsDynamo";
import { createBlogPost, findPostByExternalId } from "@/lib/blog/savePostDynamo";
import { convertWordPressHtmlToTiptapJson, tiptapJsonToHtml } from "@/lib/blogImport/htmlToTiptap";
import { migrationFetch, restUrl } from "./http";
import { hostVariants, makeOriginRewriter } from "./urlSpace";
import type { MigratedForm } from "./htmlTransform";
import type { WpInstall } from "./types";

// Plexo's side of the Plexo Migrator companion plugin (see companionPlugin.ts): pairing,
// the connection check, and a resumable import of what WordPress keeps private — past form
// entries, records custom plugins keep (applications, sign-ups), donation history, drafts,
// redirect rules, the team list and commenter emails. Historical records are written
// directly (no "new submission"/"you've been paid" emails for things that happened years
// ago), each with an id derived from its WordPress id so re-running never duplicates.

type JobItem = EntityItem<typeof WpMigrationJob>;

export interface ConnectorState {
  keyEncrypted: string;
  status: "WAITING" | "CONNECTED" | "ERROR";
  summary?: ConnectorSummary;
  error?: string;
  checkedAt?: string;
}

export interface ConnectorSummary {
  plugin_version: string;
  tables: { name: string; rows: number; columns: string[] }[];
  forminator_forms: { id: number; title: string; entries: number }[];
  payform: { paid: number } | null;
  drafts: number;
  redirects: number;
  team: number;
}

export interface ExtrasState {
  stage: "forminator" | "tables" | "payform" | "redirects" | "team" | "drafts" | "comments" | "done";
  /** Position inside the current stage: which item, how far into it. */
  index: number;
  offset: number;
  counts: { formEntries: number; records: number; donations: number; redirects: number; drafts: number; commentEmails: number };
  team: { name: string; email: string; roles: string[] }[];
  /** Plugin tables that hold something other than submissions — listed, not moved. */
  unmoved: { table: string; rows: number }[];
  error?: string;
  finishedAt?: string;
}

const STAGES: ExtrasState["stage"][] = ["forminator", "tables", "payform", "redirects", "team", "drafts", "comments", "done"];
const PAGE_SIZE = 200;
const STEP_BUDGET_MS = 35_000;

export function newConnectorCode(): string {
  return `plexo_${randomBytes(30).toString("base64url")}`;
}

export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Calls one of the plugin's read-only endpoints. Falls back to the query-string code for hosts that strip custom headers. */
export async function connectorGet<T>(install: WpInstall, code: string, route: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = restUrl(install.restRoot, `plexo-migrator/v1/${route}`, params);
  let res = await migrationFetch(url, { headers: { Accept: "application/json", "X-Plexo-Migrator-Key": code } });
  if (res.status === 403 || res.status === 401) {
    const retry = await migrationFetch(restUrl(install.restRoot, `plexo-migrator/v1/${route}`, { ...params, plexo_key: code }), { headers: { Accept: "application/json" } });
    if (retry.ok || (retry.status !== 401 && retry.status !== 403)) res = retry;
  }
  const body = (await res.json().catch(() => null)) as (T & { code?: string; message?: string }) | null;
  if (res.ok && body) return body;
  const code_ = body?.code ?? "";
  if (res.status === 404 && (code_ === "rest_no_route" || !body)) {
    throw new ConnectorError("We can't find the Plexo Migrator plugin on your site yet — install and activate it (Plugins → Add New → Upload Plugin), then check again.");
  }
  if (code_ === "plexo_not_connected") throw new ConnectorError("The plugin is active but not connected yet — in WordPress go to Tools → Plexo Migrator and paste your connection code.");
  if (code_ === "plexo_wrong_code") throw new ConnectorError("The code in WordPress doesn't match this migration — copy the code shown here again and paste it in Tools → Plexo Migrator.");
  throw new ConnectorError(`Your WordPress site answered with an error (${res.status}). Try again in a minute.`);
}

function codeFor(job: JobItem): string {
  const state = job.connector as ConnectorState | undefined;
  if (!state?.keyEncrypted) throw new ConnectorError("Create a connection code first.");
  return decryptSecret(state.keyEncrypted);
}

export async function createConnector(job: JobItem): Promise<string> {
  const code = newConnectorCode();
  const state: ConnectorState = { keyEncrypted: encryptSecret(code), status: "WAITING" };
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ connector: state }).go();
  return code;
}

/** Shows the code again (so the owner can re-copy it) — only ever to the site's own admins. */
export function revealConnectorCode(job: JobItem): string | null {
  const state = job.connector as ConnectorState | undefined;
  if (!state?.keyEncrypted) return null;
  try {
    return decryptSecret(state.keyEncrypted);
  } catch {
    return null;
  }
}

export async function checkConnector(job: JobItem): Promise<ConnectorState> {
  const state = job.connector as ConnectorState | undefined;
  if (!state) throw new ConnectorError("Create a connection code first.");
  let next: ConnectorState;
  try {
    const summary = await connectorGet<ConnectorSummary>(job.install as WpInstall, codeFor(job), "status");
    next = { ...state, status: "CONNECTED", summary, error: undefined, checkedAt: new Date().toISOString() };
  } catch (err) {
    next = { ...state, status: "ERROR", error: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString() };
  }
  await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ connector: next }).go();
  return next;
}

function emptyExtras(): ExtrasState {
  return { stage: "forminator", index: 0, offset: 0, counts: { formEntries: 0, records: 0, donations: 0, redirects: 0, drafts: 0, commentEmails: 0 }, team: [], unmoved: [] };
}

function humanize(s: string): string {
  return s.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function isoFromWp(date: unknown): string | undefined {
  if (typeof date !== "string" || !date.trim()) return undefined;
  const d = new Date(`${date.trim().replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function isDuplicate(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } };
  return e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException";
}

async function migratedForms(jobId: string): Promise<MigratedForm[]> {
  const { data } = await WpMigrationPage.query.primary({ jobId }).go({ pages: "all" });
  return data.flatMap((p) => ((p.forms as MigratedForm[] | undefined) ?? []));
}

/** A plugin table holds submissions when it has an email column — applications, sign-ups, enquiries. */
function isSubmissionTable(table: { columns: string[] }): boolean {
  return table.columns.some((c) => /e-?mail/i.test(c));
}

/** Name a table's records after the migrated form they came from when the names line up ("lcv_volunteers" ↔ "Volunteer form"). */
function formNameForTable(table: string, prefix: string, forms: MigratedForm[]): string {
  const bare = table.startsWith(prefix) ? table.slice(prefix.length) : table;
  for (const f of forms.filter((x) => x.plugin === "custom")) {
    const tokens = f.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 5);
    if (tokens.some((t) => bare.toLowerCase().includes(t.replace(/s$/, "")))) return f.name;
  }
  return humanize(bare);
}

/**
 * One bounded step of the private-data import. Returns the updated state; `stage: "done"`
 * when everything is in. Safe to call repeatedly (dashboard loop or MCP polling).
 */
export async function runExtrasStep(job: JobItem): Promise<ExtrasState> {
  const install = job.install as WpInstall;
  const code = codeFor(job);
  const connector = job.connector as ConnectorState;
  const summary = connector.summary;
  if (connector.status !== "CONNECTED" || !summary) throw new ConnectorError("Check the connection to the plugin first.");
  const state: ExtrasState = { ...emptyExtras(), ...((job.extras as ExtrasState | undefined) ?? {}) };
  if (state.stage === "done") return state;
  const isDone = () => state.stage === ("done" as ExtrasState["stage"]);
  const started = Date.now();
  const tablePrefix = (summary.tables[0]?.name.match(/^([a-z0-9]+_)/i)?.[1]) ?? "wp_";
  const forms = await migratedForms(job.id);
  const save = async () => {
    await WpMigrationJob.patch({ templateId: job.templateId, id: job.id }).set({ extras: state }).go();
  };
  const advance = () => {
    state.stage = STAGES[STAGES.indexOf(state.stage) + 1];
    state.index = 0;
    state.offset = 0;
  };

  try {
    while (!isDone() && Date.now() - started < STEP_BUDGET_MS) {
      if (state.stage === "forminator") {
        const form = summary.forminator_forms[state.index];
        if (!form) { advance(); continue; }
        const { entries } = await connectorGet<{ entries: { id: number; date: string; fields: Record<string, string> }[] }>(install, code, "forminator/entries", { form_id: form.id, offset: state.offset, limit: PAGE_SIZE });
        const formName = forms.find((f) => f.id === `forminator-module-${form.id}`)?.name ?? form.title;
        for (const e of entries) {
          if (Object.keys(e.fields).length === 0) continue;
          try {
            await FormSubmission.create({ id: `wp-forminator-${e.id}`, templateId: job.templateId, organizationId: job.organizationId, formName, fields: e.fields, ...(isoFromWp(e.date) ? { createdAt: isoFromWp(e.date) } : {}) }).go();
            state.counts.formEntries += 1;
          } catch (err) {
            if (!isDuplicate(err)) throw err;
          }
        }
        if (entries.length < PAGE_SIZE) { state.index += 1; state.offset = 0; } else state.offset += PAGE_SIZE;
        continue;
      }

      if (state.stage === "tables") {
        const table = summary.tables[state.index];
        if (!table) { advance(); continue; }
        if (!isSubmissionTable(table)) {
          if (table.rows > 0 && !state.unmoved.some((u) => u.table === table.name)) state.unmoved.push({ table: table.name, rows: table.rows });
          state.index += 1;
          continue;
        }
        const { rows } = await connectorGet<{ rows: Record<string, unknown>[] }>(install, code, "table", { name: table.name, offset: state.offset, limit: PAGE_SIZE });
        const formName = formNameForTable(table.name, tablePrefix, forms);
        const dateColumn = table.columns.find((c) => /(created|submitted|date|time)/i.test(c));
        for (const row of rows) {
          const fields: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            if (/^id$/i.test(k) || k === dateColumn || v === null || v === "") continue;
            let value = String(v);
            // Plugins often store multi-choice answers as JSON or PHP-serialized arrays.
            if (/^\[.*\]$/.test(value)) {
              try {
                value = (JSON.parse(value) as unknown[]).join(", ");
              } catch {
                // keep raw
              }
            } else if (/^a:\d+:\{/.test(value)) {
              value = Array.from(value.matchAll(/s:\d+:"([^"]*)"/g), (m) => m[1]).filter((x, i) => i % 2 === 1 || !/^\d+$/.test(x)).join(", ");
            }
            fields[humanize(k)] = value.slice(0, 5000);
          }
          if (Object.keys(fields).length === 0) continue;
          const rowId = row.id ?? row.ID ?? createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 16);
          try {
            await FormSubmission.create({ id: `wp-${table.name}-${rowId}`.slice(0, 120), templateId: job.templateId, organizationId: job.organizationId, formName, fields, ...(isoFromWp(dateColumn ? row[dateColumn] : null) ? { createdAt: isoFromWp(row[dateColumn!]) } : {}) }).go();
            state.counts.records += 1;
          } catch (err) {
            if (!isDuplicate(err)) throw err;
          }
        }
        if (rows.length < PAGE_SIZE) { state.index += 1; state.offset = 0; } else state.offset += PAGE_SIZE;
        continue;
      }

      if (state.stage === "payform") {
        if (!summary.payform?.paid) { advance(); continue; }
        const { submissions } = await connectorGet<{ submissions: { id: string; form_id: string; customer_name: string | null; customer_email: string | null; currency: string | null; payment_total: string; payment_method: string | null; created_at: string }[] }>(install, code, "payform/submissions", { offset: state.offset, limit: PAGE_SIZE });
        const { data: campaigns } = await CommerceDonationCampaign.query.primary({ templateId: job.templateId }).go({ pages: "all" });
        for (const sub of submissions) {
          const amount = Math.round(Number(sub.payment_total));
          if (!sub.customer_email || !Number.isFinite(amount) || amount <= 0) continue;
          const campaign = campaigns.find((c) => c.source === `wp-payment-form:${sub.form_id}`) ?? campaigns[0] ?? null;
          const orderId = `wp-wpf-${sub.id}`;
          try {
            await CommerceOrder.create({
              id: orderId,
              templateId: job.templateId,
              organizationId: job.organizationId,
              orderNumber: `WPF-${sub.id}`,
              customerEmail: sub.customer_email,
              customerName: sub.customer_name ?? undefined,
              amountMinor: amount,
              currency: (sub.currency ?? "USD").toUpperCase(),
              status: "PAID",
              fulfillmentStatus: "COMPLETED",
              paymentProvider: /stripe/i.test(sub.payment_method ?? "") ? "BYO_STRIPE" : "BYO_PAYSTACK",
              paymentMethod: "ONLINE",
              metadata: { kind: "DONATION", campaignId: campaign?.id ?? null, campaignName: campaign?.name ?? "Donation", frequency: "ONCE", imported: true },
              ...(isoFromWp(sub.created_at) ? { createdAt: isoFromWp(sub.created_at) } : {}),
            }).go();
          } catch (err) {
            if (isDuplicate(err)) continue;
            throw err;
          }
          await CommerceOrderItem.create({ id: randomUUID(), templateId: job.templateId, orderId, productId: `donation:${campaign?.id ?? "imported"}`, nameSnapshot: `Donation — ${campaign?.name ?? "WordPress"}`, unitPriceMinor: amount, quantity: 1 }).go();
          if (campaign) await CommerceDonationCampaign.patch({ templateId: job.templateId, id: campaign.id }).add({ raisedMinor: amount, donationCount: 1 }).go();
          state.counts.donations += 1;
        }
        if (submissions.length < PAGE_SIZE) advance(); else state.offset += PAGE_SIZE;
        continue;
      }

      if (state.stage === "redirects") {
        const { redirects } = await connectorGet<{ redirects: { from: string; to: string; code: number }[] }>(install, code, "redirects");
        const rewrite = makeOriginRewriter(install.origin);
        const hosts = hostVariants(install.origin);
        for (const r of redirects) {
          let from: string;
          try {
            const u = new URL(r.from, install.origin);
            if (!hosts.includes(u.host)) continue;
            from = normalizeRedirectPath(decodeURIComponent(u.pathname));
          } catch {
            continue;
          }
          const to = rewrite(r.to);
          if (!from || from === "/" || !to) continue;
          await BlogRedirect.put({ id: randomUUID(), templateId: job.templateId, fromPath: from, toPath: /^https?:\/\//i.test(to) ? to : normalizeRedirectPath(to) }).go();
          state.counts.redirects += 1;
        }
        advance();
        continue;
      }

      if (state.stage === "team") {
        const { team } = await connectorGet<{ team: { name: string; email: string; roles: string[] }[] }>(install, code, "team");
        state.team = team.slice(0, 500);
        advance();
        continue;
      }

      if (state.stage === "drafts") {
        const { drafts } = await connectorGet<{ drafts: { id: number; type: string; status: string; title: string; slug: string; content: string; excerpt: string; date_gmt: string }[] }>(install, code, "drafts", { offset: state.offset, limit: 50 });
        const rewrite = makeOriginRewriter(install.origin);
        for (const d of drafts) {
          if (d.type !== "post") continue; // unpublished pages stay on WordPress — listed in the report
          if (await findPostByExternalId(job.templateId, `wp:${d.id}`)) continue;
          const contentJson = convertWordPressHtmlToTiptapJson(rewrite(d.content ?? ""));
          await createBlogPost(job.templateId, {
            title: d.title || "Untitled draft",
            slug: d.slug || null,
            excerpt: d.excerpt || null,
            contentJson,
            contentHtml: tiptapJsonToHtml(contentJson),
            status: "DRAFT",
            externalId: `wp:${d.id}`,
          });
          state.counts.drafts += 1;
        }
        if (drafts.length < 50) advance(); else state.offset += 50;
        continue;
      }

      if (state.stage === "comments") {
        const { comments } = await connectorGet<{ comments: { id: number; post_id: number; email: string }[] }>(install, code, "comment-emails", { offset: state.offset, limit: PAGE_SIZE });
        const { data: pages } = await WpMigrationPage.query.primary({ jobId: job.id }).go({ pages: "all" });
        const postIdFor = new Map(pages.filter((p) => p.kind === "POST" && p.blogPostId && p.wpId).map((p) => [p.wpId!, p.blogPostId!]));
        const byPost = new Map<string, { id: number; email: string }[]>();
        for (const c of comments) {
          const plexoPostId = postIdFor.get(c.post_id);
          if (!plexoPostId) continue;
          byPost.set(plexoPostId, [...(byPost.get(plexoPostId) ?? []), c]);
        }
        for (const [postId, list] of byPost) {
          const { data: existing } = await BlogComment.query.primary({ postId }).go({ pages: "all" });
          for (const c of list) {
            const row = existing.find((e) => e.id === `wp-${c.id}`);
            if (!row || row.authorEmail === c.email) continue;
            await BlogComment.patch({ postId, status: row.status ?? "APPROVED", createdAt: row.createdAt, id: row.id }).set({ authorEmail: c.email }).go();
            state.counts.commentEmails += 1;
          }
        }
        if (comments.length < PAGE_SIZE) advance(); else state.offset += PAGE_SIZE;
        continue;
      }
    }
    if (isDone() && !state.finishedAt) state.finishedAt = new Date().toISOString();
    state.error = undefined;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  await save();
  return state;
}
