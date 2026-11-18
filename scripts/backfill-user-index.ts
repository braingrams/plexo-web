/**
 * One-off: gives every EXISTING Template and PublishedDomain row its GSI3 (byUser) keys.
 * New and updated rows get them automatically from the entity definitions; rows nobody has
 * written since the index was added don't, so without this they'd be invisible to
 * "list this user's sites" queries.
 *
 *   npx tsx scripts/backfill-user-index.ts            # dry run: counts what it would change
 *   npx tsx scripts/backfill-user-index.ts --apply    # writes the two index keys
 *
 * Writes ONLY GSI3PK/GSI3SK with a raw UpdateItem — deliberately not entity.patch(), whose
 * updatedAt watcher would bump "last edited" on every site. Idempotent; safe to re-run, and
 * rows that were deleted mid-run are skipped (attribute_exists guard). Needs AWS credentials
 * and PLEXO_CONTENT_TABLE for the target environment.
 *
 * ORDER: deploy the data stack (creates GSI3, wait until ACTIVE) -> deploy the app -> run
 * this -> only then ship anything that READS byUser (the admin panel).
 */
import "dotenv/config";

import { rawDocClient, TABLES } from "../lib/db/client";

const apply = process.argv.includes("--apply");

// Raw, projected Scan on purpose: going through Template.scan would re-load every template's
// large design body from S3 just to read two ids. Only keys + owner are read here.
async function main() {
  console.log(apply ? "APPLYING — writing GSI3 keys" : "DRY RUN — nothing is written (pass --apply)");
  const table = TABLES.content;
  let templates = 0;
  let domains = 0;
  let skipped = 0;

  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await rawDocClient.scan({
      TableName: table,
      ExclusiveStartKey: startKey,
      FilterExpression: "#e IN (:t, :d)",
      ProjectionExpression: "pk, sk, #e, #id, userId",
      ExpressionAttributeNames: { "#e": "__edb_e__", "#id": "id" },
      ExpressionAttributeValues: { ":t": "template", ":d": "publishedDomain" },
    });
    for (const row of page.Items ?? []) {
      const isTemplate = row.__edb_e__ === "template";
      if (!row.userId || !row.id) {
        skipped++;
        continue;
      }
      if (isTemplate) templates++;
      else domains++;
      if (!apply) continue;
      try {
        await rawDocClient.update({
          TableName: table,
          Key: { pk: row.pk, sk: row.sk },
          UpdateExpression: "SET GSI3PK = :pk, GSI3SK = :sk",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: {
            ":pk": `USER#${row.userId}`,
            ":sk": `${isTemplate ? "TEMPLATE" : "DOMAIN"}#${row.id}`,
          },
        });
      } catch (err) {
        if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err; // deleted mid-run
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  console.log(`${apply ? "Stamped" : "Would stamp"} ${templates} template(s) and ${domains} published domain(s)${skipped ? `; ${skipped} had no owner and were skipped` : ""}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
