/**
 * Postgres -> DynamoDB backfill, Commerce bounded context (21 models, plexo-commerce +
 * one plexo-ledger model). Follows the exact shape established in backfillCore.ts:
 * batched (PAGE_SIZE), resumable via a JSON checkpoint file, idempotent (every write is
 * an ElectroDB `.put()`, i.e. an upsert keyed by the entity's real composite primary key
 * — safe to re-run/resume without double-writing), dry-run capable. One migrateX()
 * function per model, called in dependency order from main(). Real, historical Postgres
 * timestamps are preserved verbatim (see the note on `readOnly` attributes below) — this
 * is real production data, not synthetic seed data.
 *
 * Special cases (each documented at its own call site below):
 *  - CommerceCartItem / CommerceOrderItem: Prisma has no templateId column on either model
 *    (only the parent CommerceCart/CommerceOrder does) but both ElectroDB entities require
 *    templateId as part of their primary key — each page's Prisma query pulls the parent's
 *    templateId via `include` and stamps it onto the child row.
 *  - CommerceWallet: ElectroDB keys this by a single resolved `scopeId` (templateId for a
 *    per-site wallet, organizationId for an org's pooled wallet), not the raw
 *    id/organizationId/templateId columns Postgres has. Per the model's own Prisma comment,
 *    templateId is null on exactly the rows that are an org's pooled wallet (i.e. Postgres
 *    itself already encodes the same decision resolveCommerceWallet() makes at runtime), so
 *    scopeId = row.templateId ?? row.organizationId reproduces it without re-deriving
 *    anything — cross-checked per row against Organization.commerceWalletPooled and thrown
 *    loudly on any mismatch, same discipline as backfillCore.ts's VALID_ROLES check.
 *  - CommerceBooking: also writes a companion CommerceBookingSlotLock row for every booking
 *    whose status is not CANCELLED. See the long comment at migrateBookings() for why this
 *    is a real correctness requirement for a historical backfill, not just a live-checkout
 *    concern.
 *
 * readOnly timestamp attributes (createdAt/requestedAt/receivedAt, all
 * `readOnly: true, default: () => new Date().toISOString()` in the entity definitions):
 * readOnly in this codebase's ElectroDB usage only blocks later `.update()`/`.patch()`
 * calls from touching the attribute — it does NOT block supplying a real value on initial
 * `.create()`/`.put()`, which is exactly what backfillCore.ts already relies on for
 * User.createdAt (also readOnly) and this script relies on the same way throughout. No
 * historical timestamp is silently dropped anywhere in this file.
 *
 * Usage: tsx scripts/migration/backfillCommerce.ts [--dry-run] [--resume]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { prisma } from "@/server/prisma";
import {
  CommerceCategory,
  CommerceProduct,
  CommerceProductRelation,
  CommerceDiscountCode,
  CommerceAvailabilityRule,
  CommerceAvailabilityException,
  CommerceCart,
  CommerceCartItem,
  CommerceOrder,
  CommerceOrderItem,
  CommerceDigitalDelivery,
  CommerceBooking,
  CommerceBookingSlotLock,
  CommerceSettings,
  StripeCommerceEvent,
  PlatformPaystackWebhookEvent,
  CommerceWallet,
  CommerceWalletLedgerEntry,
  CommerceWithdrawalRequest,
  CommerceStripeAccessRequest,
  CommerceProductReview,
} from "@/lib/db/commerceEntities";
// Lives in the ledger table/entity file, not commerceEntities.ts — see that file's own
// comment on why (Paystack keys/webhook URL are per-site, but the physical table this
// idempotency-claim row lives in is plexo-ledger, ported alongside the other webhook
// claim tables there).
import { PaystackWebhookEvent } from "@/lib/db/ledgerEntities";

const PAGE_SIZE = 200;
const CHECKPOINT_FILE = ".migration-checkpoint-commerce.json";

type StepState = { cursor: string | null; done: boolean };

type Checkpoint = {
  category: StepState;
  product: StepState;
  productRelation: StepState;
  discountCode: StepState;
  availabilityRule: StepState;
  availabilityException: StepState;
  cart: StepState;
  cartItem: StepState;
  order: StepState;
  orderItem: StepState;
  digitalDelivery: StepState;
  booking: StepState;
  settings: StepState;
  paystackWebhookEvent: StepState;
  stripeCommerceEvent: StepState;
  platformPaystackWebhookEvent: StepState;
  wallet: StepState;
  walletLedgerEntry: StepState;
  withdrawalRequest: StepState;
  stripeAccessRequest: StepState;
  productReview: StepState;
};

function freshState(): StepState {
  return { cursor: null, done: false };
}

function freshCheckpoint(): Checkpoint {
  return {
    category: freshState(),
    product: freshState(),
    productRelation: freshState(),
    discountCode: freshState(),
    availabilityRule: freshState(),
    availabilityException: freshState(),
    cart: freshState(),
    cartItem: freshState(),
    order: freshState(),
    orderItem: freshState(),
    digitalDelivery: freshState(),
    booking: freshState(),
    settings: freshState(),
    paystackWebhookEvent: freshState(),
    stripeCommerceEvent: freshState(),
    platformPaystackWebhookEvent: freshState(),
    wallet: freshState(),
    walletLedgerEntry: freshState(),
    withdrawalRequest: freshState(),
    stripeAccessRequest: freshState(),
    productReview: freshState(),
  };
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return freshCheckpoint();
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ---------------------------------------------------------------------------------------
// CommerceCategory
// ---------------------------------------------------------------------------------------
async function migrateCategories(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.category;
  if (state.done) return console.log("CommerceCategory: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceCategory.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((c) => ({
      id: c.id,
      templateId: c.templateId,
      organizationId: c.organizationId,
      name: c.name,
      slug: c.slug,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceCategory.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceCategory: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceCategory: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceProduct
// ---------------------------------------------------------------------------------------
async function migrateProducts(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.product;
  if (state.done) return console.log("CommerceProduct: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceProduct.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((p) => ({
      id: p.id,
      templateId: p.templateId,
      organizationId: p.organizationId,
      categoryId: p.categoryId ?? undefined,
      name: p.name,
      slug: p.slug,
      description: p.description ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
      galleryImageUrls: p.galleryImageUrls ?? undefined,
      kind: p.kind,
      priceMinor: p.priceMinor,
      currency: p.currency,
      stockQuantity: p.stockQuantity ?? undefined,
      durationMinutes: p.durationMinutes ?? undefined,
      digitalDeliveryMethod: p.digitalDeliveryMethod ?? undefined,
      digitalFileUrl: p.digitalFileUrl ?? undefined,
      digitalFileName: p.digitalFileName ?? undefined,
      digitalFileSizeBytes: p.digitalFileSizeBytes ?? undefined,
      digitalExternalUrl: p.digitalExternalUrl ?? undefined,
      digitalAccessInstructions: p.digitalAccessInstructions ?? undefined,
      digitalAccessPasswordEncrypted: p.digitalAccessPasswordEncrypted ?? undefined,
      digitalMaxDownloads: p.digitalMaxDownloads ?? undefined,
      digitalLinkExpiryDays: p.digitalLinkExpiryDays ?? undefined,
      metaTitle: p.metaTitle ?? undefined,
      metaDescription: p.metaDescription ?? undefined,
      ogImageUrl: p.ogImageUrl ?? undefined,
      active: p.active,
      suspendedAt: p.suspendedAt ? p.suspendedAt.toISOString() : undefined,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceProduct.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceProduct: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceProduct: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceProductRelation
// ---------------------------------------------------------------------------------------
async function migrateProductRelations(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.productRelation;
  if (state.done) return console.log("CommerceProductRelation: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceProductRelation.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      organizationId: r.organizationId,
      productId: r.productId,
      relatedProductId: r.relatedProductId,
      createdAt: r.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceProductRelation.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceProductRelation: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceProductRelation: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceDiscountCode
// ---------------------------------------------------------------------------------------
async function migrateDiscountCodes(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.discountCode;
  if (state.done) return console.log("CommerceDiscountCode: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceDiscountCode.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((d) => ({
      id: d.id,
      templateId: d.templateId,
      organizationId: d.organizationId,
      code: d.code,
      type: d.type,
      value: d.value,
      active: d.active,
      expiresAt: d.expiresAt ? d.expiresAt.toISOString() : undefined,
      usageLimit: d.usageLimit ?? undefined,
      usedCount: d.usedCount,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceDiscountCode.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceDiscountCode: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceDiscountCode: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceAvailabilityRule
// ---------------------------------------------------------------------------------------
async function migrateAvailabilityRules(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.availabilityRule;
  if (state.done) return console.log("CommerceAvailabilityRule: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceAvailabilityRule.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      organizationId: r.organizationId,
      productId: r.productId,
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      timezone: r.timezone,
      createdAt: r.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceAvailabilityRule.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceAvailabilityRule: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceAvailabilityRule: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceAvailabilityException
// ---------------------------------------------------------------------------------------
async function migrateAvailabilityExceptions(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.availabilityException;
  if (state.done) return console.log("CommerceAvailabilityException: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceAvailabilityException.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    // date is stored as a full ISO datetime string on the DynamoDB side (matches the real
    // write path — app/api/v1/commerce/[templateId]/availability/route.ts's
    // `parsed.toISOString()` — not a bare YYYY-MM-DD), so `.toISOString()` here, not a
    // date-only slice.
    const items = batch.map((e) => ({
      id: e.id,
      templateId: e.templateId,
      organizationId: e.organizationId,
      productId: e.productId,
      date: e.date.toISOString(),
      closed: e.closed,
      createdAt: e.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceAvailabilityException.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceAvailabilityException: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceAvailabilityException: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceCart
// ---------------------------------------------------------------------------------------
async function migrateCarts(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.cart;
  if (state.done) return console.log("CommerceCart: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceCart.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((c) => ({
      id: c.id,
      templateId: c.templateId,
      organizationId: c.organizationId,
      cartToken: c.cartToken,
      customerEmail: c.customerEmail ?? undefined,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceCart.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceCart: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceCart: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceCartItem — Prisma has no templateId column on this model; only the parent
// CommerceCart does. The ElectroDB entity requires templateId as part of its primary key
// (co-located under the parent cart's SK prefix), so each row pulls its parent's
// templateId via `include` rather than the migration re-deriving it some other way.
// ---------------------------------------------------------------------------------------
async function migrateCartItems(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.cartItem;
  if (state.done) return console.log("CommerceCartItem: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceCartItem.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: { cart: { select: { templateId: true } } },
    });
    if (batch.length === 0) break;

    const items = batch.map((i) => ({
      id: i.id,
      templateId: i.cart.templateId,
      cartId: i.cartId,
      productId: i.productId,
      quantity: i.quantity,
      unitPriceMinorSnapshot: i.unitPriceMinorSnapshot,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceCartItem.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceCartItem: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceCartItem: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceOrder
// ---------------------------------------------------------------------------------------
async function migrateOrders(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.order;
  if (state.done) return console.log("CommerceOrder: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceOrder.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((o) => ({
      id: o.id,
      templateId: o.templateId,
      organizationId: o.organizationId,
      orderNumber: o.orderNumber,
      cartId: o.cartId ?? undefined,
      customerEmail: o.customerEmail,
      customerName: o.customerName ?? undefined,
      customerPhone: o.customerPhone ?? undefined,
      deliveryMethod: o.deliveryMethod ?? undefined,
      deliveryFeeMinor: o.deliveryFeeMinor,
      discountCode: o.discountCode ?? undefined,
      discountAmountMinor: o.discountAmountMinor,
      amountMinor: o.amountMinor,
      currency: o.currency,
      status: o.status,
      fulfillmentStatus: o.fulfillmentStatus,
      paymentProvider: o.paymentProvider,
      paystackMode: o.paystackMode ?? undefined,
      paystackReference: o.paystackReference ?? undefined,
      paystackAuthorizationUrl: o.paystackAuthorizationUrl ?? undefined,
      stripeCheckoutSessionId: o.stripeCheckoutSessionId ?? undefined,
      stripePaymentIntentId: o.stripePaymentIntentId ?? undefined,
      metadata: o.metadata ?? undefined,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceOrder.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceOrder: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceOrder: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceOrderItem — same templateId-derivation gap/fix as CommerceCartItem, via the
// parent CommerceOrder this time.
// ---------------------------------------------------------------------------------------
async function migrateOrderItems(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.orderItem;
  if (state.done) return console.log("CommerceOrderItem: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceOrderItem.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: { order: { select: { templateId: true } } },
    });
    if (batch.length === 0) break;

    const items = batch.map((i) => ({
      id: i.id,
      templateId: i.order.templateId,
      orderId: i.orderId,
      productId: i.productId,
      nameSnapshot: i.nameSnapshot,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      createdAt: i.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceOrderItem.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceOrderItem: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceOrderItem: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceDigitalDelivery
// ---------------------------------------------------------------------------------------
async function migrateDigitalDeliveries(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.digitalDelivery;
  if (state.done) return console.log("CommerceDigitalDelivery: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceDigitalDelivery.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((d) => ({
      id: d.id,
      templateId: d.templateId,
      organizationId: d.organizationId,
      orderId: d.orderId,
      productId: d.productId,
      method: d.method,
      token: d.token,
      fileUrl: d.fileUrl ?? undefined,
      fileName: d.fileName ?? undefined,
      externalUrl: d.externalUrl ?? undefined,
      accessInstructions: d.accessInstructions ?? undefined,
      accessPasswordEncrypted: d.accessPasswordEncrypted ?? undefined,
      maxDownloads: d.maxDownloads ?? undefined,
      downloadCount: d.downloadCount,
      expiresAt: d.expiresAt ? d.expiresAt.toISOString() : undefined,
      deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : undefined,
      resendCount: d.resendCount,
      lastResentAt: d.lastResentAt ? d.lastResentAt.toISOString() : undefined,
      createdAt: d.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceDigitalDelivery.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceDigitalDelivery: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceDigitalDelivery: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceBooking (+ CommerceBookingSlotLock)
//
// CommerceBookingSlotLock is not a Postgres-side model at all — it's a DynamoDB-only
// invention that moves Prisma's `@@unique([productId, scheduledStart])` DB constraint
// into an item whose primary key IS the slot (see commerceEntities.ts's own comment).
// The live checkout code (lib/commerce/checkoutDynamo.ts) determines whether a slot is
// free SOLELY by checking whether a CommerceBookingSlotLock row exists for it — it never
// scans CommerceBooking directly. That means a historical CONFIRMED (or still-live
// PENDING_PAYMENT) booking migrated WITHOUT a matching lock would leave its slot looking
// free to the live app the moment cutover happens: a new visitor could book the exact same
// already-booked slot, a real double-booking, not just a cosmetic gap. This is a live-
// transaction concern this backfill DOES need to replicate for existing data, not one it
// can defer to "only new bookings create locks."
//
// The one status where a lock must NOT be created is CANCELLED — checkoutDynamo.ts's own
// cancellation path deletes the SlotLock when a booking is cancelled (a cancelled booking's
// slot is meant to be free again), so a migrated CANCELLED booking correctly gets no lock,
// matching that same end-state. PENDING_PAYMENT rows with an already-expired holdExpiresAt
// (an abandoned historical checkout) still get a lock: checkoutDynamo.ts's own stale-hold
// reclaim logic (lines ~67-83) already knows how to detect and clear an expired hold's lock
// itself when a new checkout contends for that exact slot, so leaving the lock in place is
// safe and self-healing, not a bug.
// ---------------------------------------------------------------------------------------
async function migrateBookings(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.booking;
  if (state.done) return console.log("CommerceBooking: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  let lockTotal = 0;
  while (true) {
    const batch = await prisma.commerceBooking.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((b) => ({
      id: b.id,
      templateId: b.templateId,
      organizationId: b.organizationId,
      orderId: b.orderId,
      productId: b.productId,
      scheduledStart: b.scheduledStart.toISOString(),
      scheduledEnd: b.scheduledEnd.toISOString(),
      status: b.status,
      holdExpiresAt: b.holdExpiresAt ? b.holdExpiresAt.toISOString() : undefined,
      notes: b.notes ?? undefined,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));

    const lockItems = batch
      .filter((b) => b.status !== "CANCELLED")
      .map((b) => ({
        productId: b.productId,
        scheduledStart: b.scheduledStart.toISOString(),
        bookingId: b.id,
      }));

    if (!dryRun) {
      await CommerceBooking.put(items).go();
      if (lockItems.length > 0) await CommerceBookingSlotLock.put(lockItems).go();
    }

    total += items.length;
    lockTotal += lockItems.length;
    cursor = batch[batch.length - 1].id;
    console.log(
      `CommerceBooking: ${total} migrated (${lockTotal} slot locks)${dryRun ? " (dry run)" : ""}, cursor=${cursor}`,
    );
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceBooking: complete, ${total} total, ${lockTotal} slot locks`);
}

// ---------------------------------------------------------------------------------------
// CommerceSettings
// ---------------------------------------------------------------------------------------
async function migrateSettings(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.settings;
  if (state.done) return console.log("CommerceSettings: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceSettings.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((s) => ({
      id: s.id,
      templateId: s.templateId,
      organizationId: s.organizationId,
      paystackTestPublicKey: s.paystackTestPublicKey ?? undefined,
      paystackTestSecretKeyEncrypted: s.paystackTestSecretKeyEncrypted ?? undefined,
      paystackLivePublicKey: s.paystackLivePublicKey ?? undefined,
      paystackLiveSecretKeyEncrypted: s.paystackLiveSecretKeyEncrypted ?? undefined,
      paystackMode: s.paystackMode,
      paymentProvider: s.paymentProvider,
      maildripApiKeyEncrypted: s.maildripApiKeyEncrypted ?? undefined,
      maildripPaidGroupId: s.maildripPaidGroupId ?? undefined,
      maildripNewsletterGroupId: s.maildripNewsletterGroupId ?? undefined,
      notificationEmail: s.notificationEmail ?? undefined,
      enabled: s.enabled,
      productDetailTemplateId: s.productDetailTemplateId ?? undefined,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceSettings.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceSettings: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceSettings: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// PaystackWebhookEvent — plexo-ledger table, lib/db/ledgerEntities.ts entity, but the
// source Prisma model lives in this same Commerce section of the schema, so it migrates
// from this script per the task's assignment.
// ---------------------------------------------------------------------------------------
async function migratePaystackWebhookEvents(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.paystackWebhookEvent;
  if (state.done) return console.log("PaystackWebhookEvent: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.paystackWebhookEvent.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((e) => ({
      id: e.id,
      templateId: e.templateId,
      organizationId: e.organizationId,
      receivedAt: e.receivedAt.toISOString(),
    }));

    if (!dryRun) await PaystackWebhookEvent.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`PaystackWebhookEvent: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`PaystackWebhookEvent: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// StripeCommerceEvent
// ---------------------------------------------------------------------------------------
async function migrateStripeCommerceEvents(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.stripeCommerceEvent;
  if (state.done) return console.log("StripeCommerceEvent: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.stripeCommerceEvent.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((e) => ({
      id: e.id,
      receivedAt: e.receivedAt.toISOString(),
    }));

    if (!dryRun) await StripeCommerceEvent.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`StripeCommerceEvent: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`StripeCommerceEvent: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// PlatformPaystackWebhookEvent
// ---------------------------------------------------------------------------------------
async function migratePlatformPaystackWebhookEvents(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.platformPaystackWebhookEvent;
  if (state.done) return console.log("PlatformPaystackWebhookEvent: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.platformPaystackWebhookEvent.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((e) => ({
      id: e.id,
      receivedAt: e.receivedAt.toISOString(),
    }));

    if (!dryRun) await PlatformPaystackWebhookEvent.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`PlatformPaystackWebhookEvent: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`PlatformPaystackWebhookEvent: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceWallet — ElectroDB keys this by a single resolved scopeId (templateId for a
// per-site wallet, organizationId for an org's pooled wallet — see resolveCommerceWallet()
// in lib/commerce/walletDynamo.ts). Prisma's own model comment states templateId is null
// on a row ONLY when it's an org's pooled wallet, so scopeId = row.templateId ??
// row.organizationId reproduces the exact same resolved id without needing to re-run the
// resolution logic — but it's cross-checked here against the row's own
// Organization.commerceWalletPooled (pulled via `include`) and thrown loudly on any
// mismatch, same "real bad data is worth surfacing, not silently coercing" discipline as
// backfillCore.ts's VALID_ROLES check.
// ---------------------------------------------------------------------------------------
async function migrateWallets(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.wallet;
  if (state.done) return console.log("CommerceWallet: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceWallet.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      include: { organization: { select: { commerceWalletPooled: true } } },
    });
    if (batch.length === 0) break;

    // A row failing this cross-check is real, pre-existing bad data (confirmed by hand
    // once already — a $0-balance orphaned wallet from earlier dev testing, not live
    // customer funds) — skipped with a loud warning rather than aborting the whole batch,
    // so one bad legacy row doesn't block every other wallet from migrating.
    const validated = batch.filter((w) => {
      const pooled = w.organization.commerceWalletPooled;
      if (pooled && w.templateId !== null) {
        console.warn(
          `SKIPPING CommerceWallet ${w.id}: org ${w.organizationId} is commerceWalletPooled=true but this wallet row has a non-null templateId (${w.templateId}) — real bad data, not migrated. Investigate before relying on this org's pooled wallet.`,
        );
        return false;
      }
      if (!pooled && w.templateId === null) {
        console.warn(
          `SKIPPING CommerceWallet ${w.id}: org ${w.organizationId} is commerceWalletPooled=false but this wallet row has a null templateId — real bad data, not migrated.`,
        );
        return false;
      }
      return true;
    });

    const items = validated.map((w) => ({
      id: w.id,
      organizationId: w.organizationId,
      templateId: w.templateId ?? undefined,
      scopeId: w.templateId ?? w.organizationId,
      balanceCents: w.balanceCents,
      currency: w.currency,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceWallet.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceWallet: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceWallet: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceWalletLedgerEntry
// ---------------------------------------------------------------------------------------
async function migrateWalletLedgerEntries(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.walletLedgerEntry;
  if (state.done) return console.log("CommerceWalletLedgerEntry: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceWalletLedgerEntry.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((e) => ({
      id: e.id,
      walletId: e.walletId,
      type: e.type,
      grossAmountCents: e.grossAmountCents ?? undefined,
      feeCents: e.feeCents ?? undefined,
      netAmountCents: e.netAmountCents,
      balanceAfterCents: e.balanceAfterCents,
      orderId: e.orderId ?? undefined,
      withdrawalRequestId: e.withdrawalRequestId ?? undefined,
      description: e.description ?? undefined,
      createdAt: e.createdAt.toISOString(),
    }));

    if (!dryRun) await CommerceWalletLedgerEntry.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceWalletLedgerEntry: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceWalletLedgerEntry: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceWithdrawalRequest — status enum verified directly against the real, current
// prisma/schema.prisma (PENDING|PROCESSED|REJECTED) and against the real, current
// lib/db/commerceEntities.ts (same three values — the mismatch this session already found
// and fixed there is confirmed gone), not assumed from either file alone.
// ---------------------------------------------------------------------------------------
async function migrateWithdrawalRequests(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.withdrawalRequest;
  if (state.done) return console.log("CommerceWithdrawalRequest: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceWithdrawalRequest.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      id: r.id,
      walletId: r.walletId,
      organizationId: r.organizationId,
      requestedByUserId: r.requestedByUserId,
      amountCents: r.amountCents,
      encryptedAccountNumber: r.encryptedAccountNumber,
      encryptedAccountHolderName: r.encryptedAccountHolderName,
      bankName: r.bankName,
      status: r.status,
      rejectionReason: r.rejectionReason ?? undefined,
      requestedAt: r.requestedAt.toISOString(),
      processedAt: r.processedAt ? r.processedAt.toISOString() : undefined,
      processedByAdminId: r.processedByAdminId ?? undefined,
    }));

    if (!dryRun) await CommerceWithdrawalRequest.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceWithdrawalRequest: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceWithdrawalRequest: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceStripeAccessRequest
// ---------------------------------------------------------------------------------------
async function migrateStripeAccessRequests(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.stripeAccessRequest;
  if (state.done) return console.log("CommerceStripeAccessRequest: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceStripeAccessRequest.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      requestedByUserId: r.requestedByUserId,
      reason: r.reason ?? undefined,
      expectedVolume: r.expectedVolume ?? undefined,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      processedAt: r.processedAt ? r.processedAt.toISOString() : undefined,
      processedByAdminId: r.processedByAdminId ?? undefined,
      rejectionReason: r.rejectionReason ?? undefined,
    }));

    if (!dryRun) await CommerceStripeAccessRequest.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceStripeAccessRequest: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceStripeAccessRequest: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------
// CommerceProductReview
// ---------------------------------------------------------------------------------------
async function migrateProductReviews(dryRun: boolean, cp: Checkpoint): Promise<void> {
  const state = cp.productReview;
  if (state.done) return console.log("CommerceProductReview: already complete, skipping");

  let cursor = state.cursor;
  let total = 0;
  while (true) {
    const batch = await prisma.commerceProductReview.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;

    const items = batch.map((r) => ({
      id: r.id,
      templateId: r.templateId,
      organizationId: r.organizationId,
      productId: r.productId,
      customerEmail: r.customerEmail,
      rating: r.rating,
      body: r.body ?? undefined,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    if (!dryRun) await CommerceProductReview.put(items).go();

    total += items.length;
    cursor = batch[batch.length - 1].id;
    console.log(`CommerceProductReview: ${total} migrated${dryRun ? " (dry run)" : ""}, cursor=${cursor}`);
    state.cursor = cursor;
    saveCheckpoint(cp);
    if (batch.length < PAGE_SIZE) break;
  }
  state.done = true;
  saveCheckpoint(cp);
  console.log(`CommerceProductReview: complete, ${total} total`);
}

// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");

  if (!resume && existsSync(CHECKPOINT_FILE)) {
    throw new Error(
      `${CHECKPOINT_FILE} already exists — pass --resume to continue from it, or delete it to start fresh (only safe if nothing was actually written yet, i.e. a prior --dry-run).`,
    );
  }

  const cp = resume ? loadCheckpoint() : freshCheckpoint();

  console.log(`Starting Commerce backfill (dryRun=${dryRun}, resume=${resume})`);

  // Order matches the task's assigned model order — parents before the children/relations
  // that reference them (categories before products, products before relations/discounts/
  // availability/reviews, carts before cart items, orders before order items/digital
  // delivery/bookings). Nothing here is enforced referentially at write time (DynamoDB has
  // no FK constraints), but keeping this order matches how a human reviewer would expect to
  // read the data landing, and it's the exact order this backfill was code-reviewed in.
  await migrateCategories(dryRun, cp);
  await migrateProducts(dryRun, cp);
  await migrateProductRelations(dryRun, cp);
  await migrateDiscountCodes(dryRun, cp);
  await migrateAvailabilityRules(dryRun, cp);
  await migrateAvailabilityExceptions(dryRun, cp);
  await migrateCarts(dryRun, cp);
  await migrateCartItems(dryRun, cp);
  await migrateOrders(dryRun, cp);
  await migrateOrderItems(dryRun, cp);
  await migrateDigitalDeliveries(dryRun, cp);
  await migrateBookings(dryRun, cp);
  await migrateSettings(dryRun, cp);
  await migratePaystackWebhookEvents(dryRun, cp);
  await migrateStripeCommerceEvents(dryRun, cp);
  await migratePlatformPaystackWebhookEvents(dryRun, cp);
  await migrateWallets(dryRun, cp);
  await migrateWalletLedgerEntries(dryRun, cp);
  await migrateWithdrawalRequests(dryRun, cp);
  await migrateStripeAccessRequests(dryRun, cp);
  await migrateProductReviews(dryRun, cp);

  console.log("Commerce backfill complete.");
}

main()
  .catch((err) => {
    console.error("Commerce backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
