# Plexo Projects — one-time setup per environment

Everything in docs/plexo-projects/ARCHITECTURE.md deploys through the normal CI workflows.
These are the steps only a person with account access can do, once per environment
(staging, then production).

## 1. GitHub Environment secrets (synced to SSM by the deploy workflows)

| Secret | What it is |
| --- | --- |
| `APP_SECRETS_ENCRYPTION_SECRET` | 32+ random bytes (e.g. `openssl rand -base64 48`). Encrypts app owners' secrets. Never rotate without re-encrypting. |
| `STRATA_TOKEN_ENCRYPTION_SECRET`, `STRATA_API_URL` | Optional: lets people connect Strata from the editor's Branding panel. The secret (32+ random bytes) encrypts each person's Strata session; the URL is Strata's API root including `/v1`. Plexo's Cognito app client id must also be in Strata's `CHARISOL_TRUSTED_CLIENT_IDS`. |
| `PLEXO_GITHUB_APP_ID`, `PLEXO_GITHUB_APP_SLUG`, `PLEXO_GITHUB_APP_PRIVATE_KEY`, `PLEXO_GITHUB_APP_WEBHOOK_SECRET`, `PLEXO_GITHUB_APP_CLIENT_ID`, `PLEXO_GITHUB_APP_CLIENT_SECRET` | The Plexo GitHub App (step 4). |
| `BROWSERBASE_API_KEY` | Already used by site import; SOL's `app_screenshot` uses it too. |

## 2. Deploy order (first time)

1. `STACK_KIND=data` — adds S3 lifecycle rules (deploy zips, screenshots, dependency caches).
2. `STACK_KIND=app-data` — creates the VPC, the Aurora Serverless v2 cluster
   (`plexo-app-db-<env>`, auto-pauses to 0 ACU) and AppDbFn. First deploy takes ~10 minutes.
   The deploy workflows run this step automatically from now on.
3. `STACK_KIND=compute` — build queue, build image (needs Docker on the runner), finalizer,
   function roles. Built automatically by the deploy workflows.
4. `STACK_KIND=published-sites` — adds the `/__plexo/assets/*` and `/__plexo/api/*` behaviors.

Optional tuning (environment variables at deploy time): `APP_DB_MAX_ACU` (default 32 prod /
8 staging), `APP_DB_FN_CONCURRENCY` (100), `PROJECT_BUILD_CONCURRENCY` (50),
`FUNCTIONS_ACCOUNT_ROLE_ARN` (run app server functions in a separate AWS account).

## 3. App-visitor sign-in pool (Google)

"Sign in with Google" in apps goes through a Cognito pool of its own,
`plexo-app-visitors-<env>` (cdk/lib/app-data-stack.ts) — app visitors are not Charisol accounts,
so they never land in the Charisol pool. The stack creates the pool, the Google identity
provider, the hosted-UI domain (`plexo-apps-<env>.auth.us-east-1.amazoncognito.com`) and a
public PKCE client, and writes `APP_SIGNIN_COGNITO_{CLIENT_ID,USER_POOL_ID,DOMAIN}` to SSM.

One-time, before the first app-data deploy:
1. Copy the Google OAuth client into Secrets Manager as `plexo/<env>/app-signin-google`
   (`{"clientId": "...", "clientSecret": "..."}`) — the template only references it.
   (Done for staging and production from `/plexo/<env>/GOOGLE_CLIENT_ID|SECRET`.)
2. After the deploy, add the stack output `AppSigninGoogleRedirectUri`
   (`https://plexo-apps-<env>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`) to that
   Google client's **Authorized redirect URIs** in Google Cloud Console.

## 4. GitHub App (one app for staging and production)

GitHub → Settings → Developer settings → GitHub Apps → New:
- Callback URLs: `https://plexo.charisol.io/api/github/setup` **first**, then
  `https://staging-plexo.charisol.io/api/github/setup`. Tick **Request user authorization
  (OAuth) during installation**.
- Setup URL: `https://plexo.charisol.io/api/github/setup` (tick "Redirect on update").
- Webhook URL: `https://plexo.charisol.io/api/webhooks/github`, with a webhook secret.
- Repository permissions: Contents read & write, Pull requests read & write, Metadata read.
- Subscribe to events: Push, Installation, Installation repositories.
- Generate a private key → `PLEXO_GITHUB_APP_PRIVATE_KEY` (the whole PEM).
- Put the same six `PLEXO_GITHUB_APP_*` values in both GitHub environments.

A GitHub App has one webhook URL and finishes installs on its first callback URL, so
production relays staging's traffic (lib/projects/github/relay.ts, enabled by the
production-only SSM value `PLEXO_GITHUB_RELAY_ORIGIN` the app-data stack writes): every
verified webhook is forwarded to staging unchanged, and an install started on staging is
redirected back to staging's setup route, which checks its own signed state.

## 5. Recommended hardening

- Submit the pages domain (e.g. `plexopages.com`) to the Public Suffix List
  (github.com/publicsuffix/list) so browsers treat every app subdomain as its own site for
  cookies — defence in depth on top of the `__Host-` session cookies.
- Keep `WAF_ENABLED=true` on the published-sites distribution once traffic grows.
