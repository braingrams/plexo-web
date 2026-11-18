/**
 * One-off: emails every existing Plexo user the "Plexo has a new look" announcement.
 *
 *   npx tsx scripts/send-redesign-announcement.ts                        # DRY RUN: counts who would get it, sends nothing
 *   npx tsx scripts/send-redesign-announcement.ts --only=me@example.com   # dry-run one address
 *   npx tsx scripts/send-redesign-announcement.ts --only=me@example.com --apply   # really send to that one address (test)
 *   npx tsx scripts/send-redesign-announcement.ts --apply                 # really send to everyone
 *
 * Flags: --apply (send for real; default is a dry run), --only=<email> (just that user),
 *        --batch=<n> (emails per batch, default 20), --pause=<ms> (wait between batches, default 2000),
 *        --exclude-file=<path> (text file, one unsubscribed email per line).
 *
 * Skips: suspended or unconfirmed accounts, anyone who has unsubscribed / switched product emails off
 * (an `unsubscribedAt`, `marketingOptOut` or `productEmails === false` field on the user row, plus the
 * --exclude-file list), duplicates, and accounts without a valid address. Needs MAILDRIP_API_KEY and the usual
 * AWS credentials / PLEXO_* table env. Safe to re-run only with --only; a full --apply has no "already sent"
 * marker, so run it once.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

import { User } from "../lib/db/coreEntities";
import { sendMaildripEmail, EMAIL_SITE_URL } from "../lib/mail/maildrip";
import { buildRedesignAnnouncementEmail } from "../lib/mail/templates";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes("--apply");
const only = flag("only")?.trim().toLowerCase();
const batchSize = Math.max(1, Number(flag("batch") ?? 20));
const pauseMs = Math.max(0, Number(flag("pause") ?? 2000));
const excludeFile = flag("exclude-file");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { id: string; email?: string; name?: string; suspendedAt?: string; isConfirmed?: boolean } & Record<string, unknown>;

function optedOut(u: Row): boolean {
  return Boolean(u.unsubscribedAt) || Boolean(u.marketingOptOut) || u.productEmails === false;
}

async function main() {
  if (apply && !process.env.MAILDRIP_API_KEY) throw new Error("Set MAILDRIP_API_KEY first.");
  const excluded = new Set(excludeFile ? readFileSync(excludeFile, "utf8").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
  console.log(apply ? "APPLYING — sending real emails" : "DRY RUN — nothing is sent (pass --apply to send)");

  const { data } = await User.scan.go({ pages: "all" });
  const seen = new Set<string>();
  const counts = { scanned: data.length, suspended: 0, unconfirmed: 0, optedOut: 0, noEmail: 0, duplicate: 0, notSelected: 0, toSend: 0, sent: 0, failed: 0 };
  const queue: Row[] = [];
  for (const raw of data as Row[]) {
    const email = raw.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { counts.noEmail++; continue; }
    if (only && email !== only) { counts.notSelected++; continue; }
    if (raw.suspendedAt) { counts.suspended++; continue; }
    if (raw.isConfirmed === false) { counts.unconfirmed++; continue; }
    if (optedOut(raw) || excluded.has(email)) { counts.optedOut++; continue; }
    if (seen.has(email)) { counts.duplicate++; continue; }
    seen.add(email);
    queue.push({ ...raw, email });
  }
  counts.toSend = queue.length;

  const setupUrl = `${EMAIL_SITE_URL}/welcome/setup`;
  const unsubscribeUrl = `${EMAIL_SITE_URL}/dashboard/settings`;
  for (let i = 0; i < queue.length; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    for (const user of batch) {
      if (!apply) continue;
      const { subject, html } = buildRedesignAnnouncementEmail({ name: user.name, setupUrl, unsubscribeUrl });
      try {
        await sendMaildripEmail({ to: user.email!, subject, html });
        counts.sent++;
      } catch (err) {
        counts.failed++;
        console.error(`  failed ${user.email}: ${err instanceof Error ? err.message : err}`);
      }
      await sleep(150);
    }
    console.log(`batch ${Math.floor(i / batchSize) + 1}: ${batch.length} ${apply ? "processed" : "would send"} (${Math.min(i + batchSize, queue.length)}/${queue.length})`);
    if (apply && i + batchSize < queue.length) await sleep(pauseMs);
  }
  console.log(counts);
  if (!apply) console.log("Dry run complete. Re-run with --apply to send.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
