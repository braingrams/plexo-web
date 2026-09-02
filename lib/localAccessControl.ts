// Local replacement for better-auth/plugins's createAccessControl/role — this project's
// only use of that package was this pure, in-memory permission-statement checker
// (server/accessControl.ts, server/requirePermissionDynamo.ts's own comment already noted
// it does no I/O at all), so removing the better-auth dependency just means reproducing
// the exact same algorithm here. Ported line-for-line from
// node_modules/better-auth/dist/plugins/access/access.mjs — not reinvented — so every
// existing call site (roles[role].authorize(permission)) keeps working identically.

type Statements = Record<string, readonly string[]>;
type ActionRequest = readonly string[] | { actions: readonly string[]; connector?: "AND" | "OR" };
type PermissionRequest = Record<string, ActionRequest>;
type AuthorizeResult = { success: true } | { success: false; error: string };

function normalizeActionRequest(requested: ActionRequest): { actions: readonly string[]; connector: "AND" | "OR" } {
  if (Array.isArray(requested)) return { actions: requested, connector: "AND" };
  const obj = requested as { actions: readonly string[]; connector?: "AND" | "OR" };
  return { actions: obj.actions, connector: obj.connector === "OR" ? "OR" : "AND" };
}

function isResourceAuthorized(allowedActions: readonly string[], actions: readonly string[], connector: "AND" | "OR"): boolean {
  if (actions.length === 0) return false;
  return connector === "OR" ? actions.some((a) => allowedActions.includes(a)) : actions.every((a) => allowedActions.includes(a));
}

function role<S extends Statements>(statements: S) {
  return {
    statements,
    authorize(request: PermissionRequest, connector: "AND" | "OR" = "AND"): AuthorizeResult {
      let hasAuthorizedResource = false;
      for (const [requestedResource, requestedActions] of Object.entries(request)) {
        const allowedActions = statements[requestedResource];
        if (!allowedActions) {
          if (connector === "AND") return { success: false, error: `You are not allowed to access resource: ${requestedResource}` };
          continue;
        }
        const { actions, connector: actionConnector } = normalizeActionRequest(requestedActions);
        const isAuthorized = isResourceAuthorized(allowedActions, actions, actionConnector);
        if (isAuthorized) hasAuthorizedResource = true;
        if (isAuthorized && connector === "OR") return { success: true };
        if (!isAuthorized && connector === "AND") return { success: false, error: `unauthorized to access resource "${requestedResource}"` };
      }
      return hasAuthorizedResource ? { success: true } : { success: false, error: "Not authorized" };
    },
  };
}

export function createAccessControl<S extends Statements>(statements: S) {
  return {
    statements,
    newRole<RS extends Partial<Record<keyof S, readonly string[]>>>(roleStatements: RS) {
      return role(roleStatements as Statements);
    },
  };
}
