import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { processDeployZip, DeployError } from "@/lib/pub/processDeployZip";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/v1/templates/:id/deploy
 *
 * Single-shot deploy — accepts a multipart form with a `file` field containing a .zip of
 * the build output. Works for zips that fit within Lambda's 6 MB request-payload limit
 * (roughly 4.5 MB unencoded). For larger zips use POST .../deploy/chunk instead.
 *
 * The authenticated user must be a member of the organization that owns the template.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded. POST a multipart form with a 'file' field containing a .zip of your build output." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Only .zip files are accepted. Zip the contents of your dist/ (or out/ or build/) directory." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `Zip exceeds the ${MAX_ZIP_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  try {
    const result = await processDeployZip(buffer, templateId);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Deployed ${result.fileCount} file${result.fileCount !== 1 ? "s" : ""} as a ${result.framework} site. Your domain is now serving the new build.`,
    });
  } catch (err) {
    if (err instanceof DeployError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
