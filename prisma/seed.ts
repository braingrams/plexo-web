import "dotenv/config";

import { createHash } from "node:crypto";
import { PrismaNeon } from "@prisma/adapter-neon";
import { AiTier, PrismaClient, TemplateKind } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Add it to .env before running the seed.");
}

const adapter = new PrismaNeon({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function maskApiKey(raw: string): string {
  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}...${raw.slice(-2)}`;
  }

  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

async function main(): Promise<void> {
  const email = process.env.SEED_USER_EMAIL ?? "mock.user@plexo.local";
  const password = process.env.SEED_USER_PASSWORD ?? "Plexo!Dev123";
  const fullApiKey = process.env.SEED_USER_API_KEY ?? "pk_live_localdev_1a2b3c4d";
  const defaultApiKeyName = "Local Development Key";
  const defaultTemplateName = "Welcome Email";

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: sha256(password),
      isConfirmed: true,
    },
    create: {
      email,
      passwordHash: sha256(password),
      isConfirmed: true,
    },
  });

  const existingApiKey = await prisma.apiKey.findFirst({
    where: {
      userId: user.id,
      name: defaultApiKeyName,
    },
    select: { id: true },
  });

  if (existingApiKey) {
    await prisma.apiKey.update({
      where: { id: existingApiKey.id },
      data: {
        hashedKey: sha256(fullApiKey),
        maskedKey: maskApiKey(fullApiKey),
        useAi: true,
        aiProvider: "openai",
        aiTier: AiTier.AUTO,
        isActive: true,
        lastUsedAt: null,
      },
    });
  } else {
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: defaultApiKeyName,
        hashedKey: sha256(fullApiKey),
        maskedKey: maskApiKey(fullApiKey),
        useAi: true,
        aiProvider: "openai",
        aiTier: AiTier.AUTO,
        isActive: true,
      },
    });
  }

  const existingTemplate = await prisma.template.findFirst({
    where: {
      userId: user.id,
      name: defaultTemplateName,
    },
    select: { id: true },
  });

  const templateData = {
    name: defaultTemplateName,
    kind: TemplateKind.EMAIL,
    designJson: {
      version: 1,
      locale: "en-US",
      meta: {
        seeded: true,
        source: "prisma/seed.ts",
      },
      blocks: [
        {
          id: "hero",
          type: "text",
          props: {
            content: "Welcome to Plexo",
          },
        },
      ],
    },
    compiledHtml:
      "<section><h1>Welcome to Plexo</h1><p>This seeded template is ready for local feature development.</p></section>",
  };

  if (existingTemplate) {
    await prisma.template.update({
      where: { id: existingTemplate.id },
      data: templateData,
    });
  } else {
    await prisma.template.create({
      data: {
        userId: user.id,
        ...templateData,
      },
    });
  }

  console.log(`Seeded verified user: ${user.email}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
