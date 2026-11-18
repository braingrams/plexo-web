import { EMAIL_COLORS } from "@/lib/theme";
import { planLabel } from "@/lib/plan/plans";
import { emailShell, type EmailBrand } from "./maildrip";

/** Readable text colour for a button of the given background (lime and light org colours get ink, dark ones white). */
function onColor(bg: string): string {
  const m = /^#?([a-f\d]{6})$/i.exec(bg.trim());
  if (!m) return EMAIL_COLORS.onBrand;
  const n = parseInt(m[1], 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lum > 0.35 ? EMAIL_COLORS.onBrand : "#ffffff";
}

/** The one clear call-to-action: a lime pill, bulletproof for Outlook (VML round-rect fallback). `colorDeep` is
 * accepted for backwards compatibility and unused. */
export const CTA_BUTTON = (href: string, label: string, color: string = EMAIL_COLORS.brand, _colorDeep?: string) => {
  const text = onColor(color);
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 32px 0;">
    <tr>
      <td style="border-radius:12px;background:${color};text-align:center;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="24%" stroke="f" fillcolor="${color}"><w:anchorlock/><center style="color:${text};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a class="em-btn" href="${href}" target="_blank" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:800;color:${text};text-decoration:none;border-radius:12px;line-height:20px;letter-spacing:-0.1px;">${label} &rarr;</a><!--<![endif]-->
      </td>
    </tr>
  </table>`;
};

const FALLBACK_LINK = (href: string, color = EMAIL_COLORS.brand) => {
  const link = color.toLowerCase() === EMAIL_COLORS.brand.toLowerCase() ? EMAIL_COLORS.brandDeep : color;
  return `
  <p style="margin:0 0 6px;font-size:12px;color:#5B5B58;line-height:1.5;text-align:left;">
    If the button doesn't work, copy and paste this link into your browser:
  </p>
  <p style="margin:0;font-size:12px;color:#5B5B58;word-break:break-all;line-height:1.5;text-align:left;">
    <a href="${href}" style="color:${link};text-decoration:underline;">${href}</a>
  </p>`;
};

export function buildVerificationEmail(actionUrl: string): string {
  return emailShell({
    title: "Verify your Plexo account",
    preheader: "One click to confirm your email and start building.",
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Verify your email address</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Welcome to Plexo! Please confirm your email address so we know it's really you — it takes one click.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#5B5B58;line-height:1.6;text-align:left;">
        Click the button below to verify your account. This link is valid for <strong style="color:${EMAIL_COLORS.brandDeep};">60 minutes</strong>.
      </p>
      ${CTA_BUTTON(actionUrl, "Verify Email Address")}
      ${FALLBACK_LINK(actionUrl)}
    `,
    footerHtml: "If you didn't create a Plexo account, you can safely ignore this email.<br/>",
  });
}

export function buildPasswordResetEmail(actionUrl: string): string {
  return emailShell({
    title: "Reset your Plexo password",
    preheader: "Choose a new password — the link works for 15 minutes.",
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Reset your password</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        We received a request to reset the password for your Plexo account. If this was you, click the button below to set a new password.
      </p>
      <p style="margin:0 0 12px;font-size:14px;color:#B42318;font-weight:600;line-height:1.6;text-align:left;">
        &#9888;&#65039; If you did not request this, please ignore this email.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#5B5B58;line-height:1.6;text-align:left;">
        This link expires in <strong style="color:${EMAIL_COLORS.brandDeep};">15 minutes</strong>.
      </p>
      ${CTA_BUTTON(actionUrl, "Reset Password")}
      ${FALLBACK_LINK(actionUrl)}
    `,
    footerHtml: "If you didn't request a password reset, no action is needed — your account remains secure.<br/>",
  });
}

/** The Funnel/LMS module's passwordless learner login — same visual shell as every other
 * transactional email (verification, password reset) rather than a fourth look, per the
 * Funnel/LMS plan's visitor-facing flow. Long-lived on purpose (see lib/lms/session.ts):
 * this link is only ever needed once per device, since a valid session cookie is what
 * carries a returning visitor straight into the portal after that. */
export function buildLmsMagicLinkEmail(funnelName: string, actionUrl: string): string {
  return emailShell({
    title: `Your link to ${funnelName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You're in!</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Click below to enter <strong style="color:#121212;">${funnelName}</strong>. No password needed — this link signs you straight in, and you can bookmark the page it opens to come back anytime.
      </p>
      ${CTA_BUTTON(actionUrl, "Enter now")}
      ${FALLBACK_LINK(actionUrl)}
    `,
    footerHtml: "If you didn't request this, you can safely ignore this email.<br/>",
  });
}

/** Sent by app/api/internal/lms-drip-reminder/route.ts's daily sweep the moment a
 * time-based unlock condition (lib/lms/rules.ts's TIME_DRIP_RELATIVE/TIME_DRIP_FIXED_DATE)
 * releases a new page — a notification, not a login link: it points at the funnel's own
 * /learn/[templateId] URL, which re-authenticates the learner if their session cookie is
 * still valid, or shows them the "request a new link" screen if it isn't. */
export function buildLmsDripReadyEmail(funnelName: string, pageTitle: string, portalUrl: string): string {
  return emailShell({
    title: `${pageTitle} is ready`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Your next lesson is ready</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong style="color:#121212;">${pageTitle}</strong> just unlocked in <strong style="color:#121212;">${funnelName}</strong>.
      </p>
      ${CTA_BUTTON(portalUrl, "Continue")}
      ${FALLBACK_LINK(portalUrl)}
    `,
    footerHtml: "",
  });
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

export function buildInviteEmail(input: {
  inviterName: string;
  orgName: string;
  role: string;
  acceptUrl: string;
  /** Org's white-label identity, when entitled — see server/auth.ts's sendInvitationEmail. */
  brand?: EmailBrand;
}): string {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `Join ${input.orgName} on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You've been invited to collaborate</h1>
      <p style="margin:0 0 8px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.inviterName}</strong> invited you to join <strong>${input.orgName}</strong> on ${productName} as a
      </p>
      <p style="margin:0 0 28px;text-align:left;">
        <span style="display:inline-block;background:${EMAIL_COLORS.brandTint};color:${EMAIL_COLORS.brandDeep};font-size:13px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.2px;">${roleLabel}</span>
      </p>
      ${CTA_BUTTON(input.acceptUrl, "Accept Invitation", accent)}
      ${FALLBACK_LINK(input.acceptUrl, accent)}
    `,
    footerHtml: "If you weren't expecting this invitation, you can safely ignore this email.<br/>",
    brand: input.brand,
  });
}

