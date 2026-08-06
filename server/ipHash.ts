import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/** Same sha256(ip)-only pattern app/pub/[domain]/[[...slug]]/route.ts already uses for PageView.ipHash — raw IP is never stored, anywhere. */
export function hashRequestIp(request: NextRequest): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "127.0.0.1";
  return createHash("sha256").update(ip).digest("hex");
}
