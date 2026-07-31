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
    // Real plexo-sdk TemplateJSON shape (body.rows[].columns[].elements[]) — the previous
    // seed used a made-up {version, locale, blocks} shape that the actual SDK/compiler never
    // understood, so this "seeded" template never rendered as anything real.
    designJson: {
      body: {
        style: { backgroundColor: "#ffffff", padding: "0px" },
        rows: [
          {
            id: "row-welcome-hero",
            style: { backgroundColor: "#0f172a", padding: "48px 32px", textAlign: "center" },
            columns: [
              {
                id: "col-welcome-hero",
                width: "100%",
                elements: [
                  {
                    id: "elem-welcome-heading",
                    type: "heading",
                    style: { color: "#ffffff", fontSize: "32px", textAlign: "center" },
                    attributes: { text: "Welcome to Plexo" },
                  },
                  {
                    id: "elem-welcome-text",
                    type: "paragraph",
                    style: { color: "#94a3b8", fontSize: "16px", textAlign: "center", padding: "12px 0px 0px 0px" },
                    attributes: { text: "This seeded template is ready for local feature development." },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    compiledHtml:
      "<div style=\"background:#0f172a;color:#ffffff;padding:48px 32px;text-align:center;\"><h1>Welcome to Plexo</h1><p style=\"color:#94a3b8;\">This seeded template is ready for local feature development.</p></div>",
    // Doubles as one of the 3 official/curated samples surfaced by /api/v1/public-templates
    // (replacing the old hardcoded DEFAULT_PUBLIC_TEMPLATES array in the route file) — see the
    // other two (LANDING_PAGE) created below.
    isOfficial: true,
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

  const officialLandingPages: Array<{ name: string; designJson: object; compiledHtml: string }> = [
    {
      name: "Modern SaaS Landing Page",
      designJson: {
        body: {
          style: { backgroundColor: "#0f172a", color: "#f8fafc" },
          rows: [
            {
              id: "row-saas-hero",
              style: { padding: "80px 40px", textAlign: "center" },
              columns: [
                {
                  id: "col-saas-hero",
                  width: "100%",
                  elements: [
                    {
                      id: "elem-saas-badge",
                      type: "text",
                      style: { color: "#60a5fa", fontSize: "13px", fontWeight: "700", textAlign: "center" },
                      attributes: { text: "🚀 NEW RELEASE" },
                    },
                    {
                      id: "elem-saas-heading",
                      type: "heading",
                      style: { color: "#ffffff", fontSize: "42px", fontWeight: "800", textAlign: "center", padding: "16px 0px 0px 0px" },
                      attributes: { text: "Build Faster with Plexo" },
                    },
                    {
                      id: "elem-saas-subtext",
                      type: "paragraph",
                      style: { color: "#94a3b8", fontSize: "18px", textAlign: "center", padding: "12px 0px 0px 0px" },
                      attributes: { text: "The visual design engine for email campaigns and high-converting landing pages." },
                    },
                    {
                      id: "elem-saas-cta",
                      type: "button",
                      style: { backgroundColor: "#3b82f6", color: "#ffffff", padding: "14px 32px", borderRadius: "8px", fontWeight: "700", textAlign: "center", margin: "24px auto 0px" },
                      attributes: { text: "Get Started Free", href: "#" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      compiledHtml:
        "<div style=\"background:#0f172a;color:#f8fafc;padding:80px 40px;text-align:center;\"><h1>Build Faster with Plexo</h1><p>The visual design engine for email campaigns and high-converting landing pages.</p></div>",
    },
    {
      name: "Clean Lead Magnet Form",
      designJson: {
        body: {
          style: { backgroundColor: "#ffffff", color: "#1e293b" },
          rows: [
            {
              id: "row-optin-hero",
              style: { padding: "48px 32px", textAlign: "center" },
              columns: [
                {
                  id: "col-optin-hero",
                  width: "100%",
                  elements: [
                    {
                      id: "elem-optin-heading",
                      type: "heading",
                      style: { color: "#0f172a", fontSize: "28px", fontWeight: "700", textAlign: "center" },
                      attributes: { text: "Subscribe to our Newsletter" },
                    },
                    {
                      id: "elem-optin-text",
                      type: "paragraph",
                      style: { color: "#64748b", fontSize: "15px", textAlign: "center", padding: "8px 0px 0px 0px" },
                      attributes: { text: "Get the latest product updates and industry insights straight to your inbox." },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      compiledHtml:
        "<div style=\"padding:48px 32px;text-align:center;\"><h2>Subscribe to our Newsletter</h2><p>Get the latest product updates and industry insights straight to your inbox.</p></div>",
    },
  ];

  for (const tpl of officialLandingPages) {
    const existing = await prisma.template.findFirst({
      where: { userId: user.id, name: tpl.name },
      select: { id: true },
    });
    const data = {
      name: tpl.name,
      kind: TemplateKind.LANDING_PAGE,
      designJson: tpl.designJson,
      compiledHtml: tpl.compiledHtml,
      isOfficial: true,
    };
    if (existing) {
      await prisma.template.update({ where: { id: existing.id }, data });
    } else {
      await prisma.template.create({ data: { userId: user.id, ...data } });
    }
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
