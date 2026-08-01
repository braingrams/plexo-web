import { darken } from "@/lib/color";

const maildripApiUrl =
  process.env.MAILDRIP_API_URL ?? "https://api.maildrip.io/api/v1/emails/transaction";
const maildripApiKey = process.env.MAILDRIP_API_KEY;

export async function sendMaildripEmail(input: {
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

/** Optional per-organization override for emailShell's logo/name/accent color, resolved
 * via lib/subscription.ts's getOrganizationOwnerPlan + canWhiteLabel by each call site —
 * emailShell itself does no entitlement checking, it just renders whatever it's given. */
export type EmailBrand = {
  name: string;
  logoUrl?: string;
  color?: string;
};

/**
 * Shared branded card shell used by every transactional email (verification, password
 * reset, invites, mention/reply notifications) so the logo/header/card markup lives in
 * exactly one place instead of being copy-pasted per email. Falls back to the Plexo mark
 * when `brand` is omitted — account-security emails (verification, password reset) always
 * omit it intentionally, see lib/mail/templates.ts.
 */
export function emailShell(input: {
  title: string;
  bodyHtml: string;
  footerHtml?: string;
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? "#8b5cf6";
  const accentDeep = input.brand?.color ? darken(accent, 0.12) : "#7c3aed";
  const brandName = input.brand?.name ?? "Plexo";
  const logoMarkup = input.brand?.logoUrl
    ? `<img src="${input.brand.logoUrl}" width="36" height="36" alt="${brandName}" style="display:block;border-radius:8px;object-fit:cover;" />`
    : `<table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background:linear-gradient(135deg,${accent},${accentDeep});border-radius:8px;text-align:center;vertical-align:middle;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-top:2px;">
                      <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="#ffffff" opacity="0.95" />
                      <path d="M9 12l2 2 4-4" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </td>
                </tr>
              </table>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${input.title}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:48px 16px;">
    <tr>
      <td align="center">
        <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="vertical-align:middle;padding-right:10px;">
              ${logoMarkup}
            </td>
            <td style="vertical-align:middle;">
              <span style="color:#0f172a;font-size:22px;font-weight:800;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${brandName}</span>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.03);">
          <tr>
            <td style="padding:44px 36px;text-align:center;">
              ${input.bodyHtml}
            </td>
          </tr>
        </table>

        <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">
          ${input.footerHtml ?? ""}
          &copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
