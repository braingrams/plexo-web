import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { requirePermission } from "@/server/requirePermission";

// Course zips/ebooks/videos can be tens-to-hundreds of MB — buffering the whole file
// through a serverless function body (the pattern app/api/v1/media/upload/route.ts uses
// for small images) risks the request-body ceiling and function memory/timeout. This
// route implements handleUpload's server callback instead, so the browser uploads
// DIRECTLY to Blob (see ProductsClient.tsx's use of @vercel/blob/client's upload()) and
// only a small JSON handshake ever touches this function.
//
// Not scoped to a specific product id (unlike the image upload flow) — a digital file is
// attached to a product's form *before* that product necessarily exists yet (the create
// flow saves the product only once the seller clicks Save), so the path is just
// org-scoped with a fresh random id per upload.
const MAX_DIGITAL_FILE_BYTES = 500 * 1024 * 1024; // 500MB

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role, organizationId } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json()) as HandleUploadBody;

  // The client (ProductsClient.tsx) constructs the pathname as
  // `commerce-digital/${templateId}/${uuid}-${filename}` — reject anything that doesn't
  // match this site's own prefix, so an authenticated-but-misbehaving client can't write
  // into another site's namespace. resolveCommerceAdmin already confirmed templateId
  // belongs to the caller's org, so this is sufficient scoping on its own.
  const expectedPrefix = `commerce-digital/${templateId}/`;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Invalid upload path.");
        }
        return {
          // access:'private' is chosen by the CLIENT call itself (see ProductsClient.tsx);
          // this route only ever runs for an authenticated, permission-checked seller
          // uploading into a path this callback just validated as their own org's.
          allowedContentTypes: undefined, // any file type — a digital product could be anything
          maximumSizeInBytes: MAX_DIGITAL_FILE_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ organizationId }),
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
