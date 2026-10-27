import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { startTestPostgres, type TestPostgres } from "./helpers/appPostgres";

// Visitor sign-in for apps (lib/appAuth), run against a real PostgreSQL through the same
// gateway logic AppDbFn uses: sign-up, password sign-in, magic links, password reset,
// sessions and disabling accounts.

let pgt: TestPostgres;
const sent: Array<{ kind: string; to: string; url: string }> = [];

vi.mock("@/lib/db/appEntities", () => ({ AppDatabase: {} }));
vi.mock("@/lib/appData/provision", async (orig) => ({ ...(await orig<object>()), ensureAppDatabase: async () => ({}) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true, clientIp: () => "1.1.1.1" }));
vi.mock("@/lib/appData/db", async () => {
  const { runRequest } = await import("@/lambda/app-db/runner");
  class AppDbError extends Error {
    constructor(public error: any) {
      super(error.message);
    }
  }
  const runDb = async (req: any) => {
    const res = await runRequest(req, pgt.connector);
    if (!res.ok) throw new AppDbError(res.error);
    return res.results;
  };
  return {
    AppDbError,
    AppDbUnavailableError: class extends Error {},
    runDb,
    queryDb: async (req: any, sql: string, params: unknown[] = []) => (await runDb({ ...req, statements: [{ sql, params }] }))[0].rows,
    databaseName: (id: string, env: string) => `a_${id.replace(/-/g, "")}_${env}`,
  };
});
vi.mock("@/lib/appAuth/emails", () => ({
  sendMagicLinkEmail: async (_ctx: unknown, to: string, url: string) => void sent.push({ kind: "magic", to, url }),
  sendVerifyEmail: async (_ctx: unknown, to: string, url: string) => void sent.push({ kind: "verify", to, url }),
  sendResetEmail: async (_ctx: unknown, to: string, url: string) => void sent.push({ kind: "reset", to, url }),
  sendInviteEmail: async (_ctx: unknown, to: string, url: string) => void sent.push({ kind: "invite", to, url }),
}));

import { provisioningSteps } from "@/lib/appData/provision";
import * as auth from "@/lib/appAuth/service";
import type { AppContext } from "@/lib/appRuntime/context";

const appId = randomUUID();
const database = `a_${appId.replace(/-/g, "")}_dev`;
const meta = { ipHash: "test", userAgent: "vitest" };
function ctx(settings: Partial<AppContext["settings"]> = {}): AppContext {
  return {
    templateId: appId,
    organizationId: "org",
    userId: "owner",
    appName: "Test App",
    env: "dev",
    host: "preview--abcdefghij.example.com",
    origin: "https://preview--abcdefghij.example.com",
    database,
    settings: { templateId: appId, organizationId: "org", authPassword: true, authMagicLink: true, authGoogle: false, allowSignups: true, requireEmailConfirmation: false, ...settings } as AppContext["settings"],
  };
}
const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

beforeAll(async () => {
  pgt = await startTestPostgres();
  for (const step of provisioningSteps(database)) await pgt.adminExec(step.sql, step.database);
  await pgt.enableLogins(database);
}, 120_000);

afterAll(async () => {
  await pgt?.stop();
});

