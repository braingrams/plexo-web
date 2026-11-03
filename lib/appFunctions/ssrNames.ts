// Names for an SSR app's Lambda functions. Pure, so tests and the routes can use them without
// loading the database or AWS clients.
//
// The scope keeps environments apart. PR preview stacks share staging's database and AWS account,
// so without it a PR's publish could replace staging's function for the same app. CDK sets
// SSR_FUNCTION_SCOPE from the stack (cdk/lib/project-runtime.ts): "pr<number>", "stg", or "prod".

import { createHash } from "node:crypto";

export type SsrTarget = "live" | "preview";

const LAMBDA_NAME_LIMIT = 64;

export function ssrFunctionName(templateId: string, target: SsrTarget = "live", scope: string | undefined = process.env.SSR_FUNCTION_SCOPE): string {
  const prefix = scope ? `plexo-ssr-${scope}-` : "plexo-ssr-";
  const suffix = target === "live" ? "" : "-pv";
  const name = `${prefix}${templateId}${suffix}`;
  if (name.length <= LAMBDA_NAME_LIMIT) return name;
  // Too long for Lambda: keep a readable start and a hash of the whole id, so it stays unique.
  const hash = createHash("sha256").update(templateId).digest("hex").slice(0, 8);
  const room = LAMBDA_NAME_LIMIT - prefix.length - suffix.length - hash.length - 1;
  return `${prefix}${templateId.slice(0, room)}-${hash}${suffix}`;
}
