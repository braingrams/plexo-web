import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-commerce. Field shapes ported 1:1 from prisma/schema.prisma. Primary partition
// is templateId for everything — matches the Prisma models' own stated scoping comment
// ("Primary scope: the site this belongs to") — so "list every order/cart/booking for
// this site" is a single query per entity type via SK prefix, the same shape
// plexo-admin's dashboards actually need. Each entity's GSI1 is picked for its real
// operational access pattern, not defaulted to "org-wide" mechanically — see the comment
// on each one.

const table = TABLES.commerce;

export const CommerceCategory = new Entity(
  {
    model: { entity: "commerceCategory", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "CATEGORY#${id}" },
      },
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "CATEGORY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceProduct = new Entity(
  {
    model: { entity: "commerceProduct", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      categoryId: { type: "string" },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      description: { type: "string" },
      imageUrl: { type: "string" },
      galleryImageUrls: { type: "any" },
      kind: { type: ["PHYSICAL", "SERVICE", "DIGITAL"] as const, default: "PHYSICAL" },
      priceMinor: { type: "number", required: true },
      currency: { type: "string", default: "NGN" },
      stockQuantity: { type: "number" },
      durationMinutes: { type: "number" },
      digitalDeliveryMethod: { type: ["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"] as const },
      digitalFileUrl: { type: "string" },
      digitalFileName: { type: "string" },
      digitalFileSizeBytes: { type: "number" },
      digitalExternalUrl: { type: "string" },
      digitalAccessInstructions: { type: "string" },
      digitalAccessPasswordEncrypted: { type: "string" },
      digitalMaxDownloads: { type: "number" },
      digitalLinkExpiryDays: { type: "number" },
      metaTitle: { type: "string" },
      metaDescription: { type: "string" },
      ogImageUrl: { type: "string" },
      active: { type: "boolean", default: true },
      suspendedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "PRODUCT#${id}" },
      },
      // Explicitly named in the Prisma model's own comment as a stated future need:
      // "a future all-products-across-every-site admin view."
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "PRODUCT#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceCart = new Entity(
  {
    model: { entity: "commerceCart", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      cartToken: { type: "string", required: true },
      customerEmail: { type: "string" },
      status: { type: ["OPEN", "CONVERTED", "ABANDONED"] as const, default: "OPEN" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "CART#${id}" },
      },
      // The real access pattern: a storefront resolves its cart by the token in the
      // visitor's cookie, not by id (prisma: cartToken @unique).
      byToken: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["cartToken"], template: "CARTTOKEN#${cartToken}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "CART#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceCartItem = new Entity(
  {
    model: { entity: "commerceCartItem", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      cartId: { type: "string", required: true },
      productId: { type: "string", required: true },
      quantity: { type: "number", default: 1 },
      unitPriceMinorSnapshot: { type: "number", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Co-located with its parent cart: SK shares the CART#<cartId> prefix, so a
      // begins_with query on that prefix returns the cart item AND the cart itself
      // (whose own SK is exactly that prefix) in one request.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["cartId", "id"], template: "CART#${cartId}#ITEM#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceOrder = new Entity(
  {
    model: { entity: "commerceOrder", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      orderNumber: { type: "string", required: true },
      cartId: { type: "string" },
      customerEmail: { type: "string", required: true },
      customerName: { type: "string" },
      customerPhone: { type: "string" },
      deliveryMethod: { type: ["PICKUP", "COURIER"] as const },
      deliveryFeeMinor: { type: "number", default: 0 },
      discountCode: { type: "string" },
      discountAmountMinor: { type: "number", default: 0 },
      amountMinor: { type: "number", required: true },
      currency: { type: "string", default: "NGN" },
      status: { type: ["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"] as const, default: "PENDING" },
      fulfillmentStatus: {
        type: ["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"] as const,
        default: "UNFULFILLED",
      },
      paymentProvider: { type: ["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE"] as const, default: "BYO_PAYSTACK" },
      paystackMode: { type: ["TEST", "LIVE"] as const },
      paystackReference: { type: "string" },
      paystackAuthorizationUrl: { type: "string" },
      stripeCheckoutSessionId: { type: "string" },
      stripePaymentIntentId: { type: "string" },
      metadata: { type: "any" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "ORDER#${id}" },
      },
      // The payment-critical lookup: a webhook arrives with a paystackReference or
      // stripeCheckoutSessionId and must find the order synchronously to confirm it.
      // Chosen over orderNumber/customerEmail as the one GSI this table gets for now —
      // those are real gaps (customer order-tracking, admin search), not yet solved,
      // flagged here rather than silently dropped.
      byPaymentRef: {
        index: "GSI1",
        pk: {
          field: "GSI1PK",
          composite: ["paystackReference"],
          template: "PAYREF#${paystackReference}",
        },
        sk: { field: "GSI1SK", composite: ["id"], template: "ORDER#${id}" },
      },
      // The other real gap this table had: customer order-tracking by the human-facing
      // orderNumber (prisma: @unique). customerEmail search deliberately stays off a
      // dedicated GSI — see cdk/lib/data-stack.ts's comment — and goes through the
      // existing Athena/export path instead, since it's an occasional admin-support
      // query, not a latency-sensitive one.
      byOrderNumber: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["orderNumber"], template: "ORDERNUM#${orderNumber}" },
        sk: { field: "GSI2SK", composite: ["id"], template: "ORDER#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceOrderItem = new Entity(
  {
    model: { entity: "commerceOrderItem", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      orderId: { type: "string", required: true },
      productId: { type: "string", required: true },
      nameSnapshot: { type: "string", required: true },
      unitPriceMinor: { type: "number", required: true },
      quantity: { type: "number", default: 1 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Co-located with its parent order, same pattern as CommerceCartItem.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["orderId", "id"], template: "ORDER#${orderId}#ITEM#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceBooking = new Entity(
  {
    model: { entity: "commerceBooking", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      orderId: { type: "string", required: true },
      productId: { type: "string", required: true },
      scheduledStart: { type: "string", required: true },
      scheduledEnd: { type: "string", required: true },
      status: { type: ["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "COMPLETED"] as const, default: "PENDING_PAYMENT" },
      holdExpiresAt: { type: "string" },
      notes: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // SK keyed by orderId, not id — CommerceBooking is a real 1:1 with CommerceOrder
      // (prisma: orderId @unique) and the webhook confirmation flow needs "find this
      // order's booking" as a direct lookup, not a scan or an extra GSI. orderId being
      // unique per booking makes this a valid natural key.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["orderId"], template: "BOOKING#${orderId}" },
      },
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["scheduledStart", "id"], template: "BOOKING#${scheduledStart}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Prisma enforces "no double-booking the same slot" via @@unique([productId,
// scheduledStart]) — a DB-level constraint. DynamoDB's GSIs do NOT enforce uniqueness
// (only a table's own primary key does), so that guarantee has to move to a companion
// lock item whose PRIMARY key IS the slot: create() this in the same TransactWriteItems
// call as the CommerceBooking — a duplicate slot attempt fails the whole transaction on
// this item's attribute_not_exists condition, not a race-prone read-then-write check.
export const CommerceBookingSlotLock = new Entity(
  {
    model: { entity: "commerceBookingSlotLock", version: "1", service: "plexoCommerce" },
    attributes: {
      productId: { type: "string", required: true },
      scheduledStart: { type: "string", required: true },
      bookingId: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["productId"], template: "PRODUCTSLOT#${productId}" },
        sk: { field: "sk", composite: ["scheduledStart"], template: "SLOT#${scheduledStart}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceDiscountCode = new Entity(
  {
    model: { entity: "commerceDiscountCode", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      code: { type: "string", required: true },
      type: { type: ["PERCENT", "FIXED"] as const, required: true },
      value: { type: "number", required: true },
      active: { type: "boolean", default: true },
      expiresAt: { type: "string" },
      usageLimit: { type: "number" },
      usedCount: { type: "number", default: 0 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "DISCOUNT#${id}" },
      },
      // Checkout-time redemption looks up by the code the customer typed, not by id
      // (prisma: @@unique([templateId, code])) — this is the real access pattern.
      byCode: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATEDISCOUNT#${templateId}" },
        sk: { field: "GSI1SK", composite: ["code"], template: "${code}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceAvailabilityRule = new Entity(
  {
    model: { entity: "commerceAvailabilityRule", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      productId: { type: "string", required: true },
      dayOfWeek: { type: "number", required: true },
      startMinute: { type: "number", required: true },
      endMinute: { type: "number", required: true },
      timezone: { type: "string", default: "Africa/Lagos" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "AVAILRULE#${id}" },
      },
      // The booking flow's real need: "what are this product's availability rules,"
      // not an org-wide listing.
      byProduct: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["productId"], template: "PRODUCT#${productId}" },
        sk: { field: "GSI1SK", composite: ["dayOfWeek", "id"], template: "AVAILRULE#${dayOfWeek}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceAvailabilityException = new Entity(
  {
    model: { entity: "commerceAvailabilityException", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      productId: { type: "string", required: true },
      date: { type: "string", required: true },
      closed: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "AVAILEXC#${id}" },
      },
      byProduct: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["productId"], template: "PRODUCT#${productId}" },
        sk: { field: "GSI1SK", composite: ["date", "id"], template: "AVAILEXC#${date}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CommerceProductReview = new Entity(
  {
    model: { entity: "commerceProductReview", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      productId: { type: "string", required: true },
      customerEmail: { type: "string", required: true },
      rating: { type: "number", required: true },
      body: { type: "string" },
      status: { type: ["PENDING", "APPROVED", "REJECTED"] as const, default: "PENDING" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "REVIEW#${id}" },
      },
      // The product page's real need: "reviews for this product," not org-wide.
      byProduct: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["productId"], template: "PRODUCT#${productId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "REVIEW#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Not in the original Phase 3 scope — added because the real Paystack webhook route
// (app/api/webhooks/paystack/[templateId]/route.ts) reads this FIRST, before it can even
// verify a signature: it identifies which site owns the webhook URL and which Paystack
// keys to check the signature against. No webhook confirmation is possible without it.
export const CommerceSettings = new Entity(
  {
    model: { entity: "commerceSettings", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      paystackTestPublicKey: { type: "string" },
      paystackTestSecretKeyEncrypted: { type: "string" },
      paystackLivePublicKey: { type: "string" },
      paystackLiveSecretKeyEncrypted: { type: "string" },
      paystackMode: { type: ["TEST", "LIVE"] as const, default: "TEST" },
      paymentProvider: { type: ["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE"] as const, default: "BYO_PAYSTACK" },
      maildripApiKeyEncrypted: { type: "string" },
      maildripPaidGroupId: { type: "string" },
      maildripNewsletterGroupId: { type: "string" },
      notificationEmail: { type: "string" },
      enabled: { type: "boolean", default: false },
      productDetailTemplateId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // One per template (prisma: templateId @unique) — co-located with everything else
      // scoped to this site.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "SETTINGS" },
      },
    },
  },
  { table, client: docClient },
);

// Also not in the original scope — needed by deliverDigitalProducts (called from
// handleOrderPaid). Prisma's @@unique([orderId, productId]) idempotency guard (a webhook
// retry must never re-deliver/re-email an already-delivered item) has no GSI equivalent
// for the same reason CommerceBookingSlotLock exists — moved into the primary key itself.
export const CommerceDigitalDelivery = new Entity(
  {
    model: { entity: "commerceDigitalDelivery", version: "1", service: "plexoCommerce" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      orderId: { type: "string", required: true },
      productId: { type: "string", required: true },
      method: { type: ["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"] as const, required: true },
      token: { type: "string", required: true },
      fileUrl: { type: "string" },
      fileName: { type: "string" },
      externalUrl: { type: "string" },
      accessInstructions: { type: "string" },
      accessPasswordEncrypted: { type: "string" },
      maxDownloads: { type: "number" },
      downloadCount: { type: "number", default: 0 },
      expiresAt: { type: "string" },
      deliveredAt: { type: "string" },
      resendCount: { type: "number", default: 0 },
      lastResentAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // orderId + productId as the actual primary key — this IS the uniqueness
      // constraint, not just a lookup convenience.
      primary: {
        pk: { field: "pk", composite: ["orderId"], template: "ORDER#${orderId}" },
        sk: { field: "sk", composite: ["productId"], template: "DELIVERY#${productId}" },
      },
      // A buyer clicking their emailed download link resolves by token, not by
      // order+product (prisma: token @unique) — the real access pattern.
      byToken: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["token"], template: "DELIVERYTOKEN#${token}" },
        sk: { field: "GSI1SK", composite: ["orderId", "productId"], template: "DELIVERY#${orderId}#${productId}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoCommerceService = new Service(
  {
    CommerceCategory,
    CommerceProduct,
    CommerceCart,
    CommerceCartItem,
    CommerceOrder,
    CommerceOrderItem,
    CommerceBooking,
    CommerceBookingSlotLock,
    CommerceDiscountCode,
    CommerceAvailabilityRule,
    CommerceAvailabilityException,
    CommerceProductReview,
    CommerceSettings,
    CommerceDigitalDelivery,
  },
  { table, client: docClient },
);
