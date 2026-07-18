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
<body style="margin:0;padding:0;background:#060d1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060d1a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a1628;border-radius:16px;border:1px solid rgba(100,180,255,0.15);overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0c1e3a 0%,#102847 100%);padding:32px 40px 24px;border-bottom:1px solid rgba(100,180,255,0.12);">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#1fb6ff,#0080c7);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                  <span style="color:#fff;font-size:18px;font-weight:900;line-height:1;">P</span>
                </div>
                <span style="color:#e0f2ff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Plexo</span>
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#e8f4ff;letter-spacing:-0.3px;">Verify your email address</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#94b8d8;line-height:1.6;">
                Welcome to Plexo — the visual email &amp; template builder. Before your first login, please confirm your email address so we can keep your account secure.
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#7a9ec0;line-height:1.6;">
                Click the button below to verify your account. This link is valid for <strong style="color:#94b8d8;">60 minutes</strong>.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#1fb6ff,#0080c7);">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Verify Email Address →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#4e7a99;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#3d6385;word-break:break-all;line-height:1.4;">
                <a href="${actionUrl}" style="color:#1fb6ff;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#071220;border-top:1px solid rgba(100,180,255,0.1);padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#385873;line-height:1.5;">
                If you didn't create a Plexo account, you can safely ignore this email — no action is needed.<br/>
                &copy; ${new Date().getFullYear()} Plexo. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
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
<body style="margin:0;padding:0;background:#060d1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060d1a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a1628;border-radius:16px;border:1px solid rgba(100,180,255,0.15);overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0c1e3a 0%,#102847 100%);padding:32px 40px 24px;border-bottom:1px solid rgba(100,180,255,0.12);">
              <div style="display:inline-flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;background:linear-gradient(135deg,#1fb6ff,#0080c7);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                  <span style="color:#fff;font-size:18px;font-weight:900;line-height:1;">P</span>
                </div>
                <span style="color:#e0f2ff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Plexo</span>
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#e8f4ff;letter-spacing:-0.3px;">Reset your password</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#94b8d8;line-height:1.6;">
                We received a request to reset the password for your Plexo account. If this was you, click the button below to set a new password.
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#e05c5c;font-weight:600;line-height:1.6;">
                ⚠️ If you did not request this, please ignore this email. Your account remains secure.
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#7a9ec0;line-height:1.6;">
                This link expires in <strong style="color:#94b8d8;">15 minutes</strong>.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#e05c5c,#b83535);">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Reset Password →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#4e7a99;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#3d6385;word-break:break-all;line-height:1.4;">
                <a href="${actionUrl}" style="color:#1fb6ff;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#071220;border-top:1px solid rgba(100,180,255,0.1);padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#385873;line-height:1.5;">
                If you didn't request a password reset, no action is needed — your account remains secure.<br/>
                &copy; ${new Date().getFullYear()} Plexo. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
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
