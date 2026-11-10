// The short tag that scopes a stack's SSR function names. Kept free of imports so the CDK app
// (CommonJS under ts-node) and the app's tests can both load it.
// Lives in cdk/lib/ and is re-exported by nothing: lib/appFunctions/ssrNames.ts only reads
// SSR_FUNCTION_SCOPE, which CDK sets from this function.

/** Short tag for a stack's SSR function names: "pr173" for a PR preview, "stg" for staging,
 * "prod" for production. Short so names stay inside Lambda's 64-character limit. */
export function ssrFunctionScope(stackId: string): string {
  const pr = /^pr-(\d+)-plexo$/.exec(stackId);
  if (pr) return `pr${pr[1]}`;
  if (stackId.startsWith("staging")) return "stg";
  return "prod";
}
