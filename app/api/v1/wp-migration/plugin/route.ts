import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { resolveMigrationAccess } from "@/lib/wpMigration/access";
import { COMPANION_PLUGIN_PHP, COMPANION_PLUGIN_README } from "@/lib/wpMigration/companionPlugin";

/** GET — the Plexo Migrator WordPress plugin, as an installable zip (Plugins → Add New → Upload Plugin). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const zip = new JSZip();
  const folder = zip.folder("plexo-migrator")!;
  folder.file("plexo-migrator.php", COMPANION_PLUGIN_PHP);
  folder.file("readme.txt", COMPANION_PLUGIN_README);
  const body = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="plexo-migrator.zip"',
      "Cache-Control": "no-store",
    },
  });
}
