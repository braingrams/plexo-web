import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError, readBody } from "@/lib/projects/appAccess";
import { ownerContext } from "@/lib/projects/appEnvContext";
import { updateUser, deleteUser, deleteUserSessions, toPublicUser, findUserById } from "@/lib/appAuth/store";

type Ctx = { params: Promise<{ id: string; userId: string }> };

/** PATCH { role?, disabled? } — change a visitor's role or block them (signs them out
 *  everywhere). DELETE — remove the account (rows referencing it with ON DELETE CASCADE go
 *  too). ?env=dev|live. */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, userId } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const body = await readBody(request);
    const changes: Parameters<typeof updateUser>[2] = {};
    if (body.role !== undefined) {
      if (typeof body.role !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(body.role)) return NextResponse.json({ error: 'Roles are short lowercase words, like "admin" or "member".' }, { status: 400 });
      changes.role = body.role;
    }
    if (typeof body.disabled === "boolean") changes.disabled = body.disabled;
    const user = await updateUser(ctx, userId, changes);
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (changes.disabled || changes.role !== undefined) await deleteUserSessions(ctx, userId);
    return NextResponse.json({ user: { ...toPublicUser(user), disabled: !!user.disabled_at } });
  } catch (err) {
    return appError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, userId } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    if (!(await findUserById(ctx, userId))) return NextResponse.json({ error: "User not found." }, { status: 404 });
    await deleteUser(ctx, userId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return appError(err);
  }
}
