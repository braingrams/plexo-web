/**
 * Usage meters on Plan & billing (sites, AI credits, products, seats): how full each one is and
 * what to say about it. Pure.
 */
export type MeterTone = "ok" | "near" | "full";

export type Meter = { used: number; limit: number | null; pct: number; tone: MeterTone; remaining: number | null };

/** `limit` null = unlimited; 0 = not on this plan. Near at 80%, full at 100%. */
export function usageMeter(used: number, limit: number | null): Meter {
  const u = Math.max(0, Math.floor(used));
  if (limit === null) return { used: u, limit: null, pct: 0, tone: "ok", remaining: null };
  if (limit <= 0) return { used: u, limit: 0, pct: 0, tone: "ok", remaining: 0 };
  const pct = Math.min(100, Math.round((u / limit) * 100));
  return { used: u, limit, pct, tone: u >= limit ? "full" : pct >= 80 ? "near" : "ok", remaining: Math.max(0, limit - u) };
}

/** "2 of 4", "3 (no limit)", "Not on your plan". */
export function meterText(m: Meter, unit?: { one: string; many: string }): string {
  const u = m.used.toLocaleString("en-US");
  if (m.limit === null) return `${u}${unit ? ` ${m.used === 1 ? unit.one : unit.many}` : ""}, no limit`;
  if (m.limit === 0) return "Not on your plan";
  return `${u} of ${m.limit.toLocaleString("en-US")}${unit ? ` ${m.limit === 1 ? unit.one : unit.many}` : ""}`;
}

/** AI credits: the plan's monthly allowance is the "limit"; what's left is the used share inverted. */
export function creditMeter(allowanceLeft: number, monthlyAllowance: number): Meter {
  const left = Math.max(0, allowanceLeft);
  const used = Math.max(0, monthlyAllowance - left);
  return usageMeter(used, monthlyAllowance);
}