export function buildSiteTransferEmail(input: {
  senderName: string;
  siteName: string;
  acceptUrl: string;
  warningCount: number;
  expiresInDays: number;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `${input.senderName} wants to transfer "${input.siteName}" to you on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You've been offered a site</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.senderName}</strong> wants to transfer full ownership of <strong>${input.siteName}</strong> to your ${productName} account — every page, and any Commerce catalog/orders it has.
      </p>
      ${input.warningCount > 0
        ? `<p style="margin:0 0 28px;text-align:left;">
             <span style="display:inline-block;background:#FDF0CC;color:#7A4B00;font-size:13px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.2px;">
               ${input.warningCount} thing${input.warningCount === 1 ? "" : "s"} to review before accepting
             </span>
           </p>`
        : ""}
      ${CTA_BUTTON(input.acceptUrl, "Review & Respond", accent)}
      ${FALLBACK_LINK(input.acceptUrl, accent)}
    `,
    footerHtml: `This offer expires in ${input.expiresInDays} days. If you weren't expecting this, you can safely ignore this email — nothing transfers unless you explicitly accept it.<br/>`,
    brand: input.brand,
  });
}

export function buildMentionEmail(input: {
  mentionerName: string;
  templateName: string;
  commentSnippet: string;
  deepLinkUrl: string;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `${input.mentionerName} mentioned you on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You were mentioned in a comment</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.mentionerName}</strong> mentioned you on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#3F3F3C;line-height:1.6;text-align:left;background:#F4F5F0;border-radius:10px;padding:16px 20px;">
        &ldquo;${input.commentSnippet}&rdquo;
      </p>
      ${CTA_BUTTON(input.deepLinkUrl, "View Comment", accent)}
      ${FALLBACK_LINK(input.deepLinkUrl, accent)}
    `,
    brand: input.brand,
  });
}

/** Notifies a site owner (not the internal builder-canvas Comment flow above — a public, anonymous blog-post comment awaiting moderation). Links to the moderation list rather than a 1-click HMAC approve link (testimonials' pattern) since a site can accumulate many comments at once, better suited to a list view. */
export function buildNewBlogCommentEmail(input: {
  commenterName: string;
  postTitle: string;
  commentSnippet: string;
  moderationUrl: string;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `New comment on "${input.postTitle}" — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">New comment awaiting review</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.commenterName}</strong> commented on <strong>${input.postTitle}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#3F3F3C;line-height:1.6;text-align:left;background:#F4F5F0;border-radius:10px;padding:16px 20px;">
        &ldquo;${input.commentSnippet}&rdquo;
      </p>
      ${CTA_BUTTON(input.moderationUrl, "Review Comment", accent)}
      ${FALLBACK_LINK(input.moderationUrl, accent)}
    `,
    brand: input.brand,
  });
}

export function buildCommentReplyEmail(input: {
  replierName: string;
  templateName: string;
  commentSnippet: string;
  deepLinkUrl: string;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `${input.replierName} replied on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">New reply on your comment</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.replierName}</strong> replied on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#3F3F3C;line-height:1.6;text-align:left;background:#F4F5F0;border-radius:10px;padding:16px 20px;">
        &ldquo;${input.commentSnippet}&rdquo;
      </p>
      ${CTA_BUTTON(input.deepLinkUrl, "View Reply", accent)}
      ${FALLBACK_LINK(input.deepLinkUrl, accent)}
    `,
    brand: input.brand,
  });
}

/** Gated by NotificationPreferences.formSubmissions (see lib/notificationPreferences.ts) —
 * only sent when the org has that toggle on. `fieldsPreview` is the submission's own field
 * list, already trimmed to a handful of entries by the caller. */
