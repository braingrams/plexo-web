import { createAccessControl } from "better-auth/plugins";

// `organization`, `member`, and `invitation` resources/actions are NOT ours to name —
// better-auth's own built-in endpoints hardcode these exact checks internally
// (verified against node_modules/better-auth/dist/plugins/organization/routes/*.mjs):
//   createInvitation -> { invitation: ["create"] }, cancelInvitation -> { invitation: ["cancel"] }
//   updateMemberRole -> { member: ["update"] },      removeMember    -> { member: ["delete"] }
//   updateOrganization -> { organization: ["update"] }, deleteOrganization -> { organization: ["delete"] }
// A custom `ac` REPLACES better-auth's default statements rather than extending them, so
// omitting these (or using different action names, e.g. "invite" instead of "create")
// makes hasPermission() reject every role — including Owner — with a 403, since the
// statement it's checking for doesn't exist on any role at all.
//
// `template`/`domain`/`billing`/`apiKey`/`comment` are ours: checked by
// server/requirePermission.ts in our own API routes, modeled after GitHub's
// Read/Triage/Write/Maintain/Admin collaborator ladder (see roles below).
export const ac = createAccessControl({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  template: ["create", "update", "delete", "publish"],
  domain: ["manage"],
  billing: ["manage"],
  apiKey: ["manage"],
  comment: ["create", "resolve"],
  // Blog posts/categories/tags/settings — granted alongside template everywhere below,
  // same Owner/Admin/Editor ladder (a blog post is content ownership, same as a page).
  blog: ["create", "update", "delete", "publish"],
} as const);

// Billing stays with whichever member created the organization (the Owner) —
// see plan §"Explicit scope boundaries". No role below Owner gets billing.manage or
// organization.update/delete (org settings/deletion are Owner-only).
export const roles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    template: ["create", "update", "delete", "publish"],
    domain: ["manage"],
    billing: ["manage"],
    apiKey: ["manage"],
    comment: ["create", "resolve"],
    blog: ["create", "update", "delete", "publish"],
  }),
  admin: ac.newRole({
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    template: ["create", "update", "delete", "publish"],
    domain: ["manage"],
    apiKey: ["manage"],
    comment: ["create", "resolve"],
    blog: ["create", "update", "delete", "publish"],
  }),
  editor: ac.newRole({
    template: ["create", "update", "delete", "publish"],
    comment: ["create", "resolve"],
    blog: ["create", "update", "delete", "publish"],
  }),
  commenter: ac.newRole({
    comment: ["create", "resolve"],
  }),
  // Read-only: can view templates and comment threads, but every mutating
  // statement is absent so hasPermission() rejects all of them.
  viewer: ac.newRole({}),
} as const;

export type OrgRole = keyof typeof roles;
