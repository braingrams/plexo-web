# Price changes and existing subscribers

Rule (owner decision): a price change affects everyone. New subscribers pay the new price at once
(the price book is live when saved). People who already subscribe move at their **next renewal on or
after the effective date** — never mid-cycle, never prorated, never early. Nobody is charged a new
price until their own renewal. Yearly prices are optional per plan and independent of monthly.

## Data model (shared DynamoDB core table; plexo-admin writes, plexo-web reads/engine)

`PriceBookRecord` (unchanged): the CURRENT prices. `yearly` is `Partial<Record<plan, number | null>>`;
absent/null/0 = not offered yearly. Validation only requires a set yearly price to be > 0.

`PriceChange` (new; `lib/db/coreEntities.ts`): one row per price-book save that changed an amount,
written by admin in the SAME transaction as the book save and the audit row.
`pk=PRICECHANGE`, `sk=CHANGE#<createdAt>#<id>`:

| field | meaning |
|---|---|
| id, version, createdAt, createdByEmail | the save (version = new book version) |
| existingSubscribers | `{when:"next_renewal"}` or `{when:"from_date", effectiveFrom:"YYYY-MM-DD"}` |
| effectiveFrom | ISO; = createdAt for next_renewal, start of the chosen UTC day otherwise |
| status | `scheduled` or `cancelled` |
| startedAt | set by the engine when it first moves someone; after this the date can't change and it can't be cancelled |
| moveRemovedYearlyToMonthly | only for removed yearly prices: admin confirmed moving those people to monthly |
| entries[] | `{groupId, plan, interval, currency, provider, oldAmount, newAmount}`; `newAmount:null` = yearly removed. Whole currency units. Only price lists existing before and after with the same currency get entries |

Admin may edit `effectiveFrom` (>= today) or set `status=cancelled` only while `startedAt` is unset
(conditional write). Cancelling stops moving existing subscribers; it does not revert the book (new
subscribers keep the new price unless the admin edits prices again).

`User` additions: `subscriptionAmountMinor` (what each renewal charges now), `priceChangeKey`
(`effectiveFrom#version` of the last change applied), `priceMovedAt`, `nextAmountMinor`/`nextAmountAt`
(booked new price and the renewal that charges it), `paystackRetireCode/Token` (old Paystack
subscription still to switch off), `priceNoticeKey` (reserved).

## The rule (pure): `lib/billing/priceChanges.ts`

`priceAtNextRenewal(subscriber, book, changes, now)`: considers changes saved after they subscribed and
not yet applied to them; among those whose effectiveFrom <= their renewal date, the latest
(effectiveFrom, then version) wins. Renewal before the date = charged as before; on/after = new price.
Reasons returned for the rest: `group_removed`, `currency_changed` (they keep their own currency),
`cancelling`, `yearly_removed` (left on their last yearly price unless `moveRemovedYearlyToMonthly`),
`no_renewal_date`. `plexo-admin/lib/billing/priceChanges.ts` is an identical copy (like pricing.ts).
`summarizeImpact` / `previewChange` count affected subscribers per price list + plan and the first
charge date; admin uses them for the Review-and-save step and the broadcast draft.

## Engine: `lib/billing/priceMove.ts` (+ `priceMoveLive.ts`)

Idempotent reconcile; finds live renewing subscribers whose renewal is 12h/2h (Paystack/Stripe) to
5 days ahead and whose rule price differs from what they pay. Dry run by default.
- **Stripe**: `subscriptions.update` of the item to a Price made on demand (`ensureStripePlanPrice`)
  with `proration_behavior: "none"` — nothing is charged now, the next invoice uses it. A period
  change (removed yearly → monthly) uses a subscription schedule (phase 1 to period end, phase 2
  monthly) because switching period on a live subscription bills immediately. Subscriptions with an
  existing schedule are skipped and retried.
- **Paystack**: plans are fixed-amount. Create a subscription on the new plan with `start_date` = the
  current `next_payment_date`, save it on the user (old code kept in `paystackRetireCode`), THEN
  disable the old one; a crash between is finished next run (`finishRetire`); an existing active
  subscription on the new plan is reused, never duplicated. The old one is switched off >= 12h before it could charge.
- Provider error: the person is untouched, counted `failed`, retried next run. Removed price list /
  changed currency / yearly removed: skipped and listed in `left`.
- Too close to the charge (< lead time): they pay once more at the old price and move next cycle.

Triggers: `GET /api/internal/price-moves?apply=1` every 3 hours (EventBridge, `x-cron-secret`, same
as `plan-lifecycle`; without `apply=1` it is a dry run and also callable by a signed-in admin), plus
Stripe `invoice.upcoming` and Paystack `invoice.create` webhooks (one person, same code).
Enable `invoice.upcoming` on the Stripe webhook endpoint (and `invoice.create` for Paystack if not sent).

## Owner-facing

Settings > Plan shows "Your price changes to X on <date>. Nothing for you to do." (`ownerNextPrice`);
the one-week renewal reminder states the real next amount and, for a changed price, the old one.

## Contract for plexo-admin

Write `PriceChange` rows in the price-book transaction (shape above; id uuid; version = new book
version). Affected subscribers = live paid users (`subscriptionStatus` ACTIVE/TRIALING, not cancelling)
fed to `summarizeImpact` with the current + proposed book and `previewChange`. Changes saved before
this shipped have no rows and move nobody.
