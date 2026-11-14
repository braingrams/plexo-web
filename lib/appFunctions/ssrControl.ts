import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { VariableEnv } from "@/lib/appFunctions/ssrVariables";

// Changes to a server app's Lambda functions (publishing a preview, applying variables) run in
// BuildFinalizeFn, the only role allowed to change plexo-ssr-* functions (cdk/lib/project-runtime.ts).
// The web app queues a control message on SSR_CONTROL_QUEUE_URL and returns; the finalizer does the work.

const REGION = process.env.AWS_REGION || "us-east-1";

export type SsrControlMessage =
  | { kind: "publish"; templateId: string }
  | { kind: "variables"; templateId: string; env: VariableEnv }
  | { kind: "alwaysOn"; templateId: string; enabled: boolean };

const TEMPLATE_ID = /^[A-Za-z0-9_-]{1,50}$/;

/** The message if the body is a valid control message, otherwise null (a bad message is dropped, not retried). */
export function parseSsrControlMessage(body: string): SsrControlMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { kind, templateId, env } = data as Record<string, unknown>;
  if (typeof templateId !== "string" || !TEMPLATE_ID.test(templateId)) return null;
  if (kind === "publish") return { kind, templateId };
  if (kind === "variables" && (env === "dev" || env === "live")) return { kind, templateId, env };
  if (kind === "alwaysOn" && typeof (data as Record<string, unknown>).enabled === "boolean") {
    return { kind, templateId, enabled: (data as { enabled: boolean }).enabled };
  }
  return null;
}

export async function queueSsrControl(message: SsrControlMessage): Promise<void> {
  const queueUrl = process.env.SSR_CONTROL_QUEUE_URL;
  if (!queueUrl) throw new Error("Server app changes aren't available in this environment yet (SSR_CONTROL_QUEUE_URL isn't set).");
  await new SQSClient({ region: REGION }).send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
}
