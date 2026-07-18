import { createHash } from "node:crypto";
import "dotenv/config";

import { prisma } from "../server/prisma";

async function main(): Promise<void> {
  const raw = "pk_live_compile_test_20260718";
  const hashed = createHash("sha256").update(raw, "utf8").digest("hex");

  const user = await prisma.user.findFirst({
    select: {
      id: true,
      email: true,
    },
  });

  if (!user) {
    throw new Error("No user found in database. Seed a user first.");
  }

  const existing = await prisma.apiKey.findFirst({
    where: {
      hashedKey: hashed,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    await prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        useAi: true,
        aiProvider: "claude",
        aiTier: "HIGH",
      },
    });
  } else {
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "Compile Route Test Key",
        hashedKey: hashed,
        maskedKey: "pk_live_comp...0718",
        isActive: true,
        useAi: true,
        aiProvider: "claude",
        aiTier: "HIGH",
      },
    });
  }

  console.log(`Test key ready for ${user.email}`);
  console.log(`RAW_KEY=${raw}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
