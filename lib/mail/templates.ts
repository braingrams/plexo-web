import { emailShell } from "./maildrip";

const CTA_BUTTON = (href: string, label: string) => `
  <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 32px auto;">
    <tr>
      <td style="border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);text-align:center;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
          ${label} &rarr;
        </a>
      </td>
    </tr>
  </table>`;

const FALLBACK_LINK = (href: string) => `
  <p style="margin:0 0 8px;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
    If the button doesn't work, copy and paste this link into your browser:
  </p>
  <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;line-height:1.4;text-align:center;">
    <a href="${href}" style="color:#8b5cf6;text-decoration:none;">${href}</a>
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
}): string {
  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  return emailShell({
    title: `Join ${input.orgName} on Plexo`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You've been invited to collaborate</h1>
      <p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.inviterName}</strong> invited you to join <strong>${input.orgName}</strong> on Plexo as a
      </p>
      <p style="margin:0 0 28px;text-align:center;">
        <span style="display:inline-block;background:#ede9fe;color:#7c3aed;font-size:13px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.2px;">${roleLabel}</span>
      </p>
      ${CTA_BUTTON(input.acceptUrl, "Accept Invitation")}
      ${FALLBACK_LINK(input.acceptUrl)}
    `,
    footerHtml: "If you weren't expecting this invitation, you can safely ignore this email.<br/>",
  });
}

export function buildMentionEmail(input: {
  mentionerName: string;
  templateName: string;
  commentSnippet: string;
  deepLinkUrl: string;
}): string {
  return emailShell({
    title: `${input.mentionerName} mentioned you on Plexo`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">You were mentioned in a comment</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.mentionerName}</strong> mentioned you on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#334155;line-height:1.6;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px 20px;">
        &ldquo;${input.commentSnippet}&rdquo;
      </p>
      ${CTA_BUTTON(input.deepLinkUrl, "View Comment")}
      ${FALLBACK_LINK(input.deepLinkUrl)}
    `,
  });
}

export function buildCommentReplyEmail(input: {
  replierName: string;
  templateName: string;
  commentSnippet: string;
  deepLinkUrl: string;
}): string {
  return emailShell({
    title: `${input.replierName} replied on Plexo`,
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">New reply on your comment</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">
        <strong>${input.replierName}</strong> replied on <strong>${input.templateName}</strong>:
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#334155;line-height:1.6;text-align:center;background:#f1f5f9;border-radius:10px;padding:16px 20px;">
        &ldquo;${input.commentSnippet}&rdquo;
      </p>
      ${CTA_BUTTON(input.deepLinkUrl, "View Reply")}
      ${FALLBACK_LINK(input.deepLinkUrl)}
    `,
  });
}
