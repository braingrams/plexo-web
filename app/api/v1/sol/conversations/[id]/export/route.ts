import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolConversation, SolMessage } from "@/lib/db/solEntities";
import { buildConversationDocument } from "@/lib/sol/exportDocument";
import { renderDocumentToDocx } from "@/lib/sol/renderDocx";
import { renderDocumentToHtml } from "@/lib/sol/renderHtml";
import { renderDocumentToPdf } from "@/lib/sol/renderPdf";

const CONTENT_TYPE_BY_FORMAT = {
  html: "text/html; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

type ExportFormat = keyof typeof CONTENT_TYPE_BY_FORMAT;

function isExportFormat(value: string | null): value is ExportFormat {
  return value === "html" || value === "docx" || value === "pdf";
}

/** Derives a filesystem/header-safe filename from the conversation title: strips
 * diacritics, drops anything outside a small safe character set (so nothing in a
 * user-editable conversation title can break out of the Content-Disposition header),
 * and collapses whitespace to hyphens. */
function sanitizeFilename(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned.slice(0, 80) || "sol-conversation";
}

/**
 * GET /api/v1/sol/conversations/:id/export?format=pdf|docx|html[&messageId=...]
 *
 * Exports a SOL conversation (or, with `messageId`, just one message in it) as a
 * downloadable PDF/DOCX/HTML document. Builds one shared DocumentModel
 * (lib/sol/exportDocument.ts) and hands it to the matching renderer, so the three formats
 * can't drift apart from one another.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const { id: conversationId } = await context.params;
  const { searchParams } = new URL(request.url);

  const format = searchParams.get("format");
  if (!isExportFormat(format)) {
    return NextResponse.json({ error: 'Invalid or missing "format" query param. Use "pdf", "docx", or "html".' }, { status: 400 });
  }
  const messageId = searchParams.get("messageId");

  // SolConversation's only index is scoped to userId with updatedAt embedded in the sort
  // key (see lib/db/solEntities.ts) — there is no by-id GSI, so this is the same
  // userId-scoped scan-and-filter lib/db/solConversationActivity.ts's
  // bumpConversationActivity already uses to find one conversation by id.
  const { data: conversations } = await SolConversation.query.primary({ userId: resolved.userId }).go({ pages: "all" });
  const conversation = conversations.find((c) => c.id === conversationId);
  if (!conversation || conversation.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No SOL conversation found with id "${conversationId}" for this account.` }, { status: 404 });
  }

  const { data: allMessages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  const messages = messageId ? allMessages.filter((message) => message.id === messageId) : allMessages;
  if (messageId && messages.length === 0) {
    return NextResponse.json({ error: `No message found with id "${messageId}" in this conversation.` }, { status: 404 });
  }

  const documentModel = buildConversationDocument({ title: conversation.title }, messages);

  let body: string | Buffer;
  try {
    if (format === "html") {
      body = renderDocumentToHtml(documentModel);
    } else if (format === "docx") {
      body = await renderDocumentToDocx(documentModel);
    } else {
      body = await renderDocumentToPdf(documentModel);
    }
  } catch (error) {
    console.error("SOL conversation export failed:", error);
    return NextResponse.json({ error: "Failed to generate export." }, { status: 500 });
  }

  const filename = `${sanitizeFilename(documentModel.title)}.${format}`;
  // NextResponse's BodyInit typing doesn't include Node's Buffer (despite Buffer being a
  // real Uint8Array at runtime, which the underlying Response constructor accepts fine) —
  // a plain Uint8Array view over the same bytes satisfies both.
  const responseBody = typeof body === "string" ? body : new Uint8Array(body);
  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE_BY_FORMAT[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
