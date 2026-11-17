import { describe, expect, it } from "vitest";
import { GUIDE_TITLES, guideFor } from "@/lib/dashboardV3/helpGuides";
import { computeTasks, EMPTY_FACTS, type TaskVariant } from "@/lib/dashboardV3/tasks";

const VARIANTS: TaskVariant[] = ["store", "business", "blog", "course", "link", "app"];
const TASK_HELP = [...new Set(VARIANTS.flatMap((v) => computeTasks(v, EMPTY_FACTS).tasks.map((t) => t.help)))];

describe("Watch how guides", () => {
  it("every guide has an intro and at least two steps with where and target filled in", () => {
    for (const t of GUIDE_TITLES) {
      const g = guideFor(t);
      expect(g.intro.length).toBeGreaterThan(5);
      expect(g.steps.length).toBeGreaterThanOrEqual(2);
      for (const st of g.steps) expect(st.where && st.target && st.text).toBeTruthy();
    }
  });
  it("every help topic used by a Home step has its own guide (nothing falls back to the generic one)", () => {
    for (const h of TASK_HELP) expect(GUIDE_TITLES, h).toContain(h);
  });
  it("topics differ: no two share the same steps", () => {
    const seen = new Set(GUIDE_TITLES.map((t) => JSON.stringify(guideFor(t).steps)));
    expect(seen.size).toBe(GUIDE_TITLES.length);
  });
});