export function buildFormSubmissionEmail(input: {
  siteName: string;
  formName: string;
  fieldsPreview: [string, string][];
  submissionsUrl: string;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const fieldsHtml = input.fieldsPreview
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#76766F;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;padding-right:16px;">${key}</td>
          <td style="padding:6px 0;font-size:14px;color:#3F3F3C;line-height:1.5;">${value}</td>
        </tr>`,
    )
    .join("");
  return emailShell({
    title: `New ${input.formName} submission on ${input.siteName} — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">New form submission</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Someone submitted <strong>${input.formName}</strong> on <strong>${input.siteName}</strong>:
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 28px;background:#F4F5F0;border-radius:10px;padding:16px 20px;text-align:left;">
        ${fieldsHtml}
      </table>
      ${CTA_BUTTON(input.submissionsUrl, "View All Submissions", accent)}
      ${FALLBACK_LINK(input.submissionsUrl, accent)}
    `,
    brand: input.brand,
  });
}

/** Gated by NotificationPreferences.payments. amountFormatted is already currency-formatted
 * by the caller (e.g. "₦12,000.00") — this template has no currency-conversion opinion. */
export function buildPaymentReceivedEmail(input: {
  siteName: string;
  amountFormatted: string;
  customerEmail: string;
  orderNumber: string;
  orderUrl: string;
  brand?: EmailBrand;
}): string {
  const productName = input.brand?.name ?? "Plexo";
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `Payment received on ${input.siteName} — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You've been paid</h1>
      <p style="margin:0 0 8px;font-size:32px;font-weight:800;color:#517A12;letter-spacing:-0.5px;text-align:left;">${input.amountFormatted}</p>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Order <strong>${input.orderNumber}</strong> on <strong>${input.siteName}</strong>, paid by <strong>${input.customerEmail}</strong>.
      </p>
      ${CTA_BUTTON(input.orderUrl, "View Order", accent)}
      ${FALLBACK_LINK(input.orderUrl, accent)}
    `,
    brand: input.brand,
  });
}

// ── Order status emails — the customer-facing receipt/status-update family
// (lib/commerce/orderStatusActions.ts), gated per-event by CommerceSettings'
// notifyCustomerOn* toggles. One builder covers every event since they all share the
// same itemized-order layout; only the headline/message and subject change per event.

export type OrderStatusEvent = "PAID" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "COMPLETED" | "REFUNDED";

const ORDER_STATUS_COPY: Record<OrderStatusEvent, { subject: string; heading: string; message: string }> = {
  PAID: { subject: "Order confirmed", heading: "Order confirmed", message: "Thanks for your order — it's confirmed and being prepared." },
  PROCESSING: { subject: "Order update: processing", heading: "Your order is being processed", message: "We're getting your order ready." },
  READY_FOR_PICKUP: { subject: "Order update: ready for pickup", heading: "Ready for pickup", message: "Your order is ready to be picked up." },
  SHIPPED: { subject: "Order update: shipped", heading: "Your order has shipped", message: "Your order is on its way." },
  COMPLETED: { subject: "Order update: completed", heading: "Order completed", message: "Your order has been completed. Thanks for shopping with us!" },
  REFUNDED: { subject: "Order refunded", heading: "Order refunded", message: "Your order has been refunded." },
};

export function buildOrderStatusEmail(input: {
  event: OrderStatusEvent;
  siteName: string;
  orderNumber: string;
  amountFormatted: string;
  items: { nameSnapshot: string; quantity: number; unitPriceMinor: number }[];
  currency: string;
  orderUrl: string;
  brand?: EmailBrand;
}): { subject: string; html: string } {
  const copy = ORDER_STATUS_COPY[input.event];
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const formatMinor = (minor: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: input.currency }).format((minor || 0) / 100);

  const itemRows = input.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E8E8E4;text-align:left;font-size:13.5px;color:#3F3F3C;">${item.nameSnapshot} &times; ${item.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #E8E8E4;text-align:right;font-size:13.5px;color:#3F3F3C;white-space:nowrap;">${formatMinor(item.unitPriceMinor * item.quantity)}</td>
      </tr>`,
    )
    .join("");

  const itemsTable = input.items.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;text-align:left;">${itemRows}</table>`
    : "";

  const html = emailShell({
    title: `${copy.subject} — ${input.siteName}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">${copy.heading}</h1>
      <p style="margin:0 0 24px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">${copy.message}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#5B5B58;text-align:left;">Order <strong>${input.orderNumber}</strong> from <strong>${input.siteName}</strong></p>
      <p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#121212;text-align:left;">${input.amountFormatted}</p>
      ${itemsTable}
      ${CTA_BUTTON(input.orderUrl, "View Order", accent)}
      ${FALLBACK_LINK(input.orderUrl, accent)}
    `,
    brand: input.brand,
  });

  return { subject: `${copy.subject} — ${input.siteName}`, html };
}

