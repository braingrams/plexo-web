/**
 * One-off export: compiles every marketplace TemplateSpec to its designJson (via the same
 * compileSpecToDesignJson used by generate.ts) and writes each out as a standalone JSON file,
 * for plexo-sdk's regression-test fixture corpus. Pure — no DB, no compileToHTML, no writes
 * to this repo. Re-run and copy the output into plexo-sdk/src/test/fixtures/marketplace/
 * whenever the specs change.
 *
 * Usage: npx tsx scripts/marketplace-templates/exportFixturesForSdk.ts <output-dir>
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { compileSpecToDesignJson } from "./compile";
import type { CategoryBatch } from "./types";

import { ecommerceBatch } from "./specs/ecommerce";
import { blogMediaBatch } from "./specs/blog-media";
import { corporateBatch } from "./specs/corporate";
import { localBusinessBatch } from "./specs/local-business";
import { entertainmentBatch } from "./specs/entertainment";
import { musicBatch } from "./specs/music";
import { saasBatch } from "./specs/saas";
import { healthFitnessBatch } from "./specs/health-fitness";
import { educationBatch } from "./specs/education";
import { realEstateBatch } from "./specs/real-estate";

const BATCHES: CategoryBatch[] = [
  ecommerceBatch,
  blogMediaBatch,
  corporateBatch,
  localBusinessBatch,
  entertainmentBatch,
  musicBatch,
  saasBatch,
  healthFitnessBatch,
  educationBatch,
  realEstateBatch,
];

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: exportFixturesForSdk.ts <output-dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

let count = 0;
const manifest: Array<{ file: string; category: string; name: string; kind: string }> = [];

for (const batch of BATCHES) {
  batch.specs.forEach((spec, index) => {
    const designJson = compileSpecToDesignJson(spec, index);
    const slug = `${batch.category}-${spec.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const fileName = `${slug}.json`;
    writeFileSync(join(outDir, fileName), JSON.stringify(designJson, null, 2) + "\n");
    manifest.push({ file: fileName, category: batch.category, name: spec.name, kind: spec.kind });
    count++;
  });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${count} fixture files + manifest.json to ${outDir}`);
