import { SCAFFOLD_FILES } from "./files.generated";
import { escapeHtmlAttr } from "@/lib/pub/htmlInject";

export { SCAFFOLD_FILES };

/** The starter files for a new project, personalised with its name. */
export function scaffoldFiles(appName: string): Record<string, string> {
  const files = { ...SCAFFOLD_FILES };
  const name = appName.trim() || "My Plexo App";
  files["index.html"] = files["index.html"].replace("<title>My Plexo App</title>", `<title>${escapeHtmlAttr(name)}</title>`);
  const pkg = JSON.parse(files["package.json"]);
  pkg.name = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plexo-app";
  files["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
  return files;
}
