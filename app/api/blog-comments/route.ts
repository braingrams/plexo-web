import { NextRequest, NextResponse } from "next/server";
import { BlogCommentStatus } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { sanitizeCommentBody, countLinksInCommentBody } from "@/lib/blog/sanitizeComment";
import { hashRequestIp } from "@/server/ipHash";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildNewBlogCommentEmail } from "@/lib/mail/templates";
import { isValidUuid } from "@/server/slug";

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

  const post = await prisma.blogPost.findFirst({
    where: {
      templateId: site.published.templateId,
      slug,
      status: { in: ["PUBLISHED", "SCHEDULED"] },
      publishedAt: { lte: new Date() },
    },
    select: { id: true, title: true, commentsEnabled: true },
  });
  if (!post) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }
  if (!post.commentsEnabled) {
    return NextResponse.json({ error: "Comments are disabled on this post." }, { status: 403 });
  }

  if (body.parentId) {
    const parent = await prisma.blogComment.findFirst({ where: { id: body.parentId, postId: post.id }, select: { id: true } });
    if (!parent) {
      return NextResponse.json({ error: "The comment you're replying to no longer exists." }, { status: 400 });
    }
  }

  const ipHash = hashRequestIp(request);
  const recentCount = await prisma.blogComment.count({
    where: { ipHash, createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) } },
  });
  if (recentCount >= RATE_LIMIT_MAX_PER_HOUR) {
    return NextResponse.json({ error: "You're commenting too fast — try again later." }, { status: 429 });
  }

  const status = countLinksInCommentBody(rawBody) >= 2 ? BlogCommentStatus.SPAM : BlogCommentStatus.PENDING;

  const comment = await prisma.blogComment.create({
    data: {
      postId: post.id,
      parentId: body.parentId || null,
      authorName: name,
      authorEmail: email,
      body: sanitizeCommentBody(rawBody),
      status,
      ipHash,
    },
    select: { id: true, status: true },
  });

  if (status === BlogCommentStatus.PENDING) {
    void notifySiteOwner(site.published.templateId, post.title, name, rawBody).catch((err) =>
      console.error("[mail] blog comment notification failed:", err),
    );
  }

  return NextResponse.json({ ok: true, status: comment.status });
}

async function notifySiteOwner(templateId: string, postTitle: string, commenterName: string, rawBody: string): Promise<void> {
  const template = await prisma.template.findUnique({ where: { id: templateId }, select: { user: { select: { email: true } } } });
  const to = template?.user?.email;
  if (!to) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const html = buildNewBlogCommentEmail({
    commenterName,
    postTitle,
    commentSnippet: rawBody.length > 160 ? `${rawBody.slice(0, 160)}…` : rawBody,
    moderationUrl: `${base}/dashboard/templates/${templateId}/blog/comments`,
  });
  await sendMaildripEmail({ to, subject: `New comment on "${postTitle}"`, html });
}
