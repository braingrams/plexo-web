import { after } from "next/server";
import { ensureSiteBrandInStrata } from "./autoSetup";

/** Starts the set-up after the response is sent (so making a website is never slower), or right away where there is no request. */
export function setUpBrandInBackground(input: { siteId: string; userId: string; organizationId: string }): void {
  const run = () => ensureSiteBrandInStrata(input).then(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

const lastTried = new Map<string, number>();
const RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * For a site that has no Strata project yet (made before this existed, or an earlier attempt didn't get through): starts the
 * set-up when someone opens its Brand tab or Home, at most once every ten minutes per site, so an owner never has to press anything.
 * Returns whether it started one.
 */
export function healSiteBrandInBackground(input: { siteId: string; userId: string; organizationId: string }, now = Date.now()): boolean {
  const last = lastTried.get(input.siteId);
  if (last !== undefined && now - last < RETRY_AFTER_MS) return false;
  lastTried.set(input.siteId, now);
  setUpBrandInBackground(input);
  return true;
}

/** Tests only. */
export const __forgetHealTries = () => lastTried.clear();
