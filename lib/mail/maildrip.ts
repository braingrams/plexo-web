import { EMAIL_COLORS } from "@/lib/theme";
import { decryptMaildripKey } from "@/lib/crypto";
import { logEmailDelivery, type EmailDeliveryContext } from "./logEmail";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://plexo.charisol.io";

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

// ── Per-site (BYO) MailDrip sending — distinct from sendMaildripEmail above, which always
// uses Plexo's own shared platform key. Lives here (not lib/commerce/maildripNotify.ts,
// which imports FROM this file) specifically so lib/commerce/orderStatusActions.ts can
// import these without creating a cycle back through maildripNotify.ts's own
// notifyMaildripOfPaidOrder, which now calls into orderStatusActions.ts.

/** Site's own MailDrip key when configured, falling back to Plexo's shared platform key —
 * lets every Commerce sender (order-status emails, digital delivery) resolve the same key
 * without duplicating the fallback logic. Structurally typed rather than importing
 * CommerceSettings's real entity type, to keep this generic mail module decoupled from
 * lib/db/commerceEntities. */
export function resolveMaildripApiKey(settings: { maildripApiKeyEncrypted?: string | null }): string | null {
  return settings.maildripApiKeyEncrypted ? decryptMaildripKey(settings.maildripApiKeyEncrypted) : (maildripApiKey ?? null);
}

/** Sends a transactional email through a SPECIFIC MailDrip key (e.g. resolveMaildripApiKey's
 * result) — unlike sendMaildripEmail above, which always uses Plexo's shared platform key,
 * this lets a Commerce email go out under the site's own connected MailDrip account when it
 * has one (that account's own verified sending domain/identity applies automatically — no
 * separate "from" field to set here). organizationId/templateId are optional and only used
 * for EmailLog attribution; context is required so every call site records what kind of
 * commerce email this actually was (order status vs. digital delivery, etc.) instead of a
 * single hardcoded label covering sends that aren't really the same thing. */
export async function sendCommerceEmail(
  apiKey: string,
  input: { to: string; subject: string; html: string; context: EmailDeliveryContext; organizationId?: string; templateId?: string },
): Promise<void> {
  const { organizationId, templateId, context, ...body } = input;
  try {
    const response = await fetch(maildripApiUrl, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`MailDrip send failed (${response.status}): ${await response.text()}`);
    }
    logEmailDelivery({ kind: "maildrip", to: input.to, subject: input.subject, status: "sent", context, organizationId, templateId });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to: input.to, subject: input.subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context, organizationId, templateId,
    });
    throw err;
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

/** Public base URL emails use for hosted images (Gmail can't show SVG, so logos are PNGs). */
export const EMAIL_SITE_URL = SITE_URL;

/** The two Plexo wordmark PNGs in public/brand — dark ink for light mode, light ink for dark mode. */
export const EMAIL_LOGO = { onLight: `${SITE_URL}/brand/plexo-wordmark-dark.png`, onDark: `${SITE_URL}/brand/plexo-wordmark-light.png` };

/**
 * Dark-mode overrides. Colours are inline everywhere (the only thing every mail client keeps), so
 * each rule matches the inline colour by attribute and swaps it. Clients that ignore
 * prefers-color-scheme (Outlook desktop, Gmail) simply keep the light design, which is fully
 * legible on its own. Text on the lime button uses #111111 (not #121212) so it is never swapped.
 */
