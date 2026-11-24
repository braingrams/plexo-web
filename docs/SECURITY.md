# Security posture

What protects the app today, what is deliberately not done (and why), and where to look when something seems wrong.
Written against the OWASP Top 10 (2021). This is a code and configuration review, not a penetration test.

## What is in place

| Area | Control |
|---|---|
| Transport | HTTPS only end to end. HSTS for one year with subdomains and preload (production). |
| Browser headers (production app and dashboard) | `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, a Content-Security-Policy of safe directives only (`frame-ancestors 'self'; base-uri 'self'; object-src 'none'`), and a Permissions-Policy (camera, microphone, location limited to the app's own origin; USB, serial, Bluetooth, HID, MIDI off). A route that sets its own CSP keeps it. |
| Dependencies | Dependabot (weekly, grouped, security updates included). CI fails on any high or critical advisory in production dependencies (`scripts/audit-gate.mjs`); accepted risks live in `.audit-allowlist.json` with a reason and an expiry date. The same check runs every Monday. |
| Access control | Every API route resolves the signed-in user and checks organisation membership (`resolveUser`, `Member` checks, `requireBlogSiteAccess`). Admin routes also accept only the admin session or the cron secret. |
| Injection | The database layer is parameterised (ElectroDB). Published HTML, blog HTML and form fields are sanitised. JSON-LD is escaped (`safeJsonLd`). Owner-supplied code is analysed and gated (`lib/customCode`). |
| Abuse limits | DynamoDB-backed rate limits on sign-up, password reset, forms and other public endpoints. Forms also use a honeypot, an origin check and an optional captcha. |
| SSRF | Outbound fetches of owner-supplied URLs go through `lib/siteImport/fetchSafe.ts`, which refuses private, loopback and metadata addresses. |
| Secrets | In AWS SSM / GitHub secrets, never in the repository. Signed links use HMAC with a timing-safe compare. |
| Security event trail | `lib/security/events.ts`: rate-limit hits, blocked internal-address requests and form bots leave a short record (masked IP, no secrets, 90-day expiry, repeats collapsed to one row per 10 minutes). Staff read it at `GET /api/internal/security-events?days=1`. |
| Alerts (production) | Five CloudWatch alarms (app function errors, app function throttles, edge 5xx rate, core and content database throttling) through one SNS topic. Set `ALERT_EMAIL` in the deploy environment to get the emails; without it the alarms still show in the console. 5 of the 10 free alarms. |

## Deliberately not done

- **Web application firewall (WAF).** The code to create one exists and stays off (`WAF_ENABLED`). It is a recurring AWS cost.
- **The same headers on staging.** Staging and PR previews skip the response-headers policy (an account limit of 100 policies, and no cost wanted there).
- **CodeQL.** The repository is private, so CodeQL needs paid GitHub Advanced Security. Dependabot and the audit gate cover dependencies; code review covers the rest.
- **`script-src` in the CSP.** The app renders inline scripts and owners can add their own code, so a script policy would break real features until it is built around nonces. Revisit with a report-only rollout.
- **`form-action` in the CSP.** Browsers apply it to the redirect after a form post, which would break sign-in and payment hand-offs.

## Known gaps worth planning

- No automated cross-account (IDOR) test suite; access checks are per route.
- Sign-in is Charisol/Cognito: no login-path masking and no CAPTCHA on the sign-in step.
- The user uploads bucket allows PUT/POST from any origin (it is used with signed URLs).
- Owner-injected scripts on published sites are by design; there is no subresource integrity for them.

## When something looks wrong

1. `GET /api/internal/security-events?days=1` (admin session or cron secret) for recent abuse.
2. CloudWatch alarms (or the alert email) for app health.
3. The Monday dependency check run in GitHub Actions for new advisories.
