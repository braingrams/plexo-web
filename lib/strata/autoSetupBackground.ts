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
