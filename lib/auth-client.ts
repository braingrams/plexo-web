"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// organizationClient() gives us authClient.organization.{create,inviteMember,
// acceptInvitation,listMembers,updateMemberRole,removeMember,setActive,...} and the
// authClient.useActiveOrganization() React hook, matching server/auth.ts's
// organization() plugin registration (see server/accessControl.ts for the roles).
const coreClient = createAuthClient({ baseURL, plugins: [organizationClient()] });
const coreAny = coreClient as any;

const signUpEmail = coreAny.signUp?.email ?? coreAny.signUpEmail;
const signInEmail = coreAny.signIn?.email ?? coreAny.signInEmail;
const requestPasswordReset = coreAny.requestPasswordReset ?? coreAny.forgetPassword;

type ForgetPasswordInput = {
  email: string;
  redirectTo?: string;
};

const overrides = {
  signUp: {
    email: (input: Record<string, unknown>) => signUpEmail(input),
  },
  signIn: {
    email: (input: Record<string, unknown>) => signInEmail(input),
  },
  forgetPassword: (input: ForgetPasswordInput) =>
    requestPasswordReset(input),
};

// better-auth's client is a `get`-only Proxy (no `ownKeys` trap) over an empty function
// target — every nested namespace (organization, admin, useSession, signOut, ...) only
// exists through that `get` trap. `{...coreClient}` silently produces an EMPTY object
// (verified: Object.keys(coreClient) === []), so spreading it here previously dropped
// everything except the 3 keys explicitly re-added below, breaking any other
// authClient.* call with "Cannot read properties of undefined" the first time it was
// ever exercised. Wrapping in our own Proxy (instead of spreading) keeps every
// pass-through namespace working while still overriding these 3.
export const authClient = new Proxy(coreClient as any, {
  get(target, prop, receiver) {
    if (prop in overrides) return overrides[prop as keyof typeof overrides];
    return Reflect.get(target, prop, receiver);
  },
}) as typeof coreClient & typeof overrides;
