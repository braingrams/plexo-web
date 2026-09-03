import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ApiKey } from "@/lib/db/coreEntities";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Rotates an org's MCP API key: deactivates whatever's currently active under the
// "Plexo MCP AI Integration Key" name and mints a fresh one, returning the raw secret.
// A raw key can never be recovered once hashed (only ApiKey.maskedKey — a display
// placeholder like "plexo_mcp_...ab12" — survives), so every caller that needs to hand
// back a working credential (the interactive /mcp/login page, and the OAuth token
// endpoint's authorization_code grant) has to mint fresh rather than reuse a stored
// record — reusing maskedKey as a credential was the exact bug that caused external MCP
// clients to loop through "session expired" forever.
export async function rotateMcpApiKey(userId: string, organizationId: string): Promise<string> {
  const { data: existingKeys } = await ApiKey.query
    .primary({ organizationId })
    .where((attr, op) => `${op.eq(attr.name, "Plexo MCP AI Integration Key")} AND ${op.eq(attr.isActive, true)}`)
    .go();

  await Promise.all(
    existingKeys.map((key) => ApiKey.patch({ organizationId, id: key.id }).set({ isActive: false }).go()),
  );

  const rawKey = `plexo_mcp_${randomBytes(24).toString("hex")}`;
  const hashedKey = sha256(rawKey);
  const maskedKey = `${rawKey.slice(0, 10)}...${rawKey.slice(-4)}`;

  await ApiKey.create({
    id: randomUUID(),
    userId,
    organizationId,
    name: "Plexo MCP AI Integration Key",
    hashedKey,
    maskedKey,
    useAi: true,
  }).go();

  return rawKey;
}
