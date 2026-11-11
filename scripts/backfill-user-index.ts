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

import { Template, PublishedDomain } from "../lib/db/contentEntities";
import { rawDocClient } from "../lib/db/client";

const apply = process.argv.includes("--apply");

async function stamp(key: Record<string, unknown>, tableName: string, pk: string, sk: string): Promise<boolean> {
  try {
    await rawDocClient.update({
      TableName: tableName,
      Key: key,
      UpdateExpression: "SET GSI3PK = :pk, GSI3SK = :sk",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeValues: { ":pk": pk, ":sk": sk },
    });
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

async function main() {
  console.log(apply ? "APPLYING — writing GSI3 keys" : "DRY RUN — nothing is written (pass --apply)");
  let templates = 0;
  let domains = 0;

  let cursor: string | null | undefined = undefined;
  do {
    const page: { data: { id: string; userId: string }[]; cursor: string | null } = await Template.scan.go({ cursor });
    for (const t of page.data) {
      if (!t.userId) continue;
      templates++;
      if (apply) {
        const p = Template.get({ id: t.id }).params() as { TableName: string; Key: Record<string, unknown> };
        await stamp(p.Key, p.TableName, `USER#${t.userId}`, `TEMPLATE#${t.id}`);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  cursor = undefined;
  do {
    const page: { data: { id: string; userId: string; templateId: string }[]; cursor: string | null } = await PublishedDomain.scan.go({ cursor });
    for (const d of page.data) {
      if (!d.userId) continue;
      domains++;
      if (apply) {
        const p = PublishedDomain.get({ templateId: d.templateId, id: d.id }).params() as { TableName: string; Key: Record<string, unknown> };
        await stamp(p.Key, p.TableName, `USER#${d.userId}`, `DOMAIN#${d.id}`);
      }
    }
    cursor = page.cursor;
  } while (cursor);

  console.log(`${apply ? "Stamped" : "Would stamp"} ${templates} template(s) and ${domains} published domain(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
