// Types for server functions. A function is a file in functions/ whose default export takes a
// standard web Request and returns a Response:
//
//   import type { PlexoFunction } from "./types";
//
//   const handler: PlexoFunction = async (req, { user, db, env }) => {
//     if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
//     const { name } = await req.json();
//     await db.from("greetings").insert({ name, user_id: user.id });
//     return Response.json({ message: `Hello ${name}` });
//   };
//   export default handler;
//
// Call it from the app with plexo.functions.invoke("<file name>", { body }).
// Run it on a schedule by also exporting: export const schedule = "0 9 * * *"; (cron, UTC)

export type FunctionUser = {
  id: string;
  email: string;
  role: string;
  metadata: Record<string, unknown>;
};

/** Same query API as the browser client (plexo.from(...)), but with full access: it is not
 * limited by your tables' row-level security, so check `user` yourself before reading or
 * changing someone's data. */
export type AdminDb = {
  from<T = any>(table: string): any;
  rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }>;
  sql<T = any>(query: string, params?: unknown[]): Promise<{ data: T[] | null; error: { message: string } | null }>;
};

export type FunctionContext = {
  /** The signed-in visitor who called this function, or null. Always null for schedules. */
  user: FunctionUser | null;
  db: AdminDb;
  /** Your secrets (set in Plexo → your app → Secrets), e.g. env.STRIPE_SECRET_KEY. */
  env: Record<string, string>;
  /** Sends an email from your app (verified sender is your site's domain or Plexo's). */
  sendEmail(input: { to: string | string[]; subject: string; html?: string; text?: string; replyTo?: string }): Promise<void>;
};

export type PlexoFunction = (req: Request, ctx: FunctionContext) => Promise<Response> | Response;
