import { runDb, queryDb } from "@/lib/appData/db";
import { ensureAppDatabase } from "@/lib/appData/provision";
import type { AppContext } from "@/lib/appRuntime/context";
import { hashSecret, newSecret } from "./passwords";

// Visitor accounts, sessions and one-time tokens, stored in the app's own database
// (plexo schema) and touched only through its "system" login — app code can read accounts
// but never change them.

export type AppUserRow = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  password_hash: string | null;
  role: string;
  metadata: Record<string, unknown>;
  disabled_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

export type PublicUser = { id: string; email: string; role: string; email_verified: boolean; metadata: Record<string, unknown>; created_at: string };

export const toPublicUser = (u: AppUserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  email_verified: !!u.email_confirmed_at,
  metadata: u.metadata ?? {},
  created_at: u.created_at,
});

const userColumns = (a?: string) => {
  const p = a ? `${a}.` : "";
  return `${p}id, ${p}email::text AS email, ${p}email_confirmed_at, ${p}password_hash, ${p}role, ${p}metadata, ${p}disabled_at, ${p}last_sign_in_at, ${p}created_at`;
};
const USER_COLUMNS = userColumns();

const ready = new Set<string>();
async function sys<T = AppUserRow>(ctx: AppContext, sql: string, params: unknown[] = []): Promise<T[]> {
  if (!ready.has(ctx.database)) {
    await ensureAppDatabase(ctx.templateId, ctx.organizationId, ctx.env);
    ready.add(ctx.database);
  }
  return queryDb<T>({ database: ctx.database, login: "system" }, sql, params);
}

export async function findUserByEmail(ctx: AppContext, email: string): Promise<AppUserRow | null> {
  const [u] = await sys(ctx, `SELECT ${USER_COLUMNS} FROM plexo.users WHERE email = $1`, [email]);
  return u ?? null;
}

export async function findUserById(ctx: AppContext, id: string): Promise<AppUserRow | null> {
  const [u] = await sys(ctx, `SELECT ${USER_COLUMNS} FROM plexo.users WHERE id = $1`, [id]);
  return u ?? null;
}

/** Creates the account, or returns null if the email is already taken. */
export async function createUser(ctx: AppContext, input: { email: string; passwordHash?: string | null; metadata?: Record<string, unknown>; confirmed?: boolean }): Promise<AppUserRow | null> {
  const [u] = await sys(
    ctx,
    `INSERT INTO plexo.users (email, password_hash, metadata, email_confirmed_at)
     VALUES ($1, $2, $3::jsonb, CASE WHEN $4 THEN now() ELSE NULL END)
     ON CONFLICT (email) DO NOTHING RETURNING ${USER_COLUMNS}`,
    [input.email, input.passwordHash ?? null, JSON.stringify(input.metadata ?? {}), !!input.confirmed],
  );
  return u ?? null;
}

export async function updateUser(
  ctx: AppContext,
  id: string,
  changes: { passwordHash?: string; metadata?: Record<string, unknown>; confirmEmail?: boolean; role?: string; disabled?: boolean; signedIn?: boolean },
): Promise<AppUserRow | null> {
  const sets: string[] = ["updated_at = now()"];
  const params: unknown[] = [id];
  if (changes.passwordHash !== undefined) sets.push(`password_hash = $${params.push(changes.passwordHash)}`);
  if (changes.metadata !== undefined) sets.push(`metadata = metadata || $${params.push(JSON.stringify(changes.metadata))}::jsonb`);
  if (changes.confirmEmail) sets.push("email_confirmed_at = coalesce(email_confirmed_at, now())");
  if (changes.role !== undefined) sets.push(`role = $${params.push(changes.role)}`);
  if (changes.disabled !== undefined) sets.push(changes.disabled ? "disabled_at = now()" : "disabled_at = NULL");
  if (changes.signedIn) sets.push("last_sign_in_at = now()");
  const [u] = await sys(ctx, `UPDATE plexo.users SET ${sets.join(", ")} WHERE id = $1 RETURNING ${USER_COLUMNS}`, params);
  return u ?? null;
}

export async function deleteUser(ctx: AppContext, id: string): Promise<void> {
  await sys(ctx, "DELETE FROM plexo.users WHERE id = $1", [id]);
}

