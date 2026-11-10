// Saves and reads an SSR app's variables. The rules are in ssrVariables.ts; this file does the storage.
import { SsrVariable } from "@/lib/db/appEntities";
import {
  MAX_VARIABLES, RUNTIME_VARIABLE_BYTES, isValidScope, runtimeBytes, runtimeVariablesFor, variableNameProblem, variableValueProblem,
  type StoredVariable, type VariableScope,
} from "@/lib/appFunctions/ssrVariables";

export class VariableError extends Error {}

export type VariableRow = StoredVariable & { updatedAt: string | null; updatedBy: string | null };

export async function listSsrVariables(templateId: string): Promise<VariableRow[]> {
  const { data } = await SsrVariable.query.primary({ templateId }).go({ pages: "all" });
  return data
    .map((v) => ({ name: v.name, scope: v.scope, value: v.value, buildTime: Boolean(v.buildTime), updatedAt: v.updatedAt ?? null, updatedBy: v.updatedBy ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
}

export type VariableInput = { name: unknown; value: unknown; scope?: unknown; buildTime?: unknown };

/** Saves one variable. Refuses it when the function's environment would be too large for either environment. */
export async function upsertSsrVariable(templateId: string, input: VariableInput, updatedBy?: string): Promise<{ name: string; scope: VariableScope }> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const nameProblem = variableNameProblem(name);
  if (nameProblem) throw new VariableError(nameProblem);
  if (typeof input.value !== "string") throw new VariableError("Enter the variable's value.");
  const valueProblem = variableValueProblem(input.value);
  if (valueProblem) throw new VariableError(valueProblem);
  const scope: VariableScope = isValidScope(input.scope) ? input.scope : "all";
  const buildTime = input.buildTime === true;

  const current = await listSsrVariables(templateId);
  const next: StoredVariable[] = [
    ...current.filter((v) => !(v.name === name && v.scope === scope)),
    { name, scope, value: input.value, buildTime },
  ];
  if (next.length > MAX_VARIABLES) throw new VariableError(`An app can have up to ${MAX_VARIABLES} variables.`);
  for (const env of ["dev", "live"] as const) {
    if (runtimeBytes(runtimeVariablesFor(next, env)) > RUNTIME_VARIABLE_BYTES) {
      throw new VariableError(`These variables would be too large for the server's environment (${RUNTIME_VARIABLE_BYTES / 1024} KB in total). Move large or secret values to secrets.`);
    }
  }

  await SsrVariable.put({ templateId, name, scope, value: input.value, buildTime, updatedBy }).go();
  return { name, scope };
}

export async function deleteSsrVariable(templateId: string, name: string, scope: VariableScope = "all"): Promise<void> {
  await SsrVariable.delete({ templateId, name, scope }).go();
}
