import { NextResponse } from "next/server";
import { planGateBody, type PlanGateCode } from "./planGate";
import type { PaidPlanId } from "./plans";

/** The 403 every plan limit answers with: plain-words message, a stable code, and the plan that lifts it. */
export function planGateResponse(code: PlanGateCode, message: string, requiredPlan?: PaidPlanId, details: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json(planGateBody(code, message, requiredPlan, details), { status: 403 });
}

import type { LimitGate } from "./limitGates";

/** planGateResponse for a gate built by lib/plan/limitGates.ts. */
export function limitGateResponse(g: LimitGate): NextResponse {
  return planGateResponse(g.code, g.message, g.requiredPlan, g.details);
}