// ── Direct bank transfer (lib/commerce/bankTransfer.ts) — the customer pays the store's
// bank account directly, so nothing is confirmed until the OWNER says the money arrived.
// Every value a customer typed (name, checkout answers) is escaped: unlike the other
// builders here, these interpolate free text from an anonymous storefront visitor.

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function detailRows(rows: [string, string][]): string {
  return rows
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:6px 16px 6px 0;font-size:12px;color:#76766F;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;">${esc(key)}</td>
          <td style="padding:6px 0;font-size:14px;color:#3F3F3C;line-height:1.5;">${esc(value)}</td>
        </tr>`,
    )
    .join("");
}

/** To the site owner: a customer says they've transferred the money — check your bank,
 * then one click confirms (or rejects) it. */
export function buildBankTransferOwnerEmail(input: {
  siteName: string;
  amountFormatted: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  details: [string, string][];
  confirmUrl: string;
  brand?: EmailBrand;
}): { subject: string; html: string } {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const html = emailShell({
    title: `Bank transfer to confirm — ${input.orderNumber}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">A bank transfer payment has been made</h1>
      <p style="margin:0 0 8px;font-size:32px;font-weight:800;color:#121212;letter-spacing:-0.5px;text-align:left;">${esc(input.amountFormatted)}</p>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${esc(input.customerName || input.customerEmail)}</strong> placed order <strong>${esc(input.orderNumber)}</strong> on <strong>${esc(input.siteName)}</strong>
        and says they've sent this amount to your bank account. Check that it has arrived, then confirm it below so the order goes ahead.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 28px;background:#F4F5F0;border-radius:10px;padding:16px 20px;text-align:left;">
        ${detailRows([["Order", input.orderNumber], ["Customer", input.customerEmail], ...input.details])}
      </table>
      ${CTA_BUTTON(input.confirmUrl, "Confirm payment received", accent)}
      <p style="margin:0 0 20px;font-size:13px;color:#5B5B58;line-height:1.5;text-align:left;">
        Nothing arrived? Open the same link and choose "I didn't receive it" — the order is cancelled and its stock released.
      </p>
      ${FALLBACK_LINK(input.confirmUrl, accent)}
    `,
    brand: input.brand,
  });
  return { subject: `Confirm bank transfer: ${input.amountFormatted} for ${input.orderNumber} — ${input.siteName}`, html };
}

/** To the customer: order received, here's exactly where to send the money, and what
 * happens next. */
export function buildBankTransferCustomerEmail(input: {
  siteName: string;
  amountFormatted: string;
  orderNumber: string;
  bankRows: [string, string][];
  instructions: string | null;
  orderUrl: string;
  brand?: EmailBrand;
}): { subject: string; html: string } {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const html = emailShell({
    title: `Order received — ${input.siteName}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Order received</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Thanks! <strong>${esc(input.siteName)}</strong> will confirm order <strong>${esc(input.orderNumber)}</strong> as soon as your bank transfer of
        <strong>${esc(input.amountFormatted)}</strong> arrives. If you haven't sent it yet, use these details and put your order number as the reference:
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;background:#F4F5F0;border-radius:10px;padding:16px 20px;text-align:left;">
        ${detailRows([...input.bankRows, ["Amount", input.amountFormatted], ["Reference", input.orderNumber]])}
      </table>
      ${input.instructions ? `<p style="margin:0 0 24px;font-size:13.5px;color:#3F3F3C;line-height:1.6;text-align:left;">${esc(input.instructions)}</p>` : ""}
      ${CTA_BUTTON(input.orderUrl, "View Order", accent)}
      ${FALLBACK_LINK(input.orderUrl, accent)}
    `,
    brand: input.brand,
  });
  return { subject: `Order received — awaiting your bank transfer — ${input.siteName}`, html };
}

/** To the customer: the owner couldn't find the transfer, so the order was cancelled. */
export function buildBankTransferRejectedEmail(input: {
  siteName: string;
  orderNumber: string;
  amountFormatted: string;
  reason: string | null;
  storeUrl: string;
  brand?: EmailBrand;
}): { subject: string; html: string } {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const html = emailShell({
    title: `Order cancelled — ${input.siteName}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">We couldn't confirm your payment</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${esc(input.siteName)}</strong> didn't receive a bank transfer of <strong>${esc(input.amountFormatted)}</strong> for order
        <strong>${esc(input.orderNumber)}</strong>, so the order has been cancelled.${input.reason ? ` Note from the store: “${esc(input.reason)}”` : ""}
        If you did send the money, reply to the store with your transfer receipt.
      </p>
      ${CTA_BUTTON(input.storeUrl, "Visit the store", accent)}
    `,
    brand: input.brand,
  });
  return { subject: `Order ${input.orderNumber} cancelled — payment not received — ${input.siteName}`, html };
}

// ── Digital product delivery — the first real customer-facing post-payment emails in
// Commerce (every other Commerce email today only ever notifies the site owner). One
// builder per CommerceDigitalDeliveryMethod, all sharing the same CTA_BUTTON/FALLBACK_LINK
// shell as buildPaymentReceivedEmail above.

export function buildDigitalFileDeliveryEmail(input: {
  siteName: string;
  productName: string;
  downloadUrl: string;
  expiresAt?: string | null; // pre-formatted, e.g. "March 12, 2026"
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `Your download: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Your download is ready</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Thanks for your purchase of <strong>${input.productName}</strong> on <strong>${input.siteName}</strong>.
      </p>
      ${CTA_BUTTON(input.downloadUrl, "Download now", accent)}
      ${FALLBACK_LINK(input.downloadUrl, accent)}
      ${
        input.expiresAt
          ? `<p style="margin:20px 0 0;font-size:12px;color:#76766F;line-height:1.5;text-align:left;">This link expires on ${input.expiresAt}.</p>`
          : ""
      }
    `,
    brand: input.brand,
  });
}

export function buildDigitalExternalLinkEmail(input: {
  siteName: string;
  productName: string;
  accessUrl: string; // our own token route, not the raw external URL — see digitalDelivery.ts
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `Your access link: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Here's your access link</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Thanks for your purchase of <strong>${input.productName}</strong> on <strong>${input.siteName}</strong>.
      </p>
      ${CTA_BUTTON(input.accessUrl, "Open link", accent)}
      ${FALLBACK_LINK(input.accessUrl, accent)}
    `,
    brand: input.brand,
  });
}

export function buildDigitalAccessGrantedEmail(input: {
  siteName: string;
  productName: string;
  accessInstructions: string;
  password?: string | null;
  accessUrl: string; // "see it again" page — same content as this email
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: `Your access: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">You're in</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Thanks for your purchase of <strong>${input.productName}</strong> on <strong>${input.siteName}</strong>. Here's how to access it:
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;width:100%;max-width:420px;">
        <tr>
          <td style="padding:18px 20px;background:#F7F8F3;border:1px solid #E8E8E4;border-radius:12px;font-size:14px;color:#3F3F3C;line-height:1.6;white-space:pre-wrap;">${input.accessInstructions}</td>
        </tr>
      </table>
      ${
        input.password
          ? `<p style="margin:0 0 28px;font-size:14px;color:#3F3F3C;text-align:left;">Password: <strong style="font-family:monospace;background:#F4F5F0;padding:2px 8px;border-radius:6px;">${input.password}</strong></p>`
          : ""
      }
      ${CTA_BUTTON(input.accessUrl, "Open your access", accent)}
      ${FALLBACK_LINK(input.accessUrl, accent)}
    `,
    brand: input.brand,
  });
}

// Commerce's own admin-notification emails (Stripe access requests, wallet withdrawals)
// live in lib/email.ts instead, alongside sendScriptAccessRequestNotificationEmail /
// sendWithdrawalRequestNotificationEmail — those go through nodemailer/SMTP to ADMIN_EMAIL,
// a different delivery mechanism from every other builder in this file (which render into
// sendMaildripEmail, for real customers). Keeping the two admin-only senders together with
// their siblings there, rather than splitting the pattern across two files.

/** Sent once app/api/v1/domains/unlock/route.ts successfully unlocks a Plexo-purchased
 * domain and retrieves its EPP auth code — the one-time "here's how to take this domain
 * elsewhere" email the Buy-a-Domain plan's "stop managing" flow promises. transferEligibleAt
 * is only rendered as a caveat when it's still in the future (ICANN forbids a transfer within
 * 60 days of initial registration) — a domain past that window gets no such note. */
export function buildDomainTransferCodeEmail(input: {
  domain: string;
  authCode: string;
  transferEligibleAt?: string | null;
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const eligibleNote =
    input.transferEligibleAt && new Date(input.transferEligibleAt).getTime() > Date.now()
      ? `<p style="margin:0 0 20px;font-size:14px;color:#8A5A00;background:#FFF8E6;border:1px solid #F6D77A;border-radius:10px;padding:14px 16px;line-height:1.6;text-align:left;">
           <strong>Heads up:</strong> registries won't transfer this domain until
           <strong>${new Date(input.transferEligibleAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</strong>
           — that's the earliest allowed date, 60 days after registration or an ownership change. You can still give this code to your new registrar now; the transfer will simply wait until then.
         </p>`
      : "";
  return emailShell({
    title: `Your transfer code for ${input.domain}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">${input.domain} is unlocked</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        We've unlocked <strong>${input.domain}</strong> and generated its authorization (EPP) code — give this to the registrar you're moving to, and they'll handle the rest.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;width:100%;max-width:420px;">
        <tr>
          <td style="padding:18px 20px;background:#F7F8F3;border:1px solid #E8E8E4;border-radius:12px;text-align:left;">
            <span style="font-family:monospace;font-size:18px;font-weight:700;letter-spacing:1px;color:#121212;">${input.authCode}</span>
          </td>
        </tr>
      </table>
      ${eligibleNote}
      <p style="margin:0;font-size:13px;color:#5B5B58;line-height:1.6;text-align:left;">
        Your site keeps working and we'll keep billing and renewing ${input.domain} as normal — nothing changes on our end until the transfer actually completes at your new registrar, which usually takes 5–7 days once you start it there.
      </p>
    `,
    footerHtml: "If you didn't request this, contact support right away — someone with access to your account requested a transfer code.<br/>",
    brand: input.brand,
  });
}

/** Sent by app/api/internal/domain-renewal-billing/route.ts the first time a renewal
 * charge fails, and again if the domain reaches EXPIRED without being fixed —
 * `expired` switches the copy from "please update payment" to "this domain has lapsed". */
export function buildDomainRenewalFailedEmail(input: {
  domain: string;
  renewalPriceFormatted: string;
  graceUntil?: string | null;
  expired?: boolean;
  manageUrl: string;
  brand?: EmailBrand;
}): string {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  return emailShell({
    title: input.expired ? `${input.domain} has expired` : `Renewal payment failed for ${input.domain}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">
        ${input.expired ? "This domain has lapsed" : "We couldn't renew this domain"}
      </h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        ${
          input.expired
            ? `<strong>${input.domain}</strong> reached its expiration date before we could collect the ${input.renewalPriceFormatted} renewal — it's no longer registered to you.`
            : `We tried to charge <strong>${input.renewalPriceFormatted}</strong> to renew <strong>${input.domain}</strong> and it didn't go through. Your site is still live for now.`
        }
      </p>
      ${
        !input.expired && input.graceUntil
          ? `<p style="margin:0 0 20px;font-size:14px;color:#8A5A00;background:#FFF8E6;border:1px solid #F6D77A;border-radius:10px;padding:14px 16px;line-height:1.6;text-align:left;">
               Update your payment method by <strong>${new Date(input.graceUntil).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</strong> to keep this domain — after that it will expire and can't be recovered through Plexo.
             </p>`
          : ""
      }
      ${CTA_BUTTON(input.manageUrl, input.expired ? "View domain settings" : "Update payment method", accent)}
      ${FALLBACK_LINK(input.manageUrl, accent)}
    `,
    brand: input.brand,
  });
}

// ── Donations (lib/commerce/donations.ts) — the donor's thank-you receipt. Donor-typed
// values (their name) and the owner's own thank-you text are escaped like every other
// visitor-supplied string in this file.
export function buildDonationReceiptEmail(input: {
  siteName: string;
  donorName: string | null;
  amountFormatted: string;
  monthly: boolean;
  campaignName: string | null;
  receiptNumber: string;
  dateIso: string;
  thankYouMessage: string | null;
  /** Monthly gifts only — the donor's private link to stop their gift. */
  manageUrl: string | null;
  brand?: EmailBrand;
}): { subject: string; html: string } {
  const accent = input.brand?.color ?? EMAIL_COLORS.brand;
  const greeting = input.donorName ? `Dear ${esc(input.donorName.split(" ")[0])},` : "Thank you,";
  const date = new Date(input.dateIso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const message = input.thankYouMessage
    ? esc(input.thankYouMessage)
    : `Your generosity makes our work possible. Thank you for supporting ${esc(input.siteName)}.`;
  const rows: [string, string][] = [
    ["Amount", `${input.amountFormatted}${input.monthly ? " / month" : ""}`],
    ...(input.campaignName ? ([["For", input.campaignName]] as [string, string][]) : []),
    ["Date", date],
    ["Receipt", input.receiptNumber],
  ];
  const html = emailShell({
    title: `Thank you for your donation — ${input.siteName}`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Thank you for your ${input.monthly ? "monthly " : ""}gift</h1>
      <p style="margin:0 0 6px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">${greeting}</p>
      <p style="margin:0 0 24px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">${message}</p>
      <p style="margin:0 0 24px;font-size:30px;font-weight:800;color:#517A12;letter-spacing:-0.5px;text-align:left;">${esc(input.amountFormatted)}${input.monthly ? '<span style="font-size:15px;color:#5B5B58;font-weight:600"> / month</span>' : ""}</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${detailRows(rows)}</table>
      <p style="margin:0 0 ${input.manageUrl ? "20px" : "0"};font-size:12.5px;color:#76766F;line-height:1.6;text-align:left;">Please keep this email as your donation receipt.</p>
      ${input.manageUrl ? `${CTA_BUTTON(input.manageUrl, "Manage your monthly gift", accent)}${FALLBACK_LINK(input.manageUrl, accent)}` : ""}
    `,
    brand: input.brand,
  });
  return { subject: `Thank you for your ${input.monthly ? "monthly " : ""}donation to ${input.siteName}`, html };
}

