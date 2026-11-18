# Strata brand sync: ship order and end-to-end check

## What deploys what

- **Strata** (`charisol-design-system-be`): `deploy-production-staging.yml` runs on every push to `main` and deploys **staging and production**
  (a manual run can pick one). So a merge to `main` ships everything on `main`, which already includes `?source=published`, `NOT_PUBLISHED` and the
  webhook subscription endpoints (commit 40e5483, PR #299), and, once merged, the publish endpoint and the `logo` field (Strata PR #301).
- **Plexo** (`plexo-web`): staging and production workflows deploy on merge to their branches. Plexo PR #298 needs the Strata PR deployed first.

## Order

1. Merge Strata PR #301 to `main`; wait for both deploys to finish. Nothing to configure (no new env vars or tables).
2. Verify on staging with the checklist below (steps 1-6 use only Strata).
3. Merge Plexo PR #298; deploy; run step 7 and 8 on staging first, then production.

Plexo tolerates the wrong order (an old Strata answers 404 to publish, so the site waits for the owner's Publish and the next refresh retries), but
the logo is only read once Strata returns `logo`, so ship Strata first.

## Curl checklist (staging, throwaway account; never use production credentials)

```sh
S=https://<staging Strata API root>/v1      # same value as Plexo's STRATA_API_URL
T=<a throwaway Strata user token>           # the signed-in session token, kept in your shell only
H="Authorization: Bearer $T"
J="Content-Type: application/json"

# 1. create a project (base set, brand colour)
curl -s -X POST "$S/projects?preset=base" -H "$H" -H "$J" -d '{"name":"Deploy check","brandPrimary":"#266DDC"}'   # note the project id as P

# 2. upload the logo: type LOGO, role PRIMARY
curl -s -X POST $S/projects/$P/assets -H "$H" -F type=LOGO -F role=PRIMARY -F name="Logo" -F file=@logo.png

# 3. before publishing: NOT_PUBLISHED
curl -s "$S/projects/$P/design-system?source=published" -H "$H"             # 404 {"error":{"code":"NOT_PUBLISHED"}}

# 4. a read-only integration key (this is what Plexo reads with) and the webhook Plexo needs
curl -s -X POST $S/projects/$P/integration-keys -H "$H" -H "$J" -d '{"name":"Plexo check","scope":"design-system:read"}'   # data.key = K (shown once)
curl -s -X POST $S/projects/$P/webhooks -H "$H" -H "$J" \
  -d '{"url":"https://<plexo staging>/api/v1/strata/webhook","events":["design-system.published"],"description":"Plexo"}'    # data.secret shown once

# 5. publish (owner only), twice: second call is a no-op
curl -s -X POST $S/projects/$P/design-system/publish -H "$H" -H "$J" -d '{}'   # published:true, version:1
curl -s -X POST $S/projects/$P/design-system/publish -H "$H" -H "$J" -d '{}'   # unchanged:true, same version, no webhook

# 6. read it back with the integration key
curl -s "$S/projects/$P/design-system?source=published" -H "Authorization: Bearer $K"   # version, revision, logo {assetId,url,...}
curl -s "$S/projects/$P/design-system/revision?source=published" -H "Authorization: Bearer $K"   # revision + logo, cheap
```

7. **Webhook received.** In Plexo staging, link a throwaway site to project `P` (Brand tab, "Use a Strata brand"; this creates the key and the
   webhook above automatically, so skip the manual key/webhook in step 4 when doing this). Publish a token change in Strata (or
   `PUT design-system` then publish). Within about a minute `GET /api/v1/sites/<id>/brand` shows `lastSource: "webhook"` and `lastResultKind: "updated"`.
8. **Plexo updates the site.** The hosted sheet `/__plexo/brand/<siteId>.css` shows the new value. Replace the logo in Strata
   (`POST /projects/$P/assets/<assetId>/replace`), publish, and the site's header logo changes (same webhook path, or the 15-minute sweep).
   Also check "create a Strata project from my brand" in Plexo: the new project is already published and the site shows no "waiting" note.

Subscription facts: events `design-system.published` (the only one Plexo uses), URL `STRATA_WEBHOOK_URL` or `<NEXT_PUBLIC_APP_URL>/api/v1/strata/webhook`,
secret `whsec_...` returned once by Strata and stored encrypted by Plexo (never in env). Headers: `X-Strata-Signature: v1=<hmac>`, `X-Strata-Timestamp`.
Plexo creates the subscription itself when a site is linked and the 15-minute sweep repairs a missing one. To make one by hand use the curl in step 4.

## Env vars and secrets (names only)

Plexo: `STRATA_API_URL` (Strata API root including `/v1`), `STRATA_TOKEN_ENCRYPTION_SECRET` (encrypts Strata tokens, webhook secrets and keys),
`NEXT_PUBLIC_APP_URL` or `STRATA_WEBHOOK_URL` (the webhook address), `CRON_SECRET` (the 15-minute sweep, `/api/internal/strata-auto-update`),
`NEXT_PUBLIC_CHARISOL_CLIENT_ID` (must be listed in Strata's `CHARISOL_TRUSTED_CLIENT_IDS`). Optional, unrelated to sync: `PLEXO_BRAND_STRATA`,
`PLEXO_BRAND_STRATA_PROJECT_ID`, `STRATA_PUBLIC_API`, `STRATA_SNAPSHOT_BASE`.

Strata: `JSON_WEB_TOKEN_KEY`, `AWS_S3_PROJECT_DATA_BUCKET`, `DYNAMODB_PROJECT_TABLE_NAME`, `DYNAMODB_PROJECT_MEMBER_TABLE_NAME`,
`DYNAMODB_BRAND_ASSET_TABLE_NAME`, `DYNAMODB_WEBHOOK_DELIVERY_TABLE_NAME` (durable webhook retries; without it a failed delivery is not retried),
the assets CDN and snapshot CDN settings (`SNAPSHOT_CDN_DISTRIBUTION_ID` for cache invalidation), `CHARISOL_TRUSTED_CLIENT_IDS` (Plexo's client id),
`CHARISOL_SSO_*` as in the workflow. All are already set by the existing deploy; the publish endpoint adds none.
