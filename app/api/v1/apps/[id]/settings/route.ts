import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { AppSettings } from "@/lib/db/appEntities";
import { getAppSettings, forgetAppContext } from "@/lib/appRuntime/context";
import { encryptAppSecret } from "@/lib/crypto";
import { normalizeSeo, SeoInputError, type AppSeo } from "@/lib/projects/appSeo";

type Ctx = { params: Promise<{ id: string }> };

/** The app's sign-in settings, storage buckets and search & sharing details. Secrets (Google client secret) are
 *  write-only: they're accepted here and never returned. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const s = await getAppSettings(id, loaded.app.organizationId);
  return NextResponse.json({
    auth: {
      password: s.authPassword ?? true,
      magicLink: s.authMagicLink ?? true,
      google: s.authGoogle ?? true,
      googleClientId: s.googleClientId ?? null,
      hasGoogleClientSecret: !!s.googleClientSecretCiphertext,
      usesPlexoGoogleClient: !s.googleClientId,
      requireEmailConfirmation: s.requireEmailConfirmation ?? false,
      allowSignups: s.allowSignups ?? true,
      emailFromName: s.emailFromName ?? null,
      extraRedirectOrigins: s.extraRedirectOrigins ?? [],
    },
    buckets: s.buckets ?? {},
    requestsPerMinute: s.requestsPerMinute ?? 600,
    seo: (s.seo as AppSeo | undefined) ?? {},
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const body = await readBody(request);
    const auth = (body.auth ?? {}) as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    const bool = (k: string, field: string) => {
      if (typeof auth[k] === "boolean") set[field] = auth[k];
    };
    bool("password", "authPassword");
    bool("magicLink", "authMagicLink");
    bool("google", "authGoogle");
    bool("requireEmailConfirmation", "requireEmailConfirmation");
    bool("allowSignups", "allowSignups");
    if (typeof auth.emailFromName === "string") set.emailFromName = auth.emailFromName.trim().slice(0, 80) || undefined;
    if (auth.googleClientId === null) {
      set.googleClientId = undefined;
      set.googleClientSecretCiphertext = undefined;
    } else if (typeof auth.googleClientId === "string") {
      if (!/\.apps\.googleusercontent\.com$/.test(auth.googleClientId.trim())) return NextResponse.json({ error: "That doesn't look like a Google OAuth client ID (it ends in .apps.googleusercontent.com)." }, { status: 400 });
      if (typeof auth.googleClientSecret !== "string" || !auth.googleClientSecret.trim()) return NextResponse.json({ error: "Add the client secret too." }, { status: 400 });
      set.googleClientId = auth.googleClientId.trim();
      set.googleClientSecretCiphertext = encryptAppSecret(auth.googleClientSecret.trim());
    }
    if (Array.isArray(auth.extraRedirectOrigins)) {
      const origins = auth.extraRedirectOrigins.filter((o): o is string => typeof o === "string").map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return null;
        }
      });
      if (origins.some((o) => !o || !o.startsWith("https://"))) return NextResponse.json({ error: "Redirect origins must be https:// addresses." }, { status: 400 });
      set.extraRedirectOrigins = origins.slice(0, 10);
    }
    if (body.buckets && typeof body.buckets === "object") {
      const buckets: Record<string, { access: "public" | "private"; maxBytes?: number }> = {};
      for (const [name, cfg] of Object.entries(body.buckets as Record<string, any>)) {
        if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) return NextResponse.json({ error: `"${name}" isn't a valid bucket name.` }, { status: 400 });
        if (cfg?.access !== "public" && cfg?.access !== "private") return NextResponse.json({ error: `Bucket "${name}" must be public or private.` }, { status: 400 });
        buckets[name] = { access: cfg.access, ...(Number(cfg.maxBytes) > 0 ? { maxBytes: Math.min(Number(cfg.maxBytes), 200 * 1024 * 1024) } : {}) };
      }
      set.buckets = buckets;
    }
    if (body.seo && typeof body.seo === "object") {
      const seo = normalizeSeo(body.seo as Record<string, unknown>);
      set.seo = Object.keys(seo).length ? seo : undefined;
    }
    const { data: existing } = await AppSettings.get({ templateId: id }).go();
    if (!existing) await AppSettings.create({ templateId: id, organizationId: loaded.app.organizationId }).go();
    // undefined values remove an attribute.
    const removals = Object.entries(set).filter(([, v]) => v === undefined).map(([k]) => k);
    const updates = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
    let op = AppSettings.patch({ templateId: id }).set(updates as any);
    if (removals.length) op = op.remove(removals as any);
    await op.go();
    forgetAppContext(id);
    return GET(request, { params });
  } catch (err) {
    if (err instanceof SeoInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    return appError(err);
  }
}
