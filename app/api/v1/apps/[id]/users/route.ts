import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { ownerContext } from "@/lib/projects/appEnvContext";
import { listUsers, toPublicUser, findUserByEmail, createUser, issueToken, updateUser } from "@/lib/appAuth/store";
import { appSummary } from "@/lib/projects/summary";
import { normalizeEmail } from "@/lib/appAuth/passwords";
import { sendInviteEmail } from "@/lib/appAuth/emails";

type Ctx = { params: Promise<{ id: string }> };

/** The app's own visitor accounts (not Plexo accounts). ?env=dev|live.
 *  GET  ?search&limit&offset → { users, total }
 *  POST { email, role? } → invites someone: creates the account and emails a sign-in link. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const q = request.nextUrl.searchParams;
    const { users, total } = await listUsers(ctx, { search: q.get("search") ?? undefined, limit: Number(q.get("limit")) || 50, offset: Number(q.get("offset")) || 0 });
    return NextResponse.json({
      users: users.map((u) => ({ ...toPublicUser(u), disabled: !!u.disabled_at, lastSignInAt: u.last_sign_in_at, hasPassword: !!u.password_hash })),
      total,
    });
  } catch (err) {
    return appError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const existing = await findUserByEmail(ctx, email);
    const user = existing ?? (await createUser(ctx, { email, metadata: {} }));
    if (!user) return NextResponse.json({ error: "Couldn't create that account." }, { status: 500 });
    if (typeof body.role === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(body.role)) await updateUser(ctx, user.id, { role: body.role });
    // Invitations land on the app's own address (its preview, or a published domain).
    const info = await appSummary(loaded.app);
    const origin = ctx.env === "dev" ? info.previewUrl : info.liveUrl;
    if (!origin) return NextResponse.json({ error: ctx.env === "live" ? "Publish the app before inviting people to the live version." : "Build the app before inviting people." }, { status: 409 });
    const token = await issueToken(ctx, "invite", { userId: user.id, email, data: { redirectTo: `${origin}/` } });
    await sendInviteEmail(ctx, email, `${origin}/__plexo/api/auth/verify?type=invite&token=${token}`);
    return NextResponse.json({ user: toPublicUser(user), invited: true }, { status: existing ? 200 : 201 });
  } catch (err) {
    return appError(err);
  }
}
