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

export const authClient = {
  ...coreClient,
  signUp: {
    email: (input: Record<string, unknown>) => signUpEmail(input),
  },
  signIn: {
    email: (input: Record<string, unknown>) => signInEmail(input),
  },
  forgetPassword: (input: ForgetPasswordInput) =>
    requestPasswordReset(input),
};
