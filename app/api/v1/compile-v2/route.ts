import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { userContentOrigin } from "@/lib/storage";
import { compilePageToHtml, parsePages, repairDesignSystem, sanitizeCss, sanitizeV2Html, type CompileOptions } from "@charisol/plexo-sdk/v2/compile";

import { auth } from "@/server/authDynamo";
import { ApiKey } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";

// Compiles V2 editor pages (the JSON `V2Editor` produces) to clean HTML. This is the V2 counterpart of
// /api/v1/compile, which keeps serving the classic builder unchanged.
//
//   POST /api/v1/compile-v2        x-api-key: <key>   (or Authorization: Bearer <key>)
//   { "page": {…} }  or  { "pages": [{…}, …] }
//   optional: "designSystem": {…}, "options": { title, lang, runtime, allowEmbedScripts, formActionUrl }
//   → { html, css, script, document, warnings }            (one page)
//   → { pages: [{ id, name, slug, html, css, script, document, warnings }], html, … }  (several; the top-level
//     fields are the first page's, so single-page callers never need to unwrap)

export const MAX_BODY_BYTES = 2_000_000;
export const MAX_PAGES = 50;
const RATE_LIMIT_PER_MINUTE = 120;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bearer(authorization: string | null): string | null {
  const [scheme, token] = (authorization ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" && token?.trim() ? token.trim() : null;
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

type ClientOptions = { title?: unknown; lang?: unknown; runtime?: unknown; allowEmbedScripts?: unknown; formActionUrl?: unknown };

function buildOptions(raw: unknown, designSystem: CompileOptions["designSystem"]): { ok: true; opts: CompileOptions } | { ok: false; error: string } {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as ClientOptions;
  const opts: CompileOptions = { designSystem };
  if (o.title !== undefined) {
    if (typeof o.title !== "string" || o.title.length > 200) return { ok: false, error: "options.title must be text of 200 characters or fewer." };
    opts.title = o.title;
  }
  if (o.lang !== undefined) {
    if (typeof o.lang !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(o.lang)) return { ok: false, error: 'options.lang must be a language code such as "en" or "en-GB".' };
    opts.lang = o.lang;
  }
  if (o.runtime !== undefined) {
    if (o.runtime !== "inline" && o.runtime !== "none") return { ok: false, error: 'options.runtime must be "inline" (default) or "none" (no script on the page).' };
    opts.runtime = o.runtime;
  }
  if (o.allowEmbedScripts !== undefined) {
    if (typeof o.allowEmbedScripts !== "boolean") return { ok: false, error: "options.allowEmbedScripts must be true or false." };
    opts.allowEmbedScripts = o.allowEmbedScripts;
  }
  if (o.formActionUrl !== undefined) {
    // Where the page's forms post to. "{formId}" is replaced by each form's id; without it the id is appended.
    if (typeof o.formActionUrl !== "string" || o.formActionUrl.length > 500 || !/^https:\/\//i.test(o.formActionUrl)) {
      return { ok: false, error: "options.formActionUrl must be a secure address starting with https:// (use {formId} where the form's id goes)." };
    }
    const base = o.formActionUrl;
    opts.formAction = (formId) => (base.includes("{formId}") ? base.replace("{formId}", encodeURIComponent(formId)) : `${base}${encodeURIComponent(formId)}`);
  }
  return { ok: true, opts };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Who is calling? Same two paths as /api/v1/compile ──────────────────────
  const xApiKey = request.headers.get("x-api-key")?.trim();
  let apiKey: { organizationId: string; id: string } | null = null;
  let rateKey: string;

  if (xApiKey === "workspace-internal") {
    const session = await auth();
    if (!session?.user) return fail("Please sign in to use this.", 401);
    rateKey = `compile-v2:user:${(session.user as { id?: string }).id ?? session.user.email ?? "unknown"}`;
  } else {
    const rawKey = xApiKey || bearer(request.headers.get("authorization"));
    if (!rawKey) return fail("An API key is required. Send it in the x-api-key header (create one under Settings → API keys).", 401);
    const hashedKey = sha256(rawKey);
    const { data: matches } = await ApiKey.query.byHashedKey({ hashedKey }).go();
    const found = matches.find((k) => k.isActive);
    if (!found) return fail("That API key isn't valid or has been turned off. Check it under Settings → API keys.", 403);
    apiKey = found;
    rateKey = `compile-v2:key:${hashedKey.slice(0, 32)}`;
  }

  try {
    if (!(await checkCommerceRateLimit(rateKey, RATE_LIMIT_PER_MINUTE, 60_000))) {
      return fail("You're sending requests too quickly. Wait a minute and try again.", 429);
    }
  } catch {
    // A rate-limit store hiccup must not take compiling down.
  }

  // ── Read the body with a hard size cap ─────────────────────────────────────
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(`That design is too large to compile in one request (the limit is ${MAX_BODY_BYTES / 1_000_000} MB). Send fewer pages at a time.`, 413);
  const text = await request.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return fail(`That design is too large to compile in one request (the limit is ${MAX_BODY_BYTES / 1_000_000} MB). Send fewer pages at a time.`, 413);

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    body = null;
  }
  if (!body) return fail('Send a JSON body like { "page": … } or { "pages": [ … ] }.', 400);

  const input = body.pages ?? body.page;
  if (input === undefined) return fail('Send the design to compile as "page" (one page) or "pages" (a list), exactly as the V2 editor produces it.', 400);
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) return fail("There are no pages to compile.", 400);
  if (list.length > MAX_PAGES) return fail(`Too many pages in one request (the limit is ${MAX_PAGES}).`, 400);

  const parsed = parsePages(list);
  if (!parsed.ok) return fail(`That design couldn't be read: ${parsed.error}`, 400);

  let designSystem: CompileOptions["designSystem"];
  if (body.designSystem !== undefined) {
    if (!body.designSystem || typeof body.designSystem !== "object" || Array.isArray(body.designSystem)) {
      return fail("designSystem must be the design-system object from the editor (getDesignSystem()).", 400);
    }
    const ds = body.designSystem as { tokens?: unknown; components?: unknown };
    if (!Array.isArray(ds.tokens) || !Array.isArray(ds.components)) {
      return fail("designSystem must include its tokens and components, as the editor's getDesignSystem() returns them.", 400);
    }
    try {
      designSystem = repairDesignSystem(body.designSystem as Parameters<typeof repairDesignSystem>[0]);
    } catch {
      return fail("That designSystem couldn't be read. Pass the object the editor's getDesignSystem() returns.", 400);
    }
  }

  const built = buildOptions(body.options, designSystem);
  if (!built.ok) return fail(built.error, 400);

  const fontOrigin = userContentOrigin();
  const sanitizeOpts = { allowEmbedScripts: built.opts.allowEmbedScripts, ...(fontOrigin ? { fontOrigins: [fontOrigin] } : {}) };
  let compiled: Array<{ id: string; name: string; slug: string; html: string; css: string; script: string; document: string; warnings: string[] }>;
  try {
    compiled = parsed.pages.map((page) => {
      const c = compilePageToHtml(page, built.opts);
      return {
        id: page.id,
        name: page.name,
        slug: page.slug,
        html: sanitizeV2Html(c.html, sanitizeOpts),
        css: sanitizeCss(c.css),
        script: c.script,
        // The compiler's own runtime script is kept byte for byte; anything else in the document is removed.
        document: sanitizeV2Html(c.document, sanitizeOpts),
        warnings: c.warnings,
      };
    });
  } catch (err) {
    return fail(`Compiling failed: ${err instanceof Error ? err.message : "the design has a problem the compiler couldn't handle."}`, 400);
  }

  if (apiKey) {
    await ApiKey.patch({ organizationId: apiKey.organizationId, id: apiKey.id }).set({ lastUsedAt: new Date().toISOString() }).go().catch(() => undefined);
  }

  const first = compiled[0];
  if (!Array.isArray(input)) {
    const { id: _i, name: _n, slug: _s, ...single } = first;
    return NextResponse.json(single);
  }
  return NextResponse.json({ html: first.html, css: first.css, script: first.script, document: first.document, warnings: first.warnings, pages: compiled });
}
