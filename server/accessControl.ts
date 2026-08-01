import { createAccessControl } from "better-auth/plugins";

// Resources/actions collaborators can be granted, modeled after GitHub's
// Read/Triage/Write/Maintain/Admin collaborator ladder (see roles below).
export const ac = createAccessControl({
  template: ["create", "update", "delete", "publish"],
  domain: ["manage"],
  member: ["invite", "remove", "updateRole"],
  billing: ["manage"],
  apiKey: ["manage"],
  comment: ["create", "resolve"],
} as const);

// Billing stays with whichever member created the organization (the Owner) —
// see plan §"Explicit scope boundaries". No role below Owner gets billing.manage.
export const roles = {
  owner: ac.newRole({
    template: ["create", "update", "delete", "publish"],
    domain: ["manage"],
    member: ["invite", "remove", "updateRole"],
    billing: ["manage"],
    apiKey: ["manage"],
    comment: ["create", "resolve"],
  }),
  admin: ac.newRole({
    template: ["create", "update", "delete", "publish"],
    domain: ["manage"],
    member: ["invite", "remove", "updateRole"],
    apiKey: ["manage"],
    comment: ["create", "resolve"],
  }),
  editor: ac.newRole({
    template: ["create", "update", "delete", "publish"],
    comment: ["create", "resolve"],
  }),
  commenter: ac.newRole({
    comment: ["create", "resolve"],
  }),
  // Read-only: can view templates and comment threads, but every mutating
  // statement is absent so hasPermission() rejects all of them.
  viewer: ac.newRole({}),
} as const;

export type OrgRole = keyof typeof roles;
