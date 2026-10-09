import { describe, expect, it } from "vitest";
import { collectScaffold } from "../scripts/build-project-scaffold.mjs";
import { SCAFFOLD_FILES } from "@/lib/projects/scaffold/files.generated";

describe("project scaffold", () => {
  it("the generated module matches lib/projects/scaffold/template (run node scripts/build-project-scaffold.mjs)", () => {
    expect(SCAFFOLD_FILES).toEqual(collectScaffold());
  });

  it("ships the files every app relies on", () => {
    for (const path of ["package.json", "index.html", "PLEXO.md", "src/main.tsx", "src/App.tsx", "src/lib/plexo.ts", "src/lib/plexo-react.tsx", "functions/types.ts", "db/migrations/README.md"]) {
      expect(SCAFFOLD_FILES[path], path).toBeTruthy();
    }
  });
});
