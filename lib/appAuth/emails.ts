import { emailShell, sendMaildripEmail } from "@/lib/mail/maildrip";
import { CTA_BUTTON } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import type { AppContext } from "@/lib/appRuntime/context";

// Sign-in emails sent on behalf of an app built on Plexo — branded with the APP's name
// (it's the app's visitor receiving them, who may never have heard of Plexo).

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(ctx: AppContext, title: string, heading: string, text: string, url: string, button: string, footer: string): string {
  const name = escape(ctx.settings.emailFromName || ctx.appName);
  return emailShell({
    title,
    brand: { name },
    bodyHtml: `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">${heading}</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;text-align:center;">${text}</p>
      ${CTA_BUTTON(url, button)}
      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6;text-align:center;word-break:break-all;">Or paste this link into your browser:<br/>${escape(url)}</p>
    `,
    footerHtml: `${footer}<br/>`,
  });
}

async function send(ctx: AppContext, to: string, subject: string, html: string): Promise<void> {
  try {
    await sendMaildripEmail({ to, subject, html });
    logEmailDelivery({ kind: "maildrip", to, subject, status: "sent", context: "app_auth", organizationId: ctx.organizationId, templateId: ctx.templateId });
  } catch (err) {
    // Never tell a visitor "we couldn't email you" in a way that reveals whether the
    // account exists; the owner sees the failure in the email log instead.
    logEmailDelivery({
      kind: "maildrip",
      to,
      subject,
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "app_auth",
      organizationId: ctx.organizationId,
      templateId: ctx.templateId,
    });
    throw err;
  }
}

export function sendMagicLinkEmail(ctx: AppContext, to: string, url: string) {
  const app = escape(ctx.appName);
  return send(ctx, to, `Your sign-in link for ${ctx.appName}`, shell(ctx, `Sign in to ${app}`, "Your sign-in link", `Click below to sign in to <strong style="color:#0f172a;">${app}</strong>. The link works once and expires in 30 minutes.`, url, "Sign in", "If you didn't ask for this, you can ignore this email."));
}

export function sendVerifyEmail(ctx: AppContext, to: string, url: string) {
  const app = escape(ctx.appName);
  return send(ctx, to, `Confirm your email for ${ctx.appName}`, shell(ctx, `Confirm your email`, "Confirm your email", `Thanks for signing up to <strong style="color:#0f172a;">${app}</strong>. Confirm it's you to finish creating your account.`, url, "Confirm email", "If you didn't sign up, you can ignore this email."));
}

export function sendResetEmail(ctx: AppContext, to: string, url: string) {
  const app = escape(ctx.appName);
  return send(ctx, to, `Reset your ${ctx.appName} password`, shell(ctx, `Reset your password`, "Reset your password", `Someone asked to reset the password for your <strong style="color:#0f172a;">${app}</strong> account. The link expires in an hour.`, url, "Choose a new password", "If you didn't ask for this, your password hasn't changed and you can ignore this email."));
}

export function sendInviteEmail(ctx: AppContext, to: string, url: string) {
  const app = escape(ctx.appName);
  return send(ctx, to, `You're invited to ${ctx.appName}`, shell(ctx, `You're invited`, "You're invited", `You've been invited to <strong style="color:#0f172a;">${app}</strong>. Click below to accept and sign in.`, url, "Accept invitation", "If you weren't expecting this, you can ignore this email."));
}
