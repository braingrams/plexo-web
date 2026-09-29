import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { prepareMessagesTurn, prepareConfirmTurn, type StreamFrame, type TurnEmitter } from "@/lib/ai/solChatHandler";
import { resolveSessionUser, parseCookies } from "./sessionAuth";

// SOL chat-turn Lambda handler, behind a Function URL with `invokeMode: RESPONSE_STREAM`
// (cdk/lib/compute-stack.ts's `solChatFn.addFunctionUrl`). A plain `handler: async (event)
// => ({...})` return-value handler CANNOT stream — Lambda buffers its entire return value
// and delivers it as one response only once the invocation finishes, regardless of the
// Function URL's invoke mode. The correct mechanism for an incrementally-flushed response
// from a Function URL (confirmed against AWS's own "Introducing AWS Lambda response
// streaming" announcement and the Node.js runtime's own documented contract — this is NOT
// an npm package, it's a global the Node 18+ Lambda runtime injects into the execution
// environment only when the function's invoke mode is RESPONSE_STREAM) is exactly what
// @types/aws-lambda's own handler.d.ts documents: wrap the handler in
// `awslambda.streamifyResponse(async (event, responseStream, context) => {...})`, then
// write to `responseStream` (after wrapping it with `awslambda.HttpResponseStream.from(...,
// {statusCode, headers})` to set the status/headers Lambda would otherwise default to
// 200/none) as data becomes available.
//
// This file is now a THIN wrapper: everything about a SOL turn itself (credit metering,
// tool-calling loop, confirmation gating, memory extraction) lives in
// lib/ai/solChatHandler.ts, which knows nothing about Lambda — only how to translate that
// runtime-agnostic core into this specific streaming transport (parsing an API Gateway v2
// event, decoding the session cookie without Next.js's request context, and wrapping
// `awslambda.HttpResponseStream`).

// `awslambda.HttpResponseStream.from()`'s first parameter is typed (by @types/aws-lambda)
// as the raw Node `Writable` class, not the looser `NodeJS.WritableStream` interface — so
// every function that calls `.from()` itself takes `awslambda.HttpResponseStream`
// specifically (the exact type the runtime hands the wrapped handler below), while
// functions that only ever `.write()`/`.end()` an ALREADY-wrapped stream accept the looser
// `NodeJS.WritableStream` since that's all they need structurally.
function sendJson(stream: awslambda.HttpResponseStream, statusCode: number, body: unknown): void {
  const wrapped = awslambda.HttpResponseStream.from(stream, {
    statusCode,
    headers: { "Content-Type": "application/json" },
  });
  wrapped.write(JSON.stringify(body));
  wrapped.end();
}

function openNdjsonStream(stream: awslambda.HttpResponseStream): NodeJS.WritableStream {
  return awslambda.HttpResponseStream.from(stream, {
    statusCode: 200,
    // "application/x-ndjson" — newline-delimited JSON, one frame per line, matching
    // solChatHandler.ts's StreamFrame vocabulary. Not Server-Sent Events
    // (`text/event-stream`): no "event:"/"data:" framing or reconnect semantics are needed
    // for a single request/response chat turn, just an incrementally-flushed body the
    // client reads with a streaming fetch() reader and splits on "\n".
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}

function lambdaEmitter(stream: NodeJS.WritableStream): TurnEmitter {
  return {
    emit: (frame: StreamFrame) => stream.write(`${JSON.stringify(frame)}\n`),
    end: () => stream.end(),
  };
}

interface ParsedRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  body: unknown;
}

function parseEvent(event: APIGatewayProxyEventV2): ParsedRequest {
  const rawBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "";
  let body: unknown = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }

  return {
    method: event.requestContext?.http?.method ?? "GET",
    path: event.rawPath ?? "/",
    headers: event.headers ?? {},
    cookies: parseCookies({ cookies: event.cookies, headerCookie: event.headers?.cookie ?? event.headers?.Cookie ?? null }),
    body,
  };
}

// Deliberately under a `/chat/` sub-path distinct from the ordinary Next.js CRUD routes at
// `/api/v1/sol/conversations/**` (transcript GET, rename/archive, etc., served by
// serverFn). CloudFront's cache-behavior routing is path-pattern-only — it can't dispatch
// the same path to a different origin based on HTTP method — so a streaming POST turn and a
// plain GET transcript fetch can't share one path across two different Lambdas. Giving
// SolChatFn's own routes their own path prefix (`api/v1/sol/chat/*`) lets CloudFront send
// exactly that subtree here and leave the rest of `api/v1/sol/*` on the default (serverFn)
// behavior, with no path collision. See compute-stack.ts's matching CloudFront behavior.
const MESSAGES_RE = /^\/api\/v1\/sol\/chat\/conversations\/([^/]+)\/messages\/?$/;
const CONFIRM_RE = /^\/api\/v1\/sol\/chat\/conversations\/([^/]+)\/messages\/([^/]+)\/confirm\/?$/;

export const handler = awslambda.streamifyResponse(async (event: APIGatewayProxyEventV2, responseStream: awslambda.HttpResponseStream) => {
  // Closes compute-stack.ts's own TODO(security): reject anything that reaches this
  // Function URL directly (bypassing CloudFront, which is the only party that attaches this
  // header — see that stack's originVerifySecret comment) before any app logic, session
  // decoding, or DynamoDB access runs at all.
  const expectedSecret = process.env.PLEXO_ORIGIN_VERIFY_SECRET;
  const actualSecret = event.headers?.["x-origin-verify"];
  if (!expectedSecret || actualSecret !== expectedSecret) {
    sendJson(responseStream, 403, { error: "Forbidden." });
    return;
  }

  const request = parseEvent(event);

  if (request.method !== "POST") {
    sendJson(responseStream, 404, { error: "Not found." });
    return;
  }

  const messagesMatch = request.path.match(MESSAGES_RE);
  const confirmMatch = request.path.match(CONFIRM_RE);
  if (!messagesMatch && !confirmMatch) {
    sendJson(responseStream, 404, { error: "Not found." });
    return;
  }

  const resolved = await resolveSessionUser(request.cookies);
  if (!resolved) {
    sendJson(responseStream, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const prepared = confirmMatch
      ? await prepareConfirmTurn(confirmMatch[1], confirmMatch[2], resolved, request.body)
      : await prepareMessagesTurn(messagesMatch![1], resolved, request.body);

    if (!prepared.ok) {
      sendJson(responseStream, prepared.status, prepared.body);
      return;
    }

    const httpStream = openNdjsonStream(responseStream);
    await prepared.run(lambdaEmitter(httpStream));
  } catch (err) {
    // A failure here means one of the pre-stream steps (ownership check, credit pre-flight,
    // memory-facts load) itself threw, BEFORE openNdjsonStream ever committed this response
    // to 200/ndjson — safe to still send a clean JSON error status.
    console.error("SOL chat handler failed before streaming began:", err);
    sendJson(responseStream, 500, { error: "Internal error." });
  }
});
