import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/contentEntities", () => ({}));
vi.mock("@/lib/db/importEntities", () => ({}));
vi.mock("@/lib/db/commerceEntities", () => ({}));
vi.mock("@/lib/blog/savePostCore", () => ({}));
vi.mock("@/lib/blog/redirectsDynamo", () => ({}));
vi.mock("@/lib/blogImport/taxonomyDynamo", () => ({}));
vi.mock("@/lib/blogImport/mediaRehostDynamo", () => ({}));
vi.mock("@/lib/commerce/donations", () => ({}));
vi.mock("@/lib/wpMigration/storeImport", () => ({}));

import { isTransientAwsError, stepErrorMessage } from "@/lib/wpMigration/runJobDynamo";

// What ElectroDB actually threw on maildrip.io's 542-post planning step.
const throttled = Object.assign(
  new Error('Error thrown by DynamoDB client: "Throughput exceeds the current capacity of your table or index. DynamoDB is automatically scaling your table or index so please try again shortly."'),
  { cause: { name: "ThrottlingException" } },
);

describe("migration step errors", () => {
  it("a DynamoDB throttle is temporary — retried, not shown to the owner", () => {
    expect(isTransientAwsError(throttled)).toBe(true);
    expect(isTransientAwsError({ name: "ProvisionedThroughputExceededException" })).toBe(true);
    expect(isTransientAwsError(new Error("WordPress returned 404"))).toBe(false);
  });

  it("the owner never reads a raw database error", () => {
    expect(stepErrorMessage("PLANNING", throttled)).toBe("Reading your WordPress site paused because Plexo was briefly busy saving your site.");
    expect(stepErrorMessage("POSTS", new Error("Error thrown by DynamoDB client: Item size has exceeded the maximum allowed size"))).toBe(
      "The posts step stopped because Plexo couldn't save part of your site.",
    );
    expect(stepErrorMessage("PAGES", new Error("Your WordPress site didn't respond"))).toBe("The pages step stopped: Your WordPress site didn't respond");
  });
});
