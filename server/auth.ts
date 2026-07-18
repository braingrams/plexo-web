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
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background:#f1f5f9;padding:32px 40px 24px;border-bottom:1px solid #e2e8f0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;height:36px;background:linear-gradient(135deg,#fc0694,#d4057d);border-radius:8px;text-align:center;vertical-align:middle;">
                          <!-- Custom Shield Logo -->
                          <img src="https://plexo.dev/assets/logo-shield-white.png" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;border:none;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#0f172a;font-size:20px;font-weight:800;letter-spacing:-0.3px;font-family:'Space Grotesk',-apple-system,sans-serif;">Plexo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;font-family:'Space Grotesk',-apple-system,sans-serif;">Verify your email address</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
                Welcome to Plexo — the visual email &amp; template builder. Before your first login, please confirm your email address so we can keep your account secure.
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.6;">
                Click the button below to verify your account. This link is valid for <strong style="color:#fc0694;">60 minutes</strong>.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#fc0694,#d4057d);">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Verify Email Address →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;">
                <a href="${actionUrl}" style="color:#fc0694;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
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
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background:#f1f5f9;padding:32px 40px 24px;border-bottom:1px solid #e2e8f0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;height:36px;background:linear-gradient(135deg,#fc0694,#d4057d);border-radius:8px;text-align:center;vertical-align:middle;">
                          <!-- Custom Shield Logo -->
                          <img src="https://plexo.dev/assets/logo-shield-white.png" alt="" width="20" height="20" style="display:inline-block;vertical-align:middle;border:none;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#0f172a;font-size:20px;font-weight:800;letter-spacing:-0.3px;font-family:'Space Grotesk',-apple-system,sans-serif;">Plexo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;font-family:'Space Grotesk',-apple-system,sans-serif;">Reset your password</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
                We received a request to reset the password for your Plexo account. If this was you, click the button below to set a new password.
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#f87171;font-weight:600;line-height:1.6;">
                ⚠️ If you did not request this, please ignore this email. Your account remains secure.
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.6;">
                This link expires in <strong style="color:#fc0694;">15 minutes</strong>.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#fc0694,#d4057d);">
                    <a href="${actionUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Reset Password →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;">
                <a href="${actionUrl}" style="color:#fc0694;text-decoration:none;">${actionUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:20px 40px;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
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
