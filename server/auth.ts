import "dotenv/config";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";

import { prisma } from "@/server/prisma";

const maildripApiUrl =
  process.env.MAILDRIP_API_URL ?? "https://api.maildrip.io/api/v1/emails/transaction";
const maildripApiKey = process.env.MAILDRIP_API_KEY;

function buildVerificationEmail(actionUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your Plexo account</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:48px 16px;">
    <tr>
      <td align="center">
        <!-- Logo and Brand name centered -->
        <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);border-radius:8px;text-align:center;vertical-align:middle;">
                    <!-- Inline SVG Shield logo -->
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-top:2px;">
                      <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="#ffffff" opacity="0.95" />
                      <path d="M9 12l2 2 4-4" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
            <td style="vertical-align:middle;">
              <span style="color:#0f172a;font-size:22px;font-weight:800;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Plexo</span>
            </td>
          </tr>
        </table>

        <!-- Main Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.03);">
          <tr>
            <td style="padding:44px 36px;text-align:center;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Verify your email address</h1>
              
              <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
                Welcome to Plexo — the visual email &amp; template builder. Before your first login, please confirm your email address so we can secure your workspace.
              </p>
              
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;text-align:center;">
                Click the button below to verify your account. This link is valid for <strong style="color:#8b5cf6;">60 minutes</strong>.
              </p>

              <!-- Centered CTA Button -->
              <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 32px auto;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);text-align:center;">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Verify Email Address →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;text-align:center;">
                <a href="${actionUrl}" style="color:#8b5cf6;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Copyright centered outside card -->
        <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">
          If you didn't create a Plexo account, you can safely ignore this email.<br/>
          &copy; ${new Date().getFullYear()} Plexo. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPasswordResetEmail(actionUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your Plexo password</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:48px 16px;">
    <tr>
      <td align="center">
        <!-- Logo and Brand name centered -->
        <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);border-radius:8px;text-align:center;vertical-align:middle;">
                    <!-- Inline SVG Shield logo -->
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-top:2px;">
                      <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="#ffffff" opacity="0.95" />
                      <path d="M9 12l2 2 4-4" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
            <td style="vertical-align:middle;">
              <span style="color:#0f172a;font-size:22px;font-weight:800;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">Plexo</span>
            </td>
          </tr>
        </table>

        <!-- Main Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.03);">
          <tr>
            <td style="padding:44px 36px;text-align:center;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Reset your password</h1>
              
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;text-align:center;">
                We received a request to reset the password for your Plexo account. If this was you, click the button below to set a new password.
              </p>
              
              <p style="margin:0 0 12px;font-size:14px;color:#f87171;font-weight:600;line-height:1.6;text-align:center;">
                ⚠️ If you did not request this, please ignore this email.
              </p>
              
              <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;text-align:center;">
                This link expires in <strong style="color:#8b5cf6;">15 minutes</strong>.
              </p>

              <!-- Centered CTA Button -->
              <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 32px auto;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);text-align:center;">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Reset Password →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;text-align:center;">
                <a href="${actionUrl}" style="color:#8b5cf6;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Copyright centered outside card -->
        <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">
          If you didn't request a password reset, no action is needed — your account remains secure.<br/>
          &copy; ${new Date().getFullYear()} Plexo. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendMaildripEmail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!maildripApiUrl || !maildripApiKey) {
    throw new Error("MAILDRIP_API_URL and MAILDRIP_API_KEY must be configured.");
  }

  const payload = {
    to: input.to,
    subject: input.subject,
    html: input.html,
  };

  console.info("[maildrip] transactional payload", {
    to: payload.to,
    subject: payload.subject,
  });

  const response = await fetch(maildripApiUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-api-key": maildripApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Maildrip API error (${response.status}): ${body}`);
  }
}

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
});
