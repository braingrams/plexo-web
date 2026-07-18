import { createHash } from "node:crypto";
import "dotenv/config";

import { prisma } from "../server/prisma";

async function main(): Promise<void> {
  const hashed = createHash("sha256")
    .update("pk_live_compile_test_20260718", "utf8")
    .digest("hex");

  const key = await prisma.apiKey.findFirst({
    where: {
      hashedKey: hashed,
    },
    select: {
      isActive: true,
      useAi: true,
      aiModel: true,
      aiTier: true,
      lastUsedAt: true,
    },
  });

  console.log(JSON.stringify(key));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
