import { describe, expect, it } from "vitest";
import { trimOldToolWork } from "@/lib/ai/solHistoryTrim";
import { withHistoryCacheBreakpoints, billableInputTokens } from "@/lib/ai/providers/shared";

const big = "x".repeat(5000);
function rounds(n: number) {
  const history: Array<{ role: "user" | "assistant"; content: any }> = [{ role: "user", content: [{ type: "text", text: "Build it" }, { type: "document", source: { type: "url", url: "u" } }] }];
  for (let i = 0; i < n; i++) {
    history.push({ role: "assistant", content: [{ type: "text", text: `step ${i}` }, { type: "tool_use", id: `t${i}`, name: "app_write_files", input: { appId: "a", files: [{ path: `f${i}.tsx`, content: big }] } }] });
    history.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: big, is_error: false }] });
  }
  return history;
}

describe("trimOldToolWork", () => {
  it("leaves short histories alone", () => {
    const h = rounds(6);
    expect(trimOldToolWork(h)).toBe(h);
  });
  it("stubs old tool input and results, keeps the recent ones and the owner's messages", () => {
    const out = trimOldToolWork(rounds(20));
    const text = JSON.stringify(out);
    expect(out[0].content[1].type).toBe("document");
    expect(out[1].content[1].input.files[0].path).toBe("f0.tsx");
    expect(out[1].content[1].input.files[0].content.length).toBeLessThan(400);
    expect(out[2].content[0].content).toContain("left out to save space");
    // newest round untouched
    expect(out[out.length - 1].content[0].content).toBe(big);
    expect(text.length).toBeLessThan(JSON.stringify(rounds(20)).length / 2);
  });
  it("only moves the cut in steps so the cached prefix stays identical", () => {
    const a = JSON.stringify(trimOldToolWork(rounds(14)).slice(0, 10));
    const b = JSON.stringify(trimOldToolWork(rounds(16)).slice(0, 10));
    expect(a).toBe(b);
  });
});

describe("prompt caching helpers", () => {
  it("marks the last block and the previous user message", () => {
    const out = withHistoryCacheBreakpoints(rounds(3));
    expect(out[out.length - 1].content[0].cache_control).toBeTruthy();
    expect(out[out.length - 3].content[0].cache_control).toBeTruthy(); // previous user message
    expect(out[out.length - 2].content.at(-1).cache_control).toBeFalsy(); // assistant
  });
  it("weights cache reads and writes", () => {
    expect(billableInputTokens({ input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 })).toBe(100 + 1250 + 1000);
  });
});
