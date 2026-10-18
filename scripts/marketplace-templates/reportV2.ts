/**
 * Dry-run review of the marketplace templates as V2 pages (no database, no writes):
 * converts every landing-page spec, compiles it, and prints how faithful each conversion is
 * plus the SDK's warnings, so a person can review them before generate.ts --v2 inserts anything.
 *
 *   npx tsx scripts/marketplace-templates/reportV2.ts
 */
import { compileSpecToV2 } from "./compileV2";
import { BATCHES } from "./batches";

let index = 0;
const tally = { exact: 0, approximate: 0, partial: 0, failed: 0, email: 0 };
for (const batch of BATCHES) {
  for (const spec of batch.specs) {
    index += 1;
    const label = `[${batch.category}] ${spec.name}`;
    try {
      const out = compileSpecToV2(spec, index);
      if (!out) {
        tally.email += 1;
        continue;
      }
      tally[out.fidelity] += 1;
      if (out.fidelity !== "exact" || out.warnings.length) {
        console.log(`${label} — ${out.fidelity}`);
        for (const w of out.warnings) console.log(`   - ${w}`);
      }
    } catch (err) {
      tally.failed += 1;
      console.log(`${label} — FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
console.log(`\nexact ${tally.exact}  approximate ${tally.approximate}  partial ${tally.partial}  failed ${tally.failed}  (email, kept classic: ${tally.email})`);
if (tally.failed) process.exitCode = 1;
