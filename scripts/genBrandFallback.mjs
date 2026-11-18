// Regenerates lib/brand/fallbackAssets.ts from lib/brand/fallback/*. Run: node scripts/genBrandFallback.mjs
import fs from "node:fs";
const d="lib/brand/fallback/";
const m={"wordmark-on-light":["logo-dark.svg","image/svg+xml"],"wordmark-on-dark":["logo-light.svg","image/svg+xml"],"email-on-light":["plexo-wordmark-dark.png","image/png"],"email-on-dark":["plexo-wordmark-light.png","image/png"],"icon":["plexo-mark.png","image/png"],"app-icon":["plexo-mark-tile.png","image/png"]};
let o="// GENERATED from the files in lib/brand/fallback by scripts/genBrandFallback.mjs - do not edit.\n// Embedded (not read from disk) so the bundled logos work in every server bundle with no file tracing.\nexport const FALLBACK_LOGO_FILES: Record<string, { file: string; contentType: string; base64: string }> = {\n";
for(const [k,[f,t]] of Object.entries(m))o+=`  ${JSON.stringify(k)}: { file: ${JSON.stringify(f)}, contentType: ${JSON.stringify(t)}, base64: ${JSON.stringify(fs.readFileSync(d+f).toString("base64"))} },\n`;
o+="};\n";
fs.writeFileSync("lib/brand/fallbackAssets.ts",o);
