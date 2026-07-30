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
