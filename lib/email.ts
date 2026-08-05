import nodemailer from "nodemailer";
import { createHmac } from "node:crypto";

const MODERATION_SECRET = process.env.MODERATION_SECRET || process.env.AI_KEY_ENCRYPTION_SECRET || "plexo_testimonial_moderation_secret_key";

/**
 * Generates a HMAC-SHA256 token for 1-click email moderation link security.
 */
export function generateModerationToken(id: string, action: "approve" | "reject"): string {
  return createHmac("sha256", MODERATION_SECRET)
    .update(`${id}:${action}`)
    .digest("hex");
}

/**
 * Validates a moderation token against testimonial id and action.
 */
export function verifyModerationToken(id: string, action: "approve" | "reject", token: string): boolean {
  const expected = generateModerationToken(id, action);
  return expected === token;
}

export type SendTestimonialEmailParams = {
  id: string;
  name: string;
  role: string;
  company?: string | null;
  quote: string;
  rating: number;
  avatarUrl?: string | null;
};

/**
 * Sends a notification email to ADMIN_EMAIL with 1-click Approval & Rejection links.
 */
export async function sendTestimonialNotificationEmail(testimonial: SendTestimonialEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const approveToken = generateModerationToken(testimonial.id, "approve");
  const rejectToken = generateModerationToken(testimonial.id, "reject");

  const approveUrl = `${baseUrl}/api/testimonials/moderate?id=${testimonial.id}&action=approve&token=${approveToken}`;
  const rejectUrl = `${baseUrl}/api/testimonials/moderate?id=${testimonial.id}&action=reject&token=${rejectToken}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0f19; color: #ffffff; padding: 30px; margin: 0; }
          .card { max-width: 600px; margin: 0 auto; background-color: #121724; border: 1px solid #2d3748; border-radius: 20px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .badge { display: inline-block; background-color: #6b3bf9; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
          h2 { font-size: 24px; font-weight: 800; margin-top: 0; color: #ffffff; }
          .quote-box { background-color: #090d16; border-left: 4px solid #6b3bf9; padding: 20px; border-radius: 12px; margin: 20px 0; font-style: italic; color: #e2e8f0; line-height: 1.6; }
          .details { margin-bottom: 24px; color: #a0aec0; font-size: 14px; line-height: 1.8; }
          .details strong { color: #ffffff; }
          .btn-container { display: flex; gap: 16px; margin-top: 28px; }
          .btn-approve { display: inline-block; background-color: #10b981; color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 14px; text-align: center; }
          .btn-reject { display: inline-block; background-color: #ef4444; color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 14px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">New Testimonial Submitted</span>
          <h2>A new review requires your approval</h2>
          
          <div class="quote-box">
            &ldquo;${testimonial.quote}&rdquo;
          </div>

          <div class="details">
            <p><strong>Author:</strong> ${testimonial.name}</p>
            <p><strong>Role &amp; Company:</strong> ${testimonial.role}${testimonial.company ? ` at ${testimonial.company}` : ''}</p>
            <p><strong>Rating:</strong> ${'★'.repeat(testimonial.rating)} (${testimonial.rating}/5)</p>
            ${testimonial.avatarUrl ? `<p><strong>Avatar URL:</strong> <a href="${testimonial.avatarUrl}" style="color: #818cf8">${testimonial.avatarUrl}</a></p>` : ''}
          </div>

          <div class="btn-container">
            <a href="${approveUrl}" class="btn-approve">✔ Approve &amp; Publish Instantly</a>
            <a href="${rejectUrl}" class="btn-reject">✖ Reject Testimonial</a>
          </div>
        </div>
      </body>
    </html>
  `;

  // Use SMTP transporter if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Plexo Notifications" <noreply@plexopages.com>`,
      to: adminEmail,
      subject: `[Plexo Review] New Testimonial from ${testimonial.name}`,
      html: htmlContent,
    });
  } else {
    console.log("--------------------------------------------------");
    console.log(`[TESTIMONIAL EMAIL NOTIFICATION LOG]`);
    console.log(`To: ${adminEmail}`);
    console.log(`Approve Link: ${approveUrl}`);
    console.log(`Reject Link: ${rejectUrl}`);
    console.log("--------------------------------------------------");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type SendFeedbackEmailParams = {
  userName: string;
  userEmail: string;
  message: string;
  pageUrl?: string | null;
};

/**
 * Notifies ADMIN_EMAIL that new product feedback was submitted. No 1-click links — there's
 * no action to take from the email, just a heads-up; triage happens in plexo-admin's
 * Feedback queue.
 */
export async function sendFeedbackNotificationEmail(feedback: SendFeedbackEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0f19; color: #ffffff; padding: 30px; margin: 0; }
          .card { max-width: 600px; margin: 0 auto; background-color: #121724; border: 1px solid #2d3748; border-radius: 20px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .badge { display: inline-block; background-color: #6b3bf9; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
          h2 { font-size: 24px; font-weight: 800; margin-top: 0; color: #ffffff; }
          .quote-box { background-color: #090d16; border-left: 4px solid #6b3bf9; padding: 20px; border-radius: 12px; margin: 20px 0; color: #e2e8f0; line-height: 1.6; white-space: pre-wrap; }
          .details { margin-bottom: 8px; color: #a0aec0; font-size: 14px; line-height: 1.8; }
          .details strong { color: #ffffff; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">New Feedback</span>
          <h2>A user submitted feedback</h2>

          <div class="details">
            <p><strong>From:</strong> ${escapeHtml(feedback.userName)} (${escapeHtml(feedback.userEmail)})</p>
            ${feedback.pageUrl ? `<p><strong>Page:</strong> ${escapeHtml(feedback.pageUrl)}</p>` : ""}
          </div>

          <div class="quote-box">${escapeHtml(feedback.message)}</div>
        </div>
      </body>
    </html>
  `;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Plexo Notifications" <noreply@plexopages.com>`,
      to: adminEmail,
      subject: `[Plexo Feedback] New feedback from ${feedback.userName}`,
      html: htmlContent,
    });
  } else {
    console.log("--------------------------------------------------");
    console.log(`[FEEDBACK EMAIL NOTIFICATION LOG]`);
    console.log(`To: ${adminEmail}`);
    console.log(`From: ${feedback.userName} (${feedback.userEmail})`);
    console.log(`Message: ${feedback.message}`);
    console.log("--------------------------------------------------");
  }
}

export type SendWithdrawalRequestEmailParams = {
  id: string;
  userEmail: string;
  userName: string;
  amountCents: number;
  bankName: string;
};

/**
 * Notifies ADMIN_EMAIL that a new withdrawal request needs review. Unlike
 * sendTestimonialNotificationEmail, there's no 1-click approve/reject link — processing a
 * payout requires typing a reason on rejection, so it has to go through plexo-admin's own
 * review UI, not a single GET request.
 */
export async function sendWithdrawalRequestNotificationEmail(withdrawal: SendWithdrawalRequestEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const adminAppUrl = process.env.ADMIN_APP_URL || "http://localhost:3001";
  const reviewUrl = `${adminAppUrl}/withdrawals`;
  const amount = (withdrawal.amountCents / 100).toFixed(2);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0f19; color: #ffffff; padding: 30px; margin: 0; }
          .card { max-width: 600px; margin: 0 auto; background-color: #121724; border: 1px solid #2d3748; border-radius: 20px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
          .badge { display: inline-block; background-color: #6b3bf9; color: #ffffff; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
          h2 { font-size: 24px; font-weight: 800; margin-top: 0; color: #ffffff; }
          .details { margin-bottom: 24px; color: #a0aec0; font-size: 14px; line-height: 1.8; }
          .details strong { color: #ffffff; }
          .btn-review { display: inline-block; background-color: #6b3bf9; color: #ffffff !important; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 14px; text-align: center; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <span class="badge">New Withdrawal Request</span>
          <h2>A seller has requested a payout</h2>

          <div class="details">
            <p><strong>Requested by:</strong> ${withdrawal.userName} (${withdrawal.userEmail})</p>
            <p><strong>Amount:</strong> $${amount}</p>
            <p><strong>Bank:</strong> ${withdrawal.bankName}</p>
          </div>

          <a href="${reviewUrl}" class="btn-review">Review in Admin →</a>
        </div>
      </body>
    </html>
  `;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Plexo Notifications" <noreply@plexopages.com>`,
      to: adminEmail,
      subject: `[Plexo Payout] Withdrawal requested by ${withdrawal.userName}`,
      html: htmlContent,
    });
  } else {
    console.log("--------------------------------------------------");
    console.log(`[WITHDRAWAL REQUEST EMAIL NOTIFICATION LOG]`);
    console.log(`To: ${adminEmail}`);
    console.log(`Requested by: ${withdrawal.userName} (${withdrawal.userEmail})`);
    console.log(`Amount: $${amount}`);
    console.log(`Review: ${reviewUrl}`);
    console.log("--------------------------------------------------");
  }
}
