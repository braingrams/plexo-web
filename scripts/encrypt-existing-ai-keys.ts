/**
 * One-off migration: encrypts any legacy plaintext ApiKey.aiApiKey values in place.
 * Safe to re-run — rows that already decrypt successfully (already encrypted) are skipped.
 *
 * Usage: npx tsx scripts/encrypt-existing-ai-keys.ts
 */
import { prisma } from "../server/prisma";
import { decryptSecret, encryptSecret } from "../lib/crypto";

async function main() {
  const keys = await prisma.apiKey.findMany({
    where: { aiApiKey: { not: null } },
    select: { id: true, aiApiKey: true },
  });

  let migrated = 0;
  let skipped = 0;

  for (const key of keys) {
    const value = key.aiApiKey;
    if (!value) continue;

    try {
      decryptSecret(value);
      skipped += 1;
      continue;
    } catch {
      // Not a valid encrypted blob under the current key — treat as legacy plaintext.
    }

    const encrypted = encryptSecret(value);
    await prisma.apiKey.update({ where: { id: key.id }, data: { aiApiKey: encrypted } });
    migrated += 1;
  }

  console.log(`Encrypted ${migrated} legacy plaintext AI key(s); ${skipped} were already encrypted.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
