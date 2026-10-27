/**
 * Removes big values and big brands from storage that no row points at any more (see lib/db/valueSweep.ts for the safety rules).
 *
 *   npx tsx scripts/sweep-stored-values.ts            # dry run: reports what it would remove, deletes nothing
 *   npx tsx scripts/sweep-stored-values.ts --apply    # removes it
 *
 * Needs the same environment as the app: AWS credentials, the PLEXO_*_TABLE variables and USER_CONTENT_BUCKET_NAME.
 * Safe to run on a schedule (weekly is plenty); it reads every row, so run it off-peak.
 */
import { gunzipSync } from "node:zlib";
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import { rawDocClient, TABLES } from "../lib/db/client";
import { sweepStoredValues, type SweepStore } from "../lib/db/valueSweep";

const bucket = process.env.USER_CONTENT_BUCKET_NAME;
if (!bucket) throw new Error("USER_CONTENT_BUCKET_NAME is not set.");
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1", maxAttempts: 10, retryMode: "adaptive" });

const store: SweepStore = {
  async *list(prefix) {
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key && o.LastModified) yield { key: o.Key, lastModified: o.LastModified };
      token = res.NextContinuationToken;
    } while (token);
  },
  async readValue(hash) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `private/db-values/${hash}` }));
      return gunzipSync(Buffer.from(await res.Body!.transformToByteArray())).toString("utf8");
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err; // anything else means we can't be sure what is in use: stop rather than guess
    }
  },
  async delete(keys) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
  },
};

async function* rows(): AsyncGenerator<Record<string, unknown>> {
  for (const [name, table] of Object.entries(TABLES)) {
    let start: Record<string, unknown> | undefined;
    do {
      // A failed page throws and stops the whole sweep: it never deletes after a partial read.
      const res = await rawDocClient.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }));
      for (const item of res.Items ?? []) yield item;
      start = res.LastEvaluatedKey;
    } while (start);
    console.log(`read ${name}`);
  }
}

const apply = process.argv.includes("--apply");
sweepStoredValues({ rows, store, apply }).then(
  (r) => {
    console.log(JSON.stringify(r, null, 2));
    if (r.dryRun && (r.staleValues || r.staleBrands)) console.log("Dry run: nothing was deleted. Re-run with --apply to remove the stale objects above.");
  },
  (err) => {
    console.error("The sweep stopped before deleting anything:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