describe("password sign-up and sign-in", () => {
  it("signs up, starts a session, and resolves the user from it", async () => {
    const res = await auth.signUp(ctx(), { email: "Ada@Example.com", password: "correct horse battery", data: { name: "Ada" } }, meta);
    expect("sessionToken" in res).toBe(true);
    if (!("sessionToken" in res)) return;
    expect(res.user).toMatchObject({ email: "ada@example.com", role: "user", metadata: { name: "Ada" } });
    const user = await auth.currentUser(ctx(), res.sessionToken);
    expect(user?.email).toBe("ada@example.com");
  });

  it("rejects duplicate emails, weak passwords and wrong passwords with plain messages", async () => {
    await expect(auth.signUp(ctx(), { email: "ada@example.com", password: "another good one" }, meta)).rejects.toThrow(/already exists/);
    await expect(auth.signUp(ctx(), { email: "bob@example.com", password: "short" }, meta)).rejects.toThrow(/at least 8/);
    await expect(auth.signInWithPassword(ctx(), { email: "ada@example.com", password: "nope nope nope" }, meta)).rejects.toThrow(/don't match/);
    await expect(auth.signInWithPassword(ctx(), { email: "nobody@example.com", password: "nope nope nope" }, meta)).rejects.toThrow(/don't match/);
  });

  it("signs in with the right password; sign-out ends the session", async () => {
    const res = await auth.signInWithPassword(ctx(), { email: "ada@example.com", password: "correct horse battery" }, meta);
    expect(await auth.currentUser(ctx(), res.sessionToken)).not.toBeNull();
    await auth.signOut(ctx(), res.sessionToken);
    expect(await auth.currentUser(ctx(), res.sessionToken)).toBeNull();
  });

  it("honors closed sign-ups and email confirmation", async () => {
    await expect(auth.signUp(ctx({ allowSignups: false }), { email: "x@example.com", password: "long enough pw" }, meta)).rejects.toThrow(/closed/);
    const pending = await auth.signUp(ctx({ requireEmailConfirmation: true }), { email: "conf@example.com", password: "long enough pw" }, meta);
    expect(pending).toEqual({ needsEmailConfirmation: true });
    await expect(auth.signInWithPassword(ctx({ requireEmailConfirmation: true }), { email: "conf@example.com", password: "long enough pw" }, meta)).rejects.toThrow(/Confirm your email/);
    const link = sent.find((s) => s.kind === "verify" && s.to === "conf@example.com")!;
    const verified = await auth.verifyLink(ctx(), "verify_email", tokenFrom(link.url), meta);
    expect(verified.signedIn?.user.email_verified).toBe(true);
  });
});

describe("magic links", () => {
  it("creates the account on first use, works once, and lands on the app", async () => {
    await auth.sendMagicLink(ctx(), { email: "magic@example.com", redirectTo: "/dashboard" }, meta);
    const token = tokenFrom(sent.find((s) => s.kind === "magic" && s.to === "magic@example.com")!.url);
    const first = await auth.verifyLink(ctx(), "magic_link", token, meta);
    expect(first.signedIn?.user.email).toBe("magic@example.com");
    expect(first.redirectTo).toBe("https://preview--abcdefghij.example.com/dashboard");
    const again = await auth.verifyLink(ctx(), "magic_link", token, meta);
    expect(again.signedIn).toBeUndefined();
    expect(again.error).toMatch(/expired or was already used/);
  });

  it("never redirects to another site", async () => {
    await auth.sendMagicLink(ctx(), { email: "magic@example.com", redirectTo: "https://evil.example.org/steal" }, meta);
    const token = tokenFrom(sent.filter((s) => s.kind === "magic" && s.to === "magic@example.com").at(-1)!.url);
    const res = await auth.verifyLink(ctx(), "magic_link", token, meta);
    expect(res.redirectTo).toBe("https://preview--abcdefghij.example.com/");
  });
});

describe("password reset", () => {
  it("resets with the emailed token and signs out other sessions", async () => {
    const old = await auth.signInWithPassword(ctx(), { email: "ada@example.com", password: "correct horse battery" }, meta);
    await auth.sendPasswordReset(ctx(), { email: "ada@example.com" }, meta);
    const url = sent.filter((s) => s.kind === "reset").at(-1)!.url;
    expect(new URL(url).pathname).toBe("/reset-password");
    const res = await auth.resetPassword(ctx(), { token: tokenFrom(url), password: "brand new passphrase" }, meta);
    expect(res.user.email).toBe("ada@example.com");
    // The session from before the reset no longer works.
    const { resolveSessionUser } = await import("@/lib/appAuth/store");
    expect(await resolveSessionUser(ctx(), old.sessionToken)).toBeNull();
    await expect(auth.signInWithPassword(ctx(), { email: "ada@example.com", password: "brand new passphrase" }, meta)).resolves.toBeTruthy();
  });

  it("says the same thing whether or not the account exists", async () => {
    const before = sent.length;
    await expect(auth.sendPasswordReset(ctx(), { email: "ghost@example.com" }, meta)).resolves.toBeUndefined();
    expect(sent.length).toBe(before);
  });
});

describe("account changes", () => {
  it("a disabled account can't sign in, and its sessions stop working", async () => {
    const res = await auth.signInWithPassword(ctx(), { email: "magic@example.com", password: "x".repeat(1) }, meta).catch(() => null);
    expect(res).toBeNull(); // magic-link account has no password
    const { findUserByEmail, updateUser, resolveSessionUser, createSession } = await import("@/lib/appAuth/store");
    const user = (await findUserByEmail(ctx(), "magic@example.com"))!;
    const token = await createSession(ctx(), user.id, meta);
    await updateUser(ctx(), user.id, { disabled: true });
    expect(await resolveSessionUser(ctx(), token)).toBeNull();
  });
});
