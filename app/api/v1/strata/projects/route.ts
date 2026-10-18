import { NextRequest, NextResponse } from "next/server";
import { authorizeStrata, readJson, strataFail } from "@/lib/strata/server";

/**
 * The person's Strata projects.
 *   GET  → { projects: StrataProjectSummary[] }
 *   POST { name, template: "blank" | "base", brandPrimary? } → { project }  (creates one in Strata)
 * A 401 with kind "expired" means the Strata session ran out — the editor offers "Reconnect".
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeStrata(request, "projects", 120);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json({ projects: await caller.client.listProjects() });
  } catch (err) {
    return strataFail(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeStrata(request, "projects:create", 20);
  if (caller instanceof NextResponse) return caller;
  const body = await readJson(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Give the Strata project a name.", kind: "invalid" }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "That project name is too long — keep it under 80 characters.", kind: "invalid" }, { status: 400 });
  const template = body?.template === "base" ? "base" : body?.template === "blank" ? "blank" : null;
  if (!template) return NextResponse.json({ error: "Choose whether to start from a blank project or Strata's starter set.", kind: "invalid" }, { status: 400 });
  const brandPrimary = typeof body?.brandPrimary === "string" ? body.brandPrimary : undefined;
  try {
    return NextResponse.json({ project: await caller.client.createProject({ name, template, brandPrimary }) }, { status: 201 });
  } catch (err) {
    return strataFail(err);
  }
}
