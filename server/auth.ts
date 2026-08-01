import "dotenv/config";

import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { prismaAdapter } from "@better-auth/prisma-adapter";

import { prisma } from "@/server/prisma";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildInviteEmail, buildPasswordResetEmail, buildVerificationEmail } from "@/lib/mail/templates";
import { ac, roles } from "@/server/accessControl";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName: "Plexo SaaS",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  user: {
    modelName: "User",
    fields: {
      emailVerified: "isConfirmed",
    },
    additionalFields: {
      // Carries the plan picked on the pricing page straight into user creation — see
      // databaseHooks below for why this can't instead be a follow-up authenticated write.
      pendingPlan: { type: "string", required: false, input: true },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // signUp.email() never has a session to attach a follow-up write to: with
        // requireEmailVerification true (below), better-auth unconditionally skips
        // auto-sign-in, so there's no cookie yet at the point registration would otherwise
        // call an authenticated "set my pending plan" endpoint. additionalFields only
        // enforces JS type ("string"), not enum membership, and pendingPlan is a real
        // Prisma SubscriptionPlan? column — passing anything else through would throw and
        // fail the entire signup, so this sanitizes to exactly PRO/ULTRA/null first.
        before: async (user) => {
          const requested = (user as Record<string, unknown>).pendingPlan;
          const pendingPlan = requested === "PRO" || requested === "ULTRA" ? requested : null;
          return { data: { ...user, pendingPlan } };
        },
      },
    },
  },
  account: {
    modelName: "Account",
  },
  session: {
    modelName: "Session",
  },
  verification: {
    modelName: "Verification",
  },
  // Rate limiting is on by default in production (better-auth's own default), but the
  // default storage is in-memory — useless on Vercel's serverless functions, where each
  // instance keeps its own counter, so an attacker bypasses the limit just by landing on
  // a different warm instance. "database" shares counts across all instances via the
  // RateLimit table (prisma/schema.prisma). Auth endpoints get tighter limits than the
  // framework's 100-req/10s default, since those are the ones worth protecting against
  // credential-stuffing / brute force specifically.
  rateLimit: {
    storage: "database",
    modelName: "RateLimit",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMaildripEmail({
        to: user.email,
        subject: "Verify your Plexo account",
        html: buildVerificationEmail(url),
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMaildripEmail({
        to: user.email,
        subject: "Reset your Plexo password",
        html: buildPasswordResetEmail(url),
      });
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      // Every existing single-user account gets exactly one org via the
      // backfill script (scripts/backfill-personal-orgs.ts); new signups get
      // theirs created the first time they visit the dashboard.
      allowUserToCreateOrganization: true,
      // White-label accent color — a plain column on Organization (prisma/schema.prisma),
      // not a better-auth-recognized field by default, so it must be declared here to flow
      // through auth.api.updateOrganization / authClient.organization.update. See
      // lib/subscription.ts's canWhiteLabel for the plan gate that governs whether it's
      // actually *used* anywhere it's read (dashboard chrome, emails, SDK) — this only
      // controls whether the field can be persisted at all.
      schema: {
        organization: {
          additionalFields: {
            brandColor: { type: "string", required: false, input: true },
          },
        },
      },
      sendInvitationEmail: async ({ id, role, email, organization: org, inviter }) => {
        const { getOrgBrand } = await import("@/lib/subscription");
        const brand = await getOrgBrand(org.id);
        await sendMaildripEmail({
          to: email,
          subject: `${inviter.user.name} invited you to join ${org.name} on Plexo`,
          html: buildInviteEmail({
            inviterName: inviter.user.name,
            orgName: org.name,
            role,
            acceptUrl: `${baseUrl}/accept-invite/${id}`,
            brand,
          }),
        });
      },
    }),
  ],
});
