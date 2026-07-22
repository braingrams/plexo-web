# Plexo Web

Next.js dashboard for the Plexo builder — templates, publishing, AI generation (BYOK and system AI), and billing. Consumes `@charisol/plexo-sdk` for the actual drag-and-drop editor.

## Setup

```bash
npm install
cp .env.example .env   # fill in real values, see below
npm run db:generate
npx prisma db push     # applies schema.prisma to your database
npm run dev
```

`npm run build` also runs `npm install @charisol/plexo-sdk@latest` first, so the SDK is always pulled at its latest published version at build time.

## Environment variables

See `.env.example` for the full list with inline comments. Most are self-explanatory (Neon Postgres URLs, Better Auth secret, Maildrip transactional email). Two areas need more than a value pasted in:

### AI (BYOK)

`AI_KEY_ENCRYPTION_SECRET` — any random 32-byte value (base64 is fine). Used to encrypt each account's own AI provider key (`ApiKey.aiApiKey`) at rest. **Rotating this invalidates every previously-stored BYOK key** — there's no re-encryption path across secrets, only `npm run ai:encrypt-keys`, which migrates legacy plaintext rows once.

### Phase 2 billing setup (Stripe + system AI credits)

This is the part that can't be automated — it needs your own Stripe account and provider credentials. Manual steps, in order:

1. **Create a Stripe account** (test mode to start). Get your secret key from the Stripe Dashboard → Developers → API keys, and set `STRIPE_SECRET_KEY`.
2. **Create Products/Prices in Stripe** for:
   - The `PRO` and `ULTRA` subscription plans (recurring, monthly) → set `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ULTRA` to the resulting Price IDs.
   - Three one-off credit top-up packs (small/medium/large — amounts are up to you, see `lib/credits/catalog.ts` for the credit amounts each pack currently grants) → set `STRIPE_PRICE_TOPUP_SMALL` / `STRIPE_PRICE_TOPUP_MEDIUM` / `STRIPE_PRICE_TOPUP_LARGE`.
3. **Register the webhook endpoint** at `/api/webhooks/stripe`:
   - Production: add the endpoint in the Stripe Dashboard → Developers → Webhooks, subscribed to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
   - Local dev: run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (Stripe CLI) and use the signing secret it prints.
4. **Provide a system AI provider key** — this is Plexo's *own* provider account, used to serve AI requests for accounts that haven't configured their own BYOK key. Set `SYSTEM_AI_PROVIDER` (one of `anthropic_claude` / `openai` / `google_gemini`) and the matching `SYSTEM_AI_KEY_*` var. You can provision all three `SYSTEM_AI_KEY_*` vars at once — switching `SYSTEM_AI_PROVIDER` later is then just an env change, no redeploy of secrets, no code change.
5. **Sanity-check the numbers before real money is involved**:
   - `lib/credits/pricing.ts`'s `MODEL_PRICING` — the Anthropic row is real published pricing; the OpenAI/Gemini rows are placeholders and should be checked against each provider's actual billing page.
   - `CREDIT_USD_VALUE` (default `0.001`, i.e. 1000 credits = $1) and the monthly allowances in `lib/subscription.ts`'s `PLAN_MONTHLY_CREDITS` — adjust to whatever margin you want before launch.

Once configured: accounts without a BYOK key use system AI automatically, billed against their credit balance (monthly allowance, reset — not rolled over — every 30 days, plus any purchased top-ups, which never expire). Accounts with a BYOK key are unaffected and never touch credits.
