import "dotenv/config";
import { prisma } from "../../server/prisma";

async function main() {
  const rows = await prisma.template.findMany({
    where: { marketplaceStatus: "DRAFT" },
    select: { kind: true, marketplaceCategory: true, priceCents: true, name: true },
  });

  console.log(`Total DRAFT marketplace templates: ${rows.length}`);

  const byCategory = new Map<string, { landing: number; email: number; free: number; paid: number }>();
  for (const r of rows) {
    const cat = r.marketplaceCategory || "(none)";
    const entry = byCategory.get(cat) || { landing: 0, email: 0, free: 0, paid: 0 };
    if (r.kind === "LANDING_PAGE") entry.landing += 1;
    else entry.email += 1;
    if ((r.priceCents || 0) > 0) entry.paid += 1;
    else entry.free += 1;
    byCategory.set(cat, entry);
  }

  for (const [cat, e] of byCategory) {
    console.log(`${cat.padEnd(32)} landing=${e.landing} email=${e.email} free=${e.free} paid=${e.paid}`);
  }

  const dupNames = rows.map((r) => r.name).filter((n, i, arr) => arr.indexOf(n) !== i);
  console.log(`\nDuplicate names: ${dupNames.length === 0 ? "none" : dupNames.join(", ")}`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
