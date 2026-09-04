import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveBlogSite } from "@/lib/pub/resolveSiteDynamo";
import { getPublishedPostBySlug } from "@/lib/blog/queriesDynamo";
import { BlogComment, Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { sanitizeCommentBody, countLinksInCommentBody } from "@/lib/blog/sanitizeComment";
import { hashRequestIp } from "@/server/ipHash";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildNewBlogCommentEmail } from "@/lib/mail/templates";
import { resolveNotificationRecipient } from "@/lib/notificationPreferencesDynamo";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { isValidUuid } from "@/server/slugDynamo";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_HOUR = 5;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CommentBody = {
  domain?: string;
  slug?: string;
  name?: string;
  email?: string;
  body?: string;
  parentId?: string;
  // Honeypot — a real visitor never fills this in (hidden via CSS on the form).
  website?: string;
};

/**
 * Public, no-login comment submission. The most adversarial input surface in this app
 * (fully anonymous, unlike post content which always comes from the site owner or the
 * WordPress importer) — see prisma/schema.prisma's BlogComment comment. Every comment
 * starts PENDING (or auto-SPAM) and is never publicly visible until the site owner
 * approves it.
 *
 * DynamoDB-stack port of the Prisma original — see that file's own comment for behavior.
 * Rate-limiting by ipHash used a cross-site prisma.blogComment.count(); BlogComment has no
 * ipHash index in DynamoDB (deliberately — see contentEntities.ts's own comment: "that's
 * exactly what plexo-ops's RateLimit table already exists for"), so this reuses the same
 * shared RateLimit-backed limiter Commerce's public endpoints use instead of a new copy.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as CommentBody;

  // Honeypot: pretend success so a bot filling every field doesn't learn anything.
  if (body.website) {
    return NextResponse.json({ ok: true, status: "PENDING" });
  }

  const domain = body.domain?.trim();
  const slug = body.slug?.trim();
  const name = body.name?.trim().slice(0, MAX_NAME_LENGTH);
  const email = body.email?.trim().slice(0, MAX_EMAIL_LENGTH);
  const rawBody = body.body?.trim();

  if (!domain || !slug) {
    return NextResponse.json({ error: "Missing post reference." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!rawBody || rawBody.length < 2) {
    return NextResponse.json({ error: "Comment can't be empty." }, { status: 400 });
  }
  if (body.parentId && !isValidUuid(body.parentId)) {
    return NextResponse.json({ error: "Invalid comment reference." }, { status: 400 });
  }

  const site = await resolveBlogSite(domain);
  if (site.status !== "ok") {
    return NextResponse.json({ error: "Comments aren't available here." }, { status: 404 });
  }
  if (!site.blogSite.commentsEnabled) {
    return NextResponse.json({ error: "Comments are disabled for this blog." }, { status: 403 });
  }

  const post = await getPublishedPostBySlug(site.published.template.id, slug);
  if (!post) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  if (!post.commentsEnabled) {
    return NextResponse.json({ error: "Comments are disabled on this post." }, { status: 403 });
  }

  if (body.parentId) {
    const { data: postComments } = await BlogComment.query.primary({ postId: post.id }).go();
    const parent = postComments.find((c) => c.id === body.parentId);
    if (!parent) {
      return NextResponse.json({ error: "The comment you're replying to no longer exists." }, { status: 400 });
    }
  }

  const ipHash = hashRequestIp(request);
  const allowed = await checkCommerceRateLimit(`blog-comment:${ipHash}`, RATE_LIMIT_MAX_PER_HOUR, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return NextResponse.json({ error: "You're commenting too fast — try again later." }, { status: 429 });
  }

  const status: "PENDING" | "SPAM" = countLinksInCommentBody(rawBody) >= 2 ? "SPAM" : "PENDING";

  const id = randomUUID();
  await BlogComment.create({
    id,
    postId: post.id,
    parentId: body.parentId || undefined,
    authorName: name,
    authorEmail: email,
    body: sanitizeCommentBody(rawBody),
    status,
    ipHash,
  }).go();

  if (status === "PENDING") {
    void notifySiteOwner(site.published.template.id, post.title, name, rawBody).catch((err) =>
      console.error("[mail] blog comment notification failed:", err),
    );
  }

  return NextResponse.json({ ok: true, status });
}

async function notifySiteOwner(templateId: string, postTitle: string, commenterName: string, rawBody: string): Promise<void> {
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template) return;

  const { data: owner } = await User.get({ id: template.userId }).go();
  const to = await resolveNotificationRecipient(template.organizationId, "blogComments", owner?.email);
  if (!to) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const html = buildNewBlogCommentEmail({
    commenterName,
    postTitle,
    commentSnippet: rawBody.length > 160 ? `${rawBody.slice(0, 160)}…` : rawBody,
    moderationUrl: `${base}/dashboard/templates/${templateId}/blog/comments`,
  });
  const subject = `New comment on "${postTitle}"`;
  try {
    await sendMaildripEmail({ to, subject, html });
    logEmailDelivery({
      kind: "maildrip", to, subject, status: "sent",
      context: "blog_comment_notification", organizationId: template.organizationId, templateId,
    });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to, subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "blog_comment_notification", organizationId: template.organizationId, templateId,
    });
    throw err;
  }
}
