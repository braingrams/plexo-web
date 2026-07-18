"use client";

import { createAuthClient } from "better-auth/react";

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const coreClient = createAuthClient({ baseURL });
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
