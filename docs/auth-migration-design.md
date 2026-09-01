# Auth migration design — better-auth → Auth.js (DynamoDB-native)

Grounded in the actual current code (`server/auth.ts`, `server/accessControl.ts`,
`plexo-admin/server/adminGuard.ts`), not assumed.

## Why Auth.js over an external vendor (WorkOS)

Originally scoped as a WorkOS integration. Revisited: WorkOS's real advantage was
outsourcing the security-critical credential/session/OAuth layer, which is a legitimate
concern — but `@auth/dynamodb-adapter` (official, maintained, confirmed earlier in this
migration's research) gets the same proven-library benefit while keeping everything in
our own DynamoDB, no external vendor in the login path, and no webhook-sync eventual-
consistency surface. The organizations/members/invitations logic is Plexo's own either
way — neither Auth.js nor WorkOS has that built in — so the incremental value WorkOS
offered over self-hosting was narrower than it first looked. See
`server/authDynamo.ts` for the actual config.

## The role model is two-tier today, and stays two-tier

1. **Platform admin** (`User.adminRole`, enum `SUPERADMIN | SUPPORT | MODERATOR | FINANCE`)
   — Charisol staff managing the platform via `plexo-admin`. Nothing to do with customer
   organizations. Checked by `adminGuard.ts`'s `hasRole()`.
2. **Customer-org role** (better-auth `organization` plugin + our custom `ac`/`roles` in
   `accessControl.ts` — `owner | admin | editor | blogger | commenter | viewer`) — what a
   member of a *customer's* organization can do to that org's templates, blog, commerce,
   domains, billing, API keys, comments, members, and invitations.

`accessControl.ts` itself is framework-agnostic — its only better-auth dependency is the
`createAccessControl` helper used to shape the statements. The permission ladder doesn't
change at all; only what supplies the role string does — today `session.member.role`
from better-auth, after migration a value on our own `Member` DynamoDB item.

## How identity and business data fit together

Auth.js's `@auth/dynamodb-adapter` owns a fixed, standard shape (`User`, `Account`,
`Session`, `VerificationToken`) — just id/name/email/emailVerified/image for the user
record, nothing business-specific. It's configured (`server/authDynamo.ts`) to share the
`plexo-core` table with our own entities, using the same `pk`/`sk`/`GSI1PK`/`GSI1SK`
convention throughout — not a second table.

Plexo's own business data — credits, seller balance, subscription plan, admin role — lives
in our own `User` entity (`lib/db/coreEntities.ts`), keyed by the **same `id`** Auth.js
assigns. No foreign-key field to an external identity is needed (there's no external
identity anymore); the two records simply share an id by convention, the same way a
Prisma `User` row and its related tables always did within one Postgres database.

`Organization` and `Member` are entirely our own construct, unrelated to Auth.js's
adapter schema — same as they'd have been under WorkOS, just without a sync step.

## What Auth.js actually replaces vs. what stays ours

| Today (better-auth) | After migration |
|---|---|
| Credentials, sessions, Google OAuth | Auth.js v5 + `@auth/dynamodb-adapter`, same DynamoDB account, no external vendor |
| `organization`/`member`/`invitation` plugin tables | Our own `Organization`/`Member`/`Invitation` DynamoDB entities — no external system to mirror from |
| `accessControl.ts`'s `ac`/`roles` permission ladder | **Unchanged** — same file, same statements, fed by our own `Member.role` |
| `adminGuard.ts`'s platform-admin check | Same shape, reads `adminRole` off our own DynamoDB `User` item |

## Open, blocked on an external account (not something code can resolve)

- Google Cloud OAuth client (Web application type) for the production redirect URI —
  the only external dependency left, since Google is the identity source Plexo delegates
  to, not the session/org layer itself
- `AUTH_SECRET` (Auth.js's session-signing secret) needs a real generated value — SSM
  placeholder already created at `/plexo/{staging,production}/AUTH_SECRET`
