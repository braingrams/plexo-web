import { describe, expect, it } from "vitest";
import { PLEXO_HELPERS_HINT, toError } from "@/lambda/app-db/runner";

describe("database errors for missing Plexo helpers", () => {
  it("names the helpers that exist when an app calls a plexo.* function that doesn't", () => {
    const err = Object.assign(new Error("function plexo.current_workspace_id() does not exist"), { code: "42883" });
    const out = toError(err);
    expect(out.kind).toBe("query");
    expect(out.code).toBe("42883");
    expect(out.hint).toBe(PLEXO_HELPERS_HINT);
    expect(out.hint).toContain("plexo.uid()");
  });

  it("leaves other undefined-function errors alone", () => {
    const err = Object.assign(new Error("function public.nope() does not exist"), { code: "42883" });
    expect(toError(err).hint).toBeUndefined();
  });

  it("keeps Postgres' own hint when it has one", () => {
    const err = Object.assign(new Error("function plexo.current_workspace_id() does not exist"), { code: "42883", hint: "Use plexo.uid()." });
    expect(toError(err).hint).toBe("Use plexo.uid().");
  });
});
