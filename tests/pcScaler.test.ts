import { describe, it, expect, beforeEach } from "vitest";

const sent: Array<{ name: string; input: any }> = [];
let failWith: Error | null = null;


// The scaler is plain CommonJS, loaded the same way Lambda loads it.
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { makeHandler } = require("../lambda/pc-scaler/index.js") as { makeHandler: (c: unknown) => (e: unknown) => Promise<any> };
const fakeClient = {
  async send(cmd: { constructor: { name: string }; input: any }) {
    sent.push({ name: cmd.constructor.name, input: cmd.input });
    if (failWith) throw failWith;
    return {};
  },
};
const handler = makeHandler(fakeClient);

describe("PC scaler", () => {
  beforeEach(() => {
    sent.length = 0;
    failWith = null;
    process.env.TARGET_FUNCTION_NAME = "stack-ServerFn-abc";
    process.env.TARGET_ALIAS = "live";
  });

  it("sets provisioned concurrency on the configured function's alias", async () => {
    expect(await handler({ provisionedConcurrency: 6 })).toEqual({ ok: true, applied: 6 });
    expect(sent).toEqual([{ name: "PutProvisionedConcurrencyConfigCommand", input: { FunctionName: "stack-ServerFn-abc", Qualifier: "live", ProvisionedConcurrentExecutions: 6 } }]);
  });

  it("removes provisioned concurrency for 0", async () => {
    expect(await handler({ provisionedConcurrency: 0 })).toEqual({ ok: true, applied: 0 });
    expect(sent[0]).toMatchObject({ name: "DeleteProvisionedConcurrencyConfigCommand", input: { FunctionName: "stack-ServerFn-abc", Qualifier: "live" } });
  });

  it("treats 'nothing to remove' as success", async () => {
    failWith = Object.assign(new Error("none"), { name: "ResourceNotFoundException" });
    expect(await handler({ provisionedConcurrency: 0 })).toEqual({ ok: true, applied: 0 });
  });

  it.each([[-1], [201], [2.5], ["5"], [null], [undefined]])("rejects %j without calling Lambda", async (value) => {
    const result = await handler({ provisionedConcurrency: value });
    expect(result.ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("ignores any target in the request: only the environment decides", async () => {
    await handler({ provisionedConcurrency: 5, FunctionName: "someone-else", Qualifier: "$LATEST" });
    expect(sent[0].input).toMatchObject({ FunctionName: "stack-ServerFn-abc", Qualifier: "live" });
  });
});
