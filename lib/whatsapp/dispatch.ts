import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

import type { InboundWhatsAppMessage } from "./cloudApi";
import { processInboundMessage } from "./inbound";

let client: LambdaClient | null = null;

/** Hands a message to the SOL Lambda (15-minute limit, same IAM and tools as dashboard chat) as an
 * asynchronous invoke, so the webhook can answer Meta immediately. Without SOL_CHAT_FUNCTION_NAME (local
 * dev) it runs the message in this process instead; `runInline` lets the caller keep it alive past the response. */
export async function dispatchInbound(msg: InboundWhatsAppMessage, runInline: (work: Promise<void>) => void): Promise<void> {
  const functionName = process.env.SOL_CHAT_FUNCTION_NAME;
  if (!functionName) {
    runInline(processInboundMessage(msg).catch((err) => console.error("[whatsapp] inline run failed:", err)));
    return;
  }
  client ??= new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });
  await client.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: Buffer.from(JSON.stringify({ whatsappJob: msg })) }));
}
