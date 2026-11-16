# Dashboard versions

Which dashboard a person sees is data, edited by a super admin in plexo-admin (**Versions**), not a hard-coded flag. Switching only changes which screens someone sees. Both dashboards read the same data, so nothing a person has made is ever moved or lost.

## Concepts

- **Registry** (`DashboardVersion` entity, plexo-core table, one partition). One row per version: `id` (`classic`, `v3`, ...; people never see ids), `label` (what people read: "Version 1", "Version 2"), `description`, `whatsNew` (up to 3 bullets for the offer), `status` (beta/stable/retired), `isDefault`, `rolloutMode`, `offerAudience`, `remindAfterDays`, `sortOrder`. Read by `lib/dashboardVersions/store.ts`, cached in memory for 60s per instance (an admin change reaches people within about a minute).
- **Rollout mode**, one per version:
  - `OFF`: nobody. People assigned to it fall back to the default.
  - `SELECTED`: only people in the version's audience (admin adds them; each is `optional` = can switch back, or `locked` = cannot).
  - `OFFERED`: audience = everyone, or only the selected people. They get a "Try Plexo Version 2" dialog when they arrive: **Switch now**, **Maybe later** (asked again after `remindAfterDays`, default 7) or **Don't ask again**. They can switch back from the account menu / Settings -> Profile.
  - `MANDATORY`: everyone moves automatically and cannot switch back. Only an admin can change it.
- **Per-user fields** (`User`): `dashboardVersion` (current id), `dashboardVersionLocked`, `dashboardVersionHistory` (last 50 of `{at, from, to, by: user|admin|rollout, adminId?, note?}`; the last entry is the truth), `dashboardVersionAccess` (`{versionId: "optional"|"locked"}`, the audience) and `dashboardOffers` (`{versionId: {snoozeUntil?, never?}}`). The legacy `dashboardV3` field and `DASHBOARD_V3` env are only read when the registry has no rows.

## Resolution order

`resolveDashboardVersion(user, registry)` in `lib/dashboardVersions/resolve.ts` (pure):

1. Kill switch: env `DASHBOARD_VERSIONS_KILL=classic` forces classic for everyone.
2. Registry empty: legacy (`user.dashboardV3`, else env `DASHBOARD_V3`).
3. A `MANDATORY` version (highest `sortOrder` wins).
4. The user's admin-locked assignment (`dashboardVersionLocked`).
5. The user's own latest choice, if that version is still live (not OFF/retired) and they are still eligible (SELECTED: in the audience; OFFERED: audience matches).
6. The registry default.

Ids with no implementation in `DASHBOARD_VERSIONS` are skipped, so an unknown id lands on classic. `getDashboardVersionState(user)` (`lib/dashboardVersions/state.ts`) wraps it once per request (React `cache`) and also returns the switch targets and the offer. `isDashboardV3(user)` is a sync wrapper using the last registry this instance loaded; prefer `usesNewShell(user)` / `getDashboardVersionState` where you can await.

When a mandatory rollout first moves someone, a history entry "by rollout" is written. If an admin later turns the rollout off, people stay where they were as long as they remain eligible.

## APIs (plexo-web)

- `GET /api/dashboard-version`: resolved state, switch targets, offer.
- `POST /api/dashboard-version {to}`: switch. 403 with a plain message when locked, mandatory, killed, ineligible. Records history by `user`.
- `POST /api/dashboard-version/offer {versionId, action: "later"|"never"}`.

plexo-admin writes go to its own routes (`/api/versions/*`, `/api/users/[id]/dashboard-version`), all audited (`dashboardVersion.*`, `user.dashboard_version*`). Registry and audience changes are super-admin only; per-user moves also allow Support.

## Add a future version

1. Implement its shell. Add an entry to `DASHBOARD_VERSIONS` in `lib/dashboardVersions/versions.ts` (`{ id, shell, defaultLabel, defaultDescription, defaultWhatsNew }`; labels are "Version N"). Reuse a `shell` kind, or add one to `DashboardShellKind` and a branch in `app/dashboard/layout.tsx`.
2. In admin -> Versions -> **Add a future version** (id + name). It starts `OFF`. Write its "what's new" bullets.
3. Roll out with the runbook below. Keep the old version's row until nobody is on it, then mark it `retired`.

## Launch runbook (Version 2)

1. Deploy plexo-web and plexo-admin. In admin -> Versions press **Set up versions** (adds Version 1 + Version 2, carries over anyone with the old per-user switch). If `DASHBOARD_V3` is on in production, do this and then set Version 2 to Mandatory immediately, because once rows exist the env is ignored.
2. **Selected** for staff: paste their emails, "Can switch back".
3. Widen: add testers, then switch to **Offered** (selected people, then everyone). Watch the Users list "Dashboard" column and filter. Raise or lower "Maybe later" days.
4. **Mandatory** when ready: the confirmation shows how many people move. After the announcement email.
5. Emergency: set `DASHBOARD_VERSIONS_KILL=classic` in SSM and restart. Everyone sees classic, nothing is deleted. Or set the version to Off in admin.
6. Rolling back a mandatory rollout: set the mode to Selected/Offered/Off in admin.
