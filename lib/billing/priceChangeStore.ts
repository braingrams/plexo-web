// Reads the price changes saved by plexo-admin (PriceChange rows, lib/db/coreEntities.ts).

import { PriceChange } from "@/lib/db/coreEntities";
import type { PriceChangeRow } from "./priceChanges";

export async function loadPriceChanges(): Promise<PriceChangeRow[]> {
  const { data } = await PriceChange.query.primary({}).go({ pages: "all" });
  return data.map((r) => ({
    id: r.id,
    version: r.version,
    createdAt: r.createdAt,
    createdByEmail: r.createdByEmail,
    existingSubscribers: r.existingSubscribers as PriceChangeRow["existingSubscribers"],
    effectiveFrom: r.effectiveFrom,
    status: r.status ?? "scheduled",
    startedAt: r.startedAt,
    cancelledAt: r.cancelledAt,
    moveRemovedYearlyToMonthly: r.moveRemovedYearlyToMonthly,
    entries: (r.entries as PriceChangeRow["entries"]) ?? [],
  }));
}

