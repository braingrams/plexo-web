# Plans + regional pricing spec (owner decisions, final)

Plans: FREE $0 · STARTER $9/mo · PRO $19/mo · ENTERPRISE from $99/mo.

| | Free | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Websites | 1 page (homepage only) | 1 site, multi-page | 4 sites | custom |
| Funnels | 0 | 1 | 3 | custom |
| Commerce | no | Plexo payment keys only, 1,000 products | own keys too, 5,000 | 10,000 |
| Blog | no | unlimited | unlimited | unlimited |
| Email templates | 1 | 5 | 20 | custom |
| AI monthly | $0.20 (200 cr) | $1 (1,000) | $2 (2,000) | $3 (3,000) |
| Domains | subdomain only | 1 custom | 3 custom + 1 free domain | 1 free .com + custom |
| Badge | shown | removable | removable | white-label |
| Team seats | none | 2 | 5 | custom (enforce in org invites) |
| Analytics / HTML export flag | no | yes | yes | yes |
| Support label | AI chat | Email | Email + call | Account manager |
Website import, HTML import, MCP, SDK: all plans. White-label: Enterprise only. AI top-ups $1 per 1,000 credits.
14-day trial stays (no extra AI credits; no custom domains, live payments or white-label in trial).

Legacy: everything today's PRO unlocks → STARTER; everything ULTRA unlocks (server apps, Plexo-hosted SDK AI, higher limits) → PRO; ENTERPRISE superset. Existing PRO subscribers become STARTER, ULTRA become PRO; their subscription moves to the new price at next renewal (period end, no proration). Idempotent migration script (dry-run default, `--apply`). Webhooks map legacy metadata.plan PRO/ULTRA correctly forever.

Regional pricing is a DATABASE price book edited in plexo-admin ("Pricing" page). Country groups by default, each with currency, provider, price per plan × interval (yearly = 2 months free) + AI top-up price. Any country can leave its group with its own settings (e.g. South Africa in USD at its own price). Saving goes live immediately (web caches ~60s), with audit trail + validation. Checkout creates provider prices on demand (Stripe price_data/lookup_key; Paystack plan per amount+currency, created and cached) — no deploy, no manual provider setup. Existing subscribers keep their price until renewal.
Seeds: Nigeria NGN Paystack ₦3,000 / ₦7,500 / from ₦39,000, top-up ₦1,500 per 1,000 credits · Ghana GHS 35/85/429 · Kenya KES 450/990/4,990 · South Africa ZAR 69/149/749 (all Paystack) · Rest of Africa USD $5/$12/$59 (Stripe) · Rest of world USD $9/$19/$99 (Stripe).
Region: CloudFront-Viewer-Country (forward it to the dashboard origin in cdk/lib/compute-stack.ts); store billingCountry/billingCurrency at first checkout; "pay in USD instead" switch; correct currency everywhere; no hard-coded prices anywhere.
Paystack plan billing + subscription webhooks; provider-agnostic subscription on the user (provider, id, status, currentPeriodEnd) so lib/plan/* works for both. One Upgrade button, provider picked by region.
Also: review every literal ULTRA; ledger monthly allowance uses effectivePlan; team members inherit the workspace owner's plan; fix plexo-admin plan switch, user/org views, broadcast segments, validate-key "ULTRA", stale lib/subscription.ts + lib/credits.ts; show region/currency in admin.