/** To the site owner when their WordPress site has finished moving to Plexo (lib/wpMigration/notify.ts). */
export function buildWpMigrationDoneEmail(input: {
  siteName: string;
  pagesCopied: number;
  postsCopied: number;
  productsMoved?: number;
  thingsToCheck: number;
  reportUrl: string;
}): string {
  const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  const moved = [plural(input.pagesCopied, "page"), plural(input.postsCopied, "blog post"), ...(input.productsMoved ? [plural(input.productsMoved, "product")] : [])].join(", ");
  return emailShell({
    title: `${input.siteName} has moved to Plexo`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Your site has moved to Plexo</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        <strong>${input.siteName}</strong> is now on Plexo: ${moved}, with its images, design and SEO.
      </p>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        ${input.thingsToCheck > 0
          ? `Your report lists <strong>${plural(input.thingsToCheck, "thing")}</strong> to look at, then you can preview the site and connect your domain.`
          : "Nothing needs fixing. Preview the site, then connect your domain when you're happy."}
      </p>
      ${CTA_BUTTON(input.reportUrl, "See your site")}
      ${FALLBACK_LINK(input.reportUrl)}
    `,
    footerHtml: "Your WordPress site hasn't been changed — it keeps running until you switch your domain to Plexo.<br/>",
  });
}

/** To the site owner when their migration paused on something that needs them (lib/wpMigration/notify.ts). */
export function buildWpMigrationPausedEmail(input: { siteName: string; reason: string; resumeUrl: string }): string {
  return emailShell({
    title: `Moving ${input.siteName} to Plexo has paused`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">Your move has paused</h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Moving <strong>${input.siteName}</strong> to Plexo stopped partway: ${input.reason}
      </p>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        This is usually temporary — your WordPress host was slow or briefly offline. Press <strong>Try again</strong> and it carries on exactly where it stopped; nothing already moved is lost.
      </p>
      ${CTA_BUTTON(input.resumeUrl, "Continue the move")}
      ${FALLBACK_LINK(input.resumeUrl)}
    `,
  });
}

