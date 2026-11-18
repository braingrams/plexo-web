// @vitest-environment happy-dom
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/dashboard/_v3/theme/ThemeContext", () => ({ useV3ThemeOptional: () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import { EditorFrame, useEditorBeginner } from "../app/dashboard/_components/EditorTheme";

function Probe() {
  return <span>{useEditorBeginner() ? "simple" : "full"}</span>;
}
const show = (v3: boolean, beginner?: boolean) => renderToString(<EditorFrame v3={v3} beginner={beginner}><Probe /></EditorFrame>);

describe("which editor screen a person gets", () => {
  it("beginners on the new dashboard get the simple screen", () => {
    expect(show(true, true)).toContain("simple");
  });
  it("everyone else keeps the full editor (including beginners still on the old dashboard)", () => {
    expect(show(true, false)).toContain("full");
    expect(show(true)).toContain("full");
    expect(show(false, true)).toContain("full");
  });
});
