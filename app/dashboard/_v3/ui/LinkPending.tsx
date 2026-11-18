"use client";

import { useLinkStatus } from "next/link";

/**
 * Put this inside a <Link>: while that link's page is on its way, the link looks chosen and shows a
 * small spinner, so a click is never met with silence. Takes no space (it floats at the end of the link).
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className="plx-pend" data-on={pending ? "true" : "false"} />;
}