export async function listUsers(ctx: AppContext, opts: { search?: string; limit?: number; offset?: number }): Promise<{ users: AppUserRow[]; total: number }> {
  const search = opts.search?.trim() ? `%${opts.search.trim()}%` : null;
  const rows = await sys<AppUserRow & { total: number }>(
    ctx,
    `SELECT ${USER_COLUMNS}, count(*) OVER () AS total FROM plexo.users
     WHERE $1::text IS NULL OR email ILIKE $1 OR metadata::text ILIKE $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [search, Math.min(opts.limit ?? 50, 200), opts.offset ?? 0],
  );
  return { users: rows, total: rows[0]?.total ?? 0 };
}

// ------------------------------------------------------------- identities (OAuth)

export async function findUserByIdentity(ctx: AppContext, provider: string, providerUserId: string): Promise<AppUserRow | null> {
  const [u] = await sys(
    ctx,
    `SELECT ${userColumns("u")}
     FROM plexo.identities i JOIN plexo.users u ON u.id = i.user_id WHERE i.provider = $1 AND i.provider_user_id = $2`,
    [provider, providerUserId],
  );
  return u ?? null;
}

export async function linkIdentity(ctx: AppContext, userId: string, provider: string, providerUserId: string, email: string, data: Record<string, unknown>): Promise<void> {
  await sys(
    ctx,
    `INSERT INTO plexo.identities (user_id, provider, provider_user_id, email, data) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (provider, provider_user_id) DO UPDATE SET data = EXCLUDED.data, email = EXCLUDED.email`,
    [userId, provider, providerUserId, email, JSON.stringify(data)],
  );
}

// ------------------------------------------------------------- sessions

export const SESSION_TTL_DAYS = 30;

export async function createSession(ctx: AppContext, userId: string, meta: { userAgent?: string | null; ipHash?: string | null }): Promise<string> {
  const token = newSecret();
  await sys(
    ctx,
    `INSERT INTO plexo.sessions (user_id, token_hash, expires_at, user_agent, ip_hash) VALUES ($1, $2, now() + make_interval(days => ${SESSION_TTL_DAYS}), $3, $4)`,
    [userId, hashSecret(token), meta.userAgent?.slice(0, 300) ?? null, meta.ipHash ?? null],
  );
  await updateUser(ctx, userId, { signedIn: true });
  return token;
}

/** The signed-in user for a session token, extending the session when it's been a while
 * (sliding expiry), or null if the session is gone, expired, or the account disabled. */
export async function resolveSessionUser(ctx: AppContext, token: string): Promise<AppUserRow | null> {
  const [row] = await sys<AppUserRow & { session_id: string; refresh: boolean }>(
    ctx,
    `SELECT s.id AS session_id, s.last_seen_at < now() - interval '1 hour' AS refresh,
            ${userColumns("u")}
     FROM plexo.sessions s JOIN plexo.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
    [hashSecret(token)],
  );
  if (!row) return null;
  if (row.refresh) {
    await sys(ctx, `UPDATE plexo.sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_TTL_DAYS}) WHERE id = $1`, [row.session_id]);
  }
  return row;
}

export async function deleteSession(ctx: AppContext, token: string): Promise<void> {
  await sys(ctx, "DELETE FROM plexo.sessions WHERE token_hash = $1", [hashSecret(token)]);
}

export async function deleteUserSessions(ctx: AppContext, userId: string, exceptToken?: string): Promise<void> {
  await sys(ctx, "DELETE FROM plexo.sessions WHERE user_id = $1 AND token_hash <> $2", [userId, exceptToken ? hashSecret(exceptToken) : ""]);
}

// ------------------------------------------------------------- one-time tokens

export type TokenPurpose = "magic_link" | "verify_email" | "reset_password" | "oauth_state" | "oauth_complete" | "invite";

const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  magic_link: 30,
  verify_email: 24 * 60,
  reset_password: 60,
  oauth_state: 15,
  oauth_complete: 2,
  invite: 7 * 24 * 60,
};

export async function issueToken(ctx: AppContext, purpose: TokenPurpose, input: { userId?: string | null; email?: string | null; data?: Record<string, unknown> }): Promise<string> {
  const token = newSecret();
  await sys(
    ctx,
    `INSERT INTO plexo.tokens (purpose, token_hash, user_id, email, data, expires_at) VALUES ($1, $2, $3, $4, $5::jsonb, now() + make_interval(mins => ${TOKEN_TTL_MINUTES[purpose]}))`,
    [purpose, hashSecret(token), input.userId ?? null, input.email ?? null, JSON.stringify(input.data ?? {})],
  );
  return token;
}

/** Uses a token exactly once. Null if it's unknown, expired, already used, or for another purpose. */
export async function consumeToken(ctx: AppContext, purpose: TokenPurpose, token: string): Promise<{ userId: string | null; email: string | null; data: Record<string, unknown> } | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const [row] = await sys<{ user_id: string | null; email: string | null; data: Record<string, unknown> }>(
    ctx,
    `UPDATE plexo.tokens SET used_at = now()
     WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id, email::text AS email, data`,
    [hashSecret(token), purpose],
  );
  return row ? { userId: row.user_id, email: row.email, data: row.data ?? {} } : null;
}

/** Housekeeping, run occasionally: expired sessions and used/expired tokens. */
export async function pruneAuthTables(ctx: AppContext): Promise<void> {
  await runDb({
    database: ctx.database,
    login: "system",
    statements: [
      { sql: "DELETE FROM plexo.sessions WHERE expires_at < now() - interval '1 day'" },
      { sql: "DELETE FROM plexo.tokens WHERE expires_at < now() - interval '1 day'" },
    ],
  });
}
