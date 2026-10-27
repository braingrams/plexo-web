import { describe, expect, it } from "vitest";
import { InstallPlanError, planInstall } from "../src/installPlan";

// Staging, "telly": SOL added Stripe's SDK, the build ran four minutes and timed out, and SOL
// kept retrying. Known-huge packages now stop the build at once with the light alternative.

const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: { react: "^19.0.0", ...deps } });

describe("packages too big for an app build", () => {
  it("refuses stripe and says how to take payments instead", () => {
    expect(() => planInstall(pkg({ stripe: "^17.0.0" }), {})).toThrow(InstallPlanError);
    expect(() => planInstall(pkg({ stripe: "^17.0.0" }), {})).toThrow(/fetch from a server function/);
  });

  it("refuses scoped families like @aws-sdk/*", () => {
    expect(() => planInstall(pkg({ "@aws-sdk/client-s3": "^3.0.0" }), {})).toThrow(/too big/);
  });

  it("still allows ordinary packages", () => {
    expect(planInstall(pkg({ "date-fns": "^4.0.0", "stripe-utils-not-the-sdk": "1.0.0" }), {}).mode).toBe("install");
  });
});