// ── The 2026 plan change (scripts/billing/migrate-plans.ts) ────────────────────────────

/** "Your plan has a new name — and a new price from your next renewal." Sent once per account by the migration. */
export function buildPlanMoveEmail(input: { oldPlanName: string; newPlan: string; renewsAt: string | null; newPrice: string | null; manageUrl: string }): { subject: string; html: string } {
  const plan = PLAN_NAME(input.newPlan);
  const date = input.renewsAt ? new Date(input.renewsAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;
  const priceLine = input.newPrice && date ? `From your next renewal on ${date}, you'll pay ${input.newPrice} for ${plan}.` : `Your price stays the same until your next renewal.`;
  const html = emailShell({
    title: `Your ${input.oldPlanName} plan is now called ${plan}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">
        Your ${input.oldPlanName} plan is now called ${plan}
      </h1>
      <p style="margin:0 0 12px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        We've refreshed Plexo's plans. Everything you use today keeps working — nothing changes on your sites.
      </p>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">${priceLine} You can change or cancel your plan any time before then.</p>
      ${CTA_BUTTON(input.manageUrl, "See your plan")}
      ${FALLBACK_LINK(input.manageUrl)}
    `,
  });
  return { subject: `Your Plexo plan is now ${plan}`, html };
}

// ── Plan lifecycle (lib/plan/lifecycle.ts) ──────────────────────────────────────────────

// Plan names come from lib/plan/plans.ts — callers pass today's plan ids (ULTRA reads as Pro).
const PLAN_NAME = (plan: string): string => planLabel(plan);

export function buildPlanEndingSoonEmail(input: {
  plan: string;
  endsAt: string;
  kind: "TRIAL" | "GRANT" | "CANCELLING" | "ONE_TIME";
  stage: "WEEK" | "DAY" | "TODAY";
  upgradeUrl: string;
}): { subject: string; html: string } {
  const plan = PLAN_NAME(input.plan);
  const date = new Date(input.endsAt).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });
  const what = input.kind === "TRIAL" ? `Your ${plan} trial` : `Your ${plan} plan`;
  const when = input.stage === "TODAY" ? "ends today" : input.stage === "DAY" ? "ends in 1 day" : "ends in 7 days";
  const headline = `${what} ${when}`;
  const intro =
    input.kind === "CANCELLING"
      ? `You've chosen to cancel, so ${what.toLowerCase()} runs until ${date} and then stops.`
      : input.kind === "ONE_TIME"
        ? `You paid for ${plan} for a set time, so it runs until ${date} and then stops. It doesn't renew by itself.`
        : `${what} runs until ${date} and then stops.`;
  const cta = input.kind === "ONE_TIME" ? "Pay again" : `Keep ${plan}`;
  const html = emailShell({
    title: headline,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">
        ${headline}
      </h1>
      <p style="margin:0 0 12px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">${intro}</p>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Keep everything working exactly as it is by ${input.kind === "ONE_TIME" ? "paying again" : "choosing a plan"} before then. If you don't, your account moves to Free:
        one site stays live with just its homepage, on a Plexo address. Nothing is deleted — upgrading later brings it all back.
      </p>
      ${CTA_BUTTON(input.upgradeUrl, cta)}
      ${FALLBACK_LINK(input.upgradeUrl)}
    `,
  });
  return { subject: `${headline} — Plexo`, html };
}

function planMoney(amountMinor: number | null | undefined, currency: string | null | undefined): string | null {
  if (typeof amountMinor !== "number" || !currency) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amountMinor / 100);
  } catch {
    return null;
  }
}

const utcDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });

/** A week before a subscription renews: when, how much, and a chance to make sure the card can cover it. */
export function buildPlanRenewalSoonEmail(input: {
  plan: string;
  renewsAt: string;
  amountMinor?: number | null;
  currency?: string | null;
  /** Set when this renewal is the first at a new price: what they paid before. */
  previousAmountMinor?: number | null;
  manageUrl: string;
}): { subject: string; html: string } {
  const plan = PLAN_NAME(input.plan);
  const date = utcDate(input.renewsAt);
  const amount = planMoney(input.amountMinor, input.currency);
  const before = input.previousAmountMinor ? planMoney(input.previousAmountMinor, input.currency) : null;
  const headline = `Your ${plan} plan renews on ${date}`;
  const html = emailShell({
    title: headline,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">${headline}</h1>
      <p style="margin:0 0 12px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Your monthly ${plan} subscription renews on <strong>${date}</strong>${amount ? ` and we'll charge <strong>${amount}</strong> to your card on file` : ""}. There's nothing you need to do if your card is ready.
      </p>
      ${before && amount ? `<p style="margin:0 0 12px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">Heads-up: this is a new price. Your ${plan} plan was ${before}; from this renewal it is <strong>${amount}</strong>. You're never charged the new price before this date.</p>` : ""}
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        If your card has changed, expired or may be short on funds, update it now so your sites stay fully live. If a payment can't be taken,
        your account moves to Free — one site stays live with just its homepage — until it's paid. Nothing is ever deleted.
      </p>
      ${CTA_BUTTON(input.manageUrl, "Check my card")}
      ${FALLBACK_LINK(input.manageUrl)}
    `,
  });
  return { subject: `${headline} — Plexo`, html };
}

/** A renewal charge was declined: say so plainly, what still works, what happens if it isn't fixed, and how to fix it. */
export function buildPaymentDeclinedEmail(input: {
  plan: string;
  amountMinor?: number | null;
  currency?: string | null;
  retryAt?: string | null;
  manageUrl: string;
}): { subject: string; html: string } {
  const plan = PLAN_NAME(input.plan);
  const amount = planMoney(input.amountMinor, input.currency);
  const retry = input.retryAt ? utcDate(input.retryAt) : null;
  const headline = "Your payment didn't go through";
  const html = emailShell({
    title: headline,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">${headline}</h1>
      <p style="margin:0 0 12px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Your card was declined when we tried to renew your ${plan} plan${amount ? ` (${amount})` : ""}.
        Your plan and sites are still fully active for now${retry ? ` — we'll try again on <strong>${retry}</strong>` : " while we try again"}.
      </p>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        If it still can't be taken, your account moves to Free and your site becomes partially inactive: one site stays live with just its homepage,
        and your other pages, sites and custom domain go offline. Nothing is deleted — renew and everything comes straight back.
        Updating your card now keeps full access.
      </p>
      ${CTA_BUTTON(input.manageUrl, "Update my card")}
      ${FALLBACK_LINK(input.manageUrl)}
    `,
  });
  return { subject: `${headline} — update your card to keep ${plan}`, html };
}

export function buildPlanEndedEmail(input: {
  previousPlan: string;
  reason: "PAYMENT_ENDED" | "TRIAL_ENDED" | "GRANT_ENDED" | "NO_PAYMENT" | "ADMIN";
  liveSiteName: string | null;
  liveAddress: string | null;
  offlineSiteCount: number;
  archivedPageCount: number;
  customDomainCount: number;
  upgradeUrl: string;
}): string {
  const plan = PLAN_NAME(input.previousPlan);
  const why =
    input.reason === "TRIAL_ENDED" ? `Your ${plan} trial has ended`
      : input.reason === "PAYMENT_ENDED" ? `Your ${plan} subscription has ended`
        : `Your ${plan} access has ended`;
  const changes: string[] = [];
  if (input.liveSiteName) {
    changes.push(`<strong>${esc(input.liveSiteName)}</strong> is still live${input.liveAddress ? ` at <strong>${esc(input.liveAddress)}</strong>` : ""}, showing its homepage.`);
  }
  if (input.archivedPageCount > 0) changes.push(`${input.archivedPageCount} other page${input.archivedPageCount === 1 ? " is" : "s are"} saved but not published.`);
  if (input.offlineSiteCount > 0) changes.push(`${input.offlineSiteCount} other site${input.offlineSiteCount === 1 ? " is" : "s are"} offline.`);
  if (input.customDomainCount > 0) changes.push(`Your custom domain${input.customDomainCount === 1 ? " is" : "s are"} paused.`);
  const list = changes.length
    ? `<ul style="margin:0 0 20px;padding:0 0 0 20px;font-size:14px;color:#3F3F3C;line-height:1.7;text-align:left;">${changes.map((c) => `<li>${c}</li>`).join("")}</ul>`
    : "";
  return emailShell({
    title: `${why} — you're now on Free`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">
        ${why}
      </h1>
      <p style="margin:0 0 20px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Your account is now on Free. Nothing has been deleted.
      </p>
      ${list}
      <p style="margin:0 0 24px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Upgrade any time and everything comes straight back — every page, every site and your custom domain${input.customDomainCount === 1 ? "" : "s"}.
      </p>
      ${CTA_BUTTON(input.upgradeUrl, "Bring everything back")}
      ${FALLBACK_LINK(input.upgradeUrl)}
    `,
  });
}

// ── Payment receipts (lib/billing/payments.ts) ──────────────────────────────────────────

const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

export function buildPaymentReceiptEmail(input: {
  receiptNumber: string;
  name: string | null;
  description: string;
  detail: string | null;
  amountCents: number;
  refundedCents: number;
  currency: string;
  paidAt: string;
  card: { brand: string; last4: string } | null;
  downloadUrl: string;
  historyUrl: string;
}): string {
  const date = new Date(input.paidAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;font-size:13px;color:#5B5B58;text-align:left;">${label}</td>
      <td style="padding:6px 0;font-size:13px;color:#121212;text-align:right;font-weight:600;">${value}</td>
    </tr>`;
  return emailShell({
    title: `Your Plexo receipt ${input.receiptNumber}`,
    bodyHtml: `
      <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#121212;letter-spacing:-0.6px;line-height:1.2;text-align:left;">
        Thanks${input.name ? `, ${esc(input.name.split(" ")[0])}` : ""} — payment received
      </h1>
      <p style="margin:0 0 24px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        Here's your receipt for ${esc(money(input.amountCents, input.currency))}. Keep it for your records — you can download it again any time from your account.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #E8E8E4;border-bottom:1px solid #E8E8E4;">
        ${row("Receipt", esc(input.receiptNumber))}
        ${row("Date", esc(date))}
        ${row("For", esc(input.description) + (input.detail ? `<br /><span style="font-weight:400;color:#5B5B58;">${esc(input.detail)}</span>` : ""))}
        ${input.card ? row("Paid with", `${esc(CARD_BRANDS[input.card.brand] ?? input.card.brand)} •••• ${esc(input.card.last4)}`) : ""}
        ${input.refundedCents > 0 ? row("Refunded", `−${esc(money(input.refundedCents, input.currency))}`) : ""}
        ${row("Total paid", esc(money(input.amountCents - input.refundedCents, input.currency)))}
      </table>
      ${CTA_BUTTON(input.downloadUrl, "Download receipt (PDF)")}
      <p style="margin:0;font-size:12px;color:#5B5B58;line-height:1.5;text-align:left;">
        All your receipts live under <a href="${input.historyUrl}" style="color:${EMAIL_COLORS.brandDeep};text-decoration:none;">Settings → Subscription</a>.
      </p>
    `,
  });
}

// ── Product announcements ───────────────────────────────────────────────────────────────

/** "Plexo has a new look" — sent once to existing users by scripts/send-redesign-announcement.ts. One job:
 * get them into the 1-minute setup at /welcome/setup, which personalises the new dashboard. */
export function buildRedesignAnnouncementEmail(input: { name?: string | null; setupUrl: string; unsubscribeUrl?: string }): { subject: string; preheader: string; html: string } {
  const first = input.name?.trim().split(/\s+/)[0];
  const subject = "Plexo has a new look — personalise your experience";
  const preheader = "A simpler dashboard, guided setup and light or dark mode. Take 1 minute to make it yours.";
  const item = (title: string, text: string) => `
    <tr>
      <td width="28" valign="top" style="padding:0 0 18px;"><div style="width:10px;height:10px;margin-top:7px;border-radius:50%;background:${EMAIL_COLORS.brand};border:2px solid ${EMAIL_COLORS.brandDeep};"></div></td>
      <td valign="top" style="padding:0 0 18px;font-size:15px;line-height:1.6;color:#3F3F3C;text-align:left;"><strong style="color:#121212;">${title}</strong><br/>${text}</td>
    </tr>`;
  const html = emailShell({
    title: subject,
    preheader,
    unsubscribeUrl: input.unsubscribeUrl,
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:13px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#517A12;text-align:left;">What's new</p>
      <h1 style="margin:0 0 16px;font-size:30px;font-weight:800;color:#121212;letter-spacing:-0.7px;line-height:1.2;text-align:left;">Plexo has a fresh new look${first ? `, ${esc(first)}` : ""}</h1>
      <p style="margin:0 0 28px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">
        We rebuilt Plexo to be simpler to use. Everything you made is exactly where you left it &mdash; it just feels lighter and easier to find your way around.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
        ${item("A simpler dashboard", "Only what you need, in plain words. More shows up as you grow.")}
        ${item("Guided setup", "Tell us what you're making and we'll set the basics up for you.")}
        ${item("Friendly tours", "Short walkthroughs show you around each part the first time.")}
        ${item("Light or dark", "Pick a look you like, or let Plexo follow your device.")}
      </table>
      <p style="margin:0 0 8px;font-size:16px;color:#3F3F3C;line-height:1.65;text-align:left;">It takes about a minute, and you can skip any step.</p>
      ${CTA_BUTTON(input.setupUrl, "Take 1 minute to personalise")}
      ${FALLBACK_LINK(input.setupUrl)}
    `,
  });
  return { subject, preheader, html };
}
