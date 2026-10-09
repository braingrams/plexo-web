import { AppSecret, type AppEnv } from "@/lib/db/appEntities";
import { encryptAppSecret, decryptAppSecret, tryDecrypt } from "@/lib/crypto";

// The secrets vault for an app's server functions (API keys for Stripe, OpenAI, …). A
// value is encrypted the moment it's saved and never shown again — the dashboard only ever
// sees names and a 4-character hint. Functions receive them at cold start (functionRuntime
// → /_service/secrets) as `ctx.env` and process.env.

export class SecretError extends Error {}

// Names a function's own runtime sets, which a secret must not shadow.
const RESERVED = /^(AWS_|LAMBDA_|_HANDLER$|_X_AMZN|PLEXO_|NODE_|TZ$|PATH$|LANG$|HOME$)/;

export function validateSecretName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) throw new SecretError("Secret names use capital letters, numbers and underscores, starting with a letter — like STRIPE_SECRET_KEY.");
  if (RESERVED.test(name)) throw new SecretError(`${name} is reserved by Plexo. Pick another name.`);
  return name;
}

export async function listSecrets(templateId: string) {
  const { data } = await AppSecret.query.primary({ templateId }).go({ pages: "all" });
  return data
    .map((s) => ({ name: s.name, scope: s.scope, hint: s.hint ?? null, updatedAt: s.updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

export async function setSecret(templateId: string, input: { name: unknown; value: unknown; scope?: unknown }, updatedBy?: string) {
  const name = validateSecretName(input.name);
  const scope = input.scope === "dev" || input.scope === "live" ? input.scope : "all";
  if (typeof input.value !== "string" || !input.value) throw new SecretError("Enter the secret's value.");
  if (input.value.length > 32_000) throw new SecretError("That value is too long (32 KB at most).");
  const existing = await listSecrets(templateId);
  if (existing.length >= 100 && !existing.some((s) => s.name === name && s.scope === scope)) throw new SecretError("An app can have up to 100 secrets.");
  await AppSecret.put({ templateId, name, scope, ciphertext: encryptAppSecret(input.value), hint: input.value.length > 8 ? input.value.slice(-4) : undefined, updatedBy }).go();
  return { name, scope };
}

export async function deleteSecret(templateId: string, name: string, scope: "all" | "dev" | "live" = "all") {
  await AppSecret.delete({ templateId, name: validateSecretName(name), scope }).go();
}

/** Plaintext secrets for one environment: environment-specific values override "all". */
export async function resolveSecrets(templateId: string, env: AppEnv): Promise<Record<string, string>> {
  const { data } = await AppSecret.query.primary({ templateId }).go({ pages: "all" });
  const out: Record<string, string> = {};
  for (const scope of ["all", env] as const) {
    for (const s of data.filter((x) => x.scope === scope)) {
      const value = tryDecrypt(() => decryptAppSecret(s.ciphertext));
      if (value !== null) out[s.name] = value;
    }
  }
  return out;
}