const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    html, body, .em-outer { background:#0B0B12 !important; }
    .em-card { background:#15161C !important; border-color:#2C2E35 !important; }
    .logo-l { display:none !important; } .logo-d { display:block !important; max-height:none !important; }
    [style*="color:#121212"] { color:#F4F5F0 !important; }
    [style*="color:#3F3F3C"] { color:#D6D7D1 !important; }
    [style*="color:#5B5B58"], [style*="color:#76766F"] { color:#A6A7A2 !important; }
    [style*="color:#517A12"] { color:#B8F34A !important; }
    [style*="color:#B42318"] { color:#FF8A7A !important; }
    [style*="color:#8A5A00"], [style*="color:#7A4B00"] { color:#F5AC05 !important; }
    [style*="background:#F4F5F0"] { background:#1D1F26 !important; }
    [style*="background:#F0F6DF"] { background:#1F2614 !important; }
    [style*="background:#F7F8F3"]:not(.em-outer) { background:#1D1F26 !important; }
    [style*="background:#FDF0CC"], [style*="background:#FFF8E6"] { background:#2B2310 !important; }
    [style*="#E8E8E4"] { border-color:#2C2E35 !important; }
    .em-card a:not(.em-btn) { color:#B8F34A !important; }
  }`;

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Shared branded shell used by every transactional email, so the logo/header/card/footer markup
 * lives in exactly one place. Falls back to the real Plexo wordmark when `brand` is omitted —
 * account-security emails always omit it intentionally. White-label org logos always win.
 */
export function emailShell(input: {
  title: string;
  bodyHtml: string;
  footerHtml?: string;
  brand?: EmailBrand;
  /** Inbox preview text (hidden in the body, shown beside the subject). */
  preheader?: string;
  /** Marketing-style emails link a one-click unsubscribe/preferences page in the footer. */
  unsubscribeUrl?: string;
}): string {
  const brandName = escAttr(input.brand?.name ?? "Plexo");
  const accent = input.brand?.color ?? EMAIL_COLORS.brandDeep;
  const isPlexo = !input.brand;
  const logoMarkup = input.brand?.logoUrl
    ? `<img src="${escAttr(input.brand.logoUrl)}" height="36" alt="${brandName}" style="display:block;margin:0 auto;height:36px;width:auto;max-width:200px;border:0;border-radius:8px;" />`
    : isPlexo
      ? `<img class="logo-l" src="${EMAIL_LOGO.onLight}" width="124" height="32" alt="Plexo" style="display:block;margin:0 auto;width:124px;height:32px;border:0;" />
         <img class="logo-d" src="${EMAIL_LOGO.onDark}" width="124" height="32" alt="" style="display:none;max-height:0;overflow:hidden;margin:0 auto;width:124px;height:32px;border:0;" />`
      : `<table align="center" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;"><tr>
           <td width="36" height="36" align="center" style="width:36px;height:36px;background:${accent};border-radius:10px;color:#ffffff;font-size:18px;font-weight:800;line-height:36px;font-family:Arial,sans-serif;">${brandName.charAt(0).toUpperCase()}</td>
           <td style="padding-left:10px;font-size:18px;font-weight:800;color:#121212;letter-spacing:-0.3px;">${brandName}</td>
         </tr></table>`;

  const help = isPlexo
    ? `Need a hand? Just reply to this email &mdash; a real person reads it.<br/>`
    : "";
  const unsub = input.unsubscribeUrl
    ? `<a href="${input.unsubscribeUrl}" style="color:#5B5B58;text-decoration:underline;">Unsubscribe or change which emails you get</a><br/>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${input.title}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>${DARK_CSS}</style>
</head>
<body style="margin:0;padding:0;background:#F7F8F3;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  ${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${input.preheader}${"&nbsp;&zwnj;".repeat(40)}</div>` : ""}
  <table class="em-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8F3;">
    <tr>
      <td align="center" style="padding:48px 16px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td align="center" style="padding:0 8px 28px;text-align:center;">${logoMarkup}</td></tr>
          <tr>
            <td class="em-card" style="background:#FFFFFF;border:1px solid #E8E8E4;border-radius:20px;padding:44px 40px;text-align:left;color:#121212;">
              ${input.bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="left" style="padding:24px 8px 0;font-size:12px;line-height:1.7;color:#5B5B58;">
              ${input.footerHtml ?? ""}
              ${help}${unsub}
              &copy; ${new Date().getFullYear()} ${brandName}${isPlexo ? " &middot; Made by Charisol &middot; plexopages.com" : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
