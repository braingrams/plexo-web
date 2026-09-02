import { emailShell, type EmailBrand } from "./maildrip";

export const CTA_BUTTON = (href: string, label: string, color = "#8b5cf6", colorDeep = "#7c3aed") => `
  <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 32px auto;">
    <tr>
      <td style="border-radius:10px;background:linear-gradient(135deg,${color},${colorDeep});text-align:center;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
          ${label} &rarr;
        </a>
      </td>
    </tr>
  </table>`;

const FALLBACK_LINK = (href: string, color = "#8b5cf6") => `
  <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
    If the button doesn't work, copy and paste this link into your browser:
  </p>
  <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;text-align:center;">
    <a href="${href}" style="color:${color};text-decoration:none;">${href}</a>
  </p>`;

export function buildVerificationEmail(actionUrl: string): string {
  return emailShell({
    title: "Verify your Plexo account",
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Verify your email address</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        Welcome to Plexo — the visual email &amp; template builder. Before your first login, please confirm your email address so we can secure your workspace.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;text-align:center;">
        Click the button below to verify your account. This link is valid for <strong style="color:#8b5cf6;">60 minutes</strong>.
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
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Reset your password</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;text-align:center;">
        We received a request to reset the password for your Plexo account. If this was you, click the button below to set a new password.
      </p>
      <p style="margin:0 0 12px;font-size:14px;color:#f87171;font-weight:600;line-height:1.6;text-align:center;">
        &#9888;&#65039; If you did not request this, please ignore this email.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;text-align:center;">
        This link expires in <strong style="color:#8b5cf6;">15 minutes</strong>.
      </p>
      ${CTA_BUTTON(actionUrl, "Reset Password")}
      ${FALLBACK_LINK(actionUrl)}
    `,
    footerHtml: "If you didn't request a password reset, no action is needed — your account remains secure.<br/>",
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `Join ${input.orgName} on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You've been invited to collaborate</h1>
      <p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.inviterName}</strong> invited you to join <strong>${input.orgName}</strong> on ${productName} as a
      </p>
      <p style="margin:0 0 28px;text-align:center;">
        <span style="display:inline-block;background:#ede9fe;color:#7c3aed;font-size:13px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.2px;">${roleLabel}</span>
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `${input.senderName} wants to transfer "${input.siteName}" to you on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You've been offered a site</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.senderName}</strong> wants to transfer full ownership of <strong>${input.siteName}</strong> to your ${productName} account — every page, and any Commerce catalog/orders it has.
      </p>
      ${input.warningCount > 0
        ? `<p style="margin:0 0 28px;text-align:center;">
             <span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.2px;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `${input.mentionerName} mentioned you on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You were mentioned in a comment</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.mentionerName}</strong> mentioned you on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#334155;line-height:1.6;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px 20px;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `New comment on "${input.postTitle}" — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">New comment awaiting review</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.commenterName}</strong> commented on <strong>${input.postTitle}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#334155;line-height:1.6;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px 20px;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `${input.replierName} replied on ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">New reply on your comment</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.replierName}</strong> replied on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#334155;line-height:1.6;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px 20px;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  const fieldsHtml = input.fieldsPreview
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;white-space:nowrap;padding-right:16px;">${key}</td>
          <td style="padding:6px 0;font-size:14px;color:#334155;line-height:1.5;">${value}</td>
        </tr>`,
    )
    .join("");
  return emailShell({
    title: `New ${input.formName} submission on ${input.siteName} — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">New form submission</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        Someone submitted <strong>${input.formName}</strong> on <strong>${input.siteName}</strong>:
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 28px;background:#f1f5f9;border-radius:10px;padding:16px 20px;text-align:left;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `Payment received on ${input.siteName} — ${productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You've been paid</h1>
      <p style="margin:0 0 8px;font-size:32px;font-weight:800;color:#16a34a;letter-spacing:-0.5px;text-align:center;">${input.amountFormatted}</p>
      <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        Order <strong>${input.orderNumber}</strong> on <strong>${input.siteName}</strong>, paid by <strong>${input.customerEmail}</strong>.
      </p>
      ${CTA_BUTTON(input.orderUrl, "View Order", accent)}
      ${FALLBACK_LINK(input.orderUrl, accent)}
    `,
    brand: input.brand,
  });
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `Your download: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Your download is ready</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        Thanks for your purchase of <strong>${input.productName}</strong> on <strong>${input.siteName}</strong>.
      </p>
      ${CTA_BUTTON(input.downloadUrl, "Download now", accent)}
      ${FALLBACK_LINK(input.downloadUrl, accent)}
      ${
        input.expiresAt
          ? `<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;text-align:center;">This link expires on ${input.expiresAt}.</p>`
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `Your access link: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">Here's your access link</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
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
  const accent = input.brand?.color ?? "#8b5cf6";
  return emailShell({
    title: `Your access: ${input.productName}`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You're in</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        Thanks for your purchase of <strong>${input.productName}</strong> on <strong>${input.siteName}</strong>. Here's how to access it:
      </p>
      <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;width:100%;max-width:420px;">
        <tr>
          <td style="padding:18px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;">${input.accessInstructions}</td>
        </tr>
      </table>
      ${
        input.password
          ? `<p style="margin:0 0 28px;font-size:14px;color:#334155;text-align:center;">Password: <strong style="font-family:monospace;background:#f1f5f9;padding:2px 8px;border-radius:6px;">${input.password}</strong></p>`
          : ""
      }
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
