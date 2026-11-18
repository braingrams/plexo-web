import { randomUUID } from "node:crypto";
import { commerceEnableError, commercePlanForOrg, countStoreProducts, defaultPaymentProvider, paymentProviderError, productLimitError } from "@/lib/plan/commerceGate";
import { catalogFieldsFromInput } from "@/lib/commerce/variants";
import type { resolveUser } from "@/lib/auth/resolveUser";
import { slugify } from "@/server/slugDynamo";
import { encryptDigitalAccessSecret, encryptBankDetail, encryptPaystackKey, encryptMaildripKey, encryptStripeKey, decryptPaystackKey, decryptMaildripKey, decryptStripeKey, tryDecrypt } from "@/lib/crypto";
import { isKnownCurrency, isPaystackCompatibleCurrency } from "@/lib/commerce/currency";
import { ensureProductDetailLayout } from "@/lib/commerce/productDetailLayout";
import { ensureStorefrontLayout, getStorefrontSlug, renameStorefrontSlug } from "@/lib/commerce/storefrontLayout";
import { maskSecret } from "@/lib/commerce/maskSecret";
import { resolveCommerceWallet } from "@/lib/commerce/walletDynamo";
import { resendDigitalDelivery } from "@/lib/commerce/digitalDeliveryDynamo";
import { sendCommerceStripeAccessRequestNotificationEmail, sendCommerceWithdrawalRequestNotificationEmail } from "@/lib/email";
import { resolveCommerceCustomers } from "@/lib/commerce/customers";
import { updateOrderFulfillmentStatus, refundCommerceOrder, deleteCommerceOrder } from "@/lib/commerce/orderStatusActions";
import { resolveBankTransferOrder, withoutOrderSecrets } from "@/lib/commerce/bankTransfer";
import { applyCheckoutSettingsInput, checkoutSettingsView } from "@/lib/commerce/checkoutSettings";
import { Template } from "@/lib/db/contentEntities";
import { Organization, User } from "@/lib/db/coreEntities";
import {
  CommerceProduct,
  CommerceCategory,
  CommerceSettings,
  CommerceOrder,
  CommerceOrderItem,
  CommerceBooking,
  CommerceDigitalDelivery,
  CommerceWallet,
  CommerceWalletLedgerEntry,
  CommerceWithdrawalRequest,
  CommerceStripeAccessRequest,
  CommerceDeliveryMethod,
  CommerceDiscountCode,
} from "@/lib/db/commerceEntities";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Never send the encrypted password ciphertext to a caller — same helper as
// app/api/v1/commerce/[templateId]/products/route.ts's own copy.
function toPublicProduct<T extends { digitalAccessPasswordEncrypted?: string }>(product: T) {
  const { digitalAccessPasswordEncrypted, ...rest } = product;
  return { ...rest, hasDigitalAccessPassword: Boolean(digitalAccessPasswordEncrypted) };
}

/** Every Commerce tool is scoped to a "site" — a root Template (parentId === null) owned by
 * the caller's organization, same convention as resolveBlogSiteId in blogTools.ts. */
async function resolveCommerceSiteId(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const trimmed = typeof templateId === "string" ? templateId.trim() : "";
  if (!trimmed) {
    throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  }
  const { data: site } = await Template.get({ id: trimmed }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${trimmed}" in this account. templateId must be a site's home page (no parent) — use list_landing_pages to find it.`);
  }
  return site.id;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toUpperCase());
}

async function ensureUniqueProductSlug(templateId: string, baseInput: string): Promise<string> {
  const base = slugify(baseInput) || "product";
  const { data: products } = await CommerceProduct.query.primary({ templateId }).go({ pages: "all" });
  const slugs = new Set(products.map((p) => p.slug));
  let candidate = base;
  let suffix = 2;
  while (slugs.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function resolveCategoryId(templateId: string, organizationId: string, categoryName: unknown): Promise<string | null | undefined> {
  if (categoryName === undefined) return undefined;
  if (typeof categoryName !== "string" || !categoryName.trim()) return null;
  const name = categoryName.trim();
  const slug = slugify(name) || "category";
  const { data: categories } = await CommerceCategory.query.primary({ templateId }).go({ pages: "all" });
  const existing = categories.find((c) => c.slug === slug);
  if (existing) {
    if (existing.name !== name) await CommerceCategory.patch({ templateId, id: existing.id }).set({ name }).go();
    return existing.id;
  }
  const id = randomUUID();
  await CommerceCategory.create({ id, templateId, organizationId, name, slug }).go();
  return id;
}

const DIGITAL_PRODUCT_NOTE =
  "For a DIGITAL product, digitalDeliveryMethod is required (FILE_DOWNLOAD, EXTERNAL_LINK, or ACCESS_LIST), plus the matching field: digitalFileUrl (FILE_DOWNLOAD — a URL already uploaded via the dashboard's file upload; this tool cannot itself accept raw file bytes), digitalExternalUrl (EXTERNAL_LINK), or digitalAccessInstructions (ACCESS_LIST, optionally with digitalAccessPassword).";

export const COMMERCE_MCP_TOOLS = [
  {
    name: "list_commerce_products",
    description: "Lists a site's Commerce products (physical, service, or digital), most recently created first.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        kind: { type: "string", enum: ["PHYSICAL", "SERVICE", "DIGITAL"], description: "Optional kind filter." },
        activeOnly: { type: "boolean", description: "If true, only returns products that aren't soft-deleted/deactivated." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_commerce_product",
    description: "Fetches one Commerce product's full details by id.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        productId: { type: "string", description: "The product's id." },
      },
      required: ["templateId", "productId"],
    },
  },
  {
    name: "create_commerce_product",
    description: `Creates a Commerce product — physical (shipped goods, optional stock tracking), service (bookable, has a duration), or digital (a Selar-style download/link/access-list sale, delivered automatically by email once paid). ${DIGITAL_PRODUCT_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        name: { type: "string", description: "Product name." },
        description: { type: "string", description: "Optional description." },
        kind: { type: "string", enum: ["PHYSICAL", "SERVICE", "DIGITAL"], description: "Product kind." },
        priceMinor: { type: "number", description: "Price in the smallest currency unit (kobo for NGN)." },
        imageUrl: { type: "string", description: "Optional cover/main image URL." },
        category: { type: "string", description: "Optional category name — reused if it exists, created otherwise." },
        stockQuantity: { type: "number", description: "PHYSICAL only — starting stock. Omit for untracked stock." },
        compareAtPriceMinor: { type: "number", description: "Optional sale \"was\" price (smallest currency unit), shown crossed out next to the price. Must be higher than the price; omit or null for no sale." },
        sku: { type: "string", description: "Optional SKU / stock code." },
        options: {
          type: "array",
          description: "PHYSICAL/DIGITAL — options the product comes in, e.g. [{name:\"Size\",values:[\"S\",\"M\",\"L\"]},{name:\"Colour\",values:[\"Red\",\"Blue\"]}]. Up to 3. Requires variants. Send [] (with variants: []) to remove options.",
          items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } }, required: ["name", "values"] },
        },
        variants: {
          type: "array",
          description: "One entry per purchasable combination of the options, each with its own price. stockQuantity omitted = unlimited. Pass back an existing variant's id when updating so carts/orders pointing at it stay linked. With variants, the product's own price follows its cheapest variant and its own stockQuantity is ignored.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              options: { type: "object", description: "Option name → value, e.g. {\"Size\":\"M\",\"Colour\":\"Red\"}." },
              priceMinor: { type: "number" },
              compareAtPriceMinor: { type: "number" },
              sku: { type: "string" },
              stockQuantity: { type: "number" },
              imageUrl: { type: "string" },
              active: { type: "boolean", description: "false hides a combination you don't sell." },
            },
            required: ["options", "priceMinor"],
          },
        },
        durationMinutes: { type: "number", description: "SERVICE only — booking duration in minutes." },
        digitalDeliveryMethod: { type: "string", enum: ["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"], description: "DIGITAL only — see this tool's description." },
        digitalFileUrl: { type: "string", description: "DIGITAL/FILE_DOWNLOAD — the uploaded file's URL (upload via the dashboard first)." },
        digitalFileName: { type: "string", description: "DIGITAL/FILE_DOWNLOAD — display name for the file." },
        digitalExternalUrl: { type: "string", description: "DIGITAL/EXTERNAL_LINK — the Drive/Dropbox/etc. link to deliver." },
        digitalAccessInstructions: { type: "string", description: "DIGITAL/ACCESS_LIST — instructions emailed to the buyer." },
        digitalAccessPassword: { type: "string", description: "DIGITAL/ACCESS_LIST — optional static password to include in the delivery email." },
        digitalMaxDownloads: { type: "number", description: "DIGITAL/FILE_DOWNLOAD — max downloads before the link stops working. Omit for unlimited." },
        digitalLinkExpiryDays: { type: "number", description: "DIGITAL/FILE_DOWNLOAD — days until the link expires. Omit for no expiry." },
      },
      required: ["templateId", "name", "kind", "priceMinor"],
    },
  },
  {
    name: "update_commerce_product",
    description: "Edits an existing Commerce product. Only the fields provided are changed. kind cannot be changed after creation — delete and recreate instead.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        productId: { type: "string", description: "The product to update." },
        name: { type: "string" },
        description: { type: "string" },
        priceMinor: { type: "number" },
        imageUrl: { type: "string" },
        category: { type: "string", description: "Category name — reused/created as needed. Empty string clears it." },
        active: { type: "boolean" },
        stockQuantity: { type: "number", description: "PHYSICAL only." },
        compareAtPriceMinor: { type: "number", description: "Optional sale \"was\" price (smallest currency unit), shown crossed out next to the price. Must be higher than the price; omit or null for no sale." },
        sku: { type: "string", description: "Optional SKU / stock code." },
        options: {
          type: "array",
          description: "PHYSICAL/DIGITAL — options the product comes in, e.g. [{name:\"Size\",values:[\"S\",\"M\",\"L\"]},{name:\"Colour\",values:[\"Red\",\"Blue\"]}]. Up to 3. Requires variants. Send [] (with variants: []) to remove options.",
          items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "string" } } }, required: ["name", "values"] },
        },
        variants: {
          type: "array",
          description: "One entry per purchasable combination of the options, each with its own price. stockQuantity omitted = unlimited. Pass back an existing variant's id when updating so carts/orders pointing at it stay linked. With variants, the product's own price follows its cheapest variant and its own stockQuantity is ignored.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              options: { type: "object", description: "Option name → value, e.g. {\"Size\":\"M\",\"Colour\":\"Red\"}." },
              priceMinor: { type: "number" },
              compareAtPriceMinor: { type: "number" },
              sku: { type: "string" },
              stockQuantity: { type: "number" },
              imageUrl: { type: "string" },
              active: { type: "boolean", description: "false hides a combination you don't sell." },
            },
            required: ["options", "priceMinor"],
          },
        },
        durationMinutes: { type: "number", description: "SERVICE only." },
        digitalDeliveryMethod: { type: "string", enum: ["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"], description: "DIGITAL only — switches the delivery method, clearing the other methods' fields." },
        digitalFileUrl: { type: "string" },
        digitalFileName: { type: "string" },
        digitalExternalUrl: { type: "string" },
        digitalAccessInstructions: { type: "string" },
        digitalAccessPassword: { type: "string", description: "Leave unset to keep the current password unchanged." },
        digitalMaxDownloads: { type: "number" },
        digitalLinkExpiryDays: { type: "number" },
      },
      required: ["templateId", "productId"],
    },
  },
  {
    name: "delete_commerce_product",
    description: "Deactivates a Commerce product (soft delete — order history is preserved, the product just stops being sold).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        productId: { type: "string", description: "The product to deactivate." },
      },
      required: ["templateId", "productId"],
    },
  },
  {
    name: "get_commerce_settings",
    description: "Fetches a site's Commerce settings: enabled state, storefront slug/URL, store currency, payment provider, Paystack/Stripe mode/keys (masked), bank transfer details, extra checkout questions, delivery/store-pickup switches and pickup location, MailDrip config, and notification email.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "update_commerce_settings",
    description: `Updates a site's Commerce settings. Only the fields provided are changed. paymentProvider: BYO_PAYSTACK (default — the site's own Paystack keys below), PLATFORM_PAYSTACK (Plexo's own Paystack account, no keys needed, proceeds credit the Commerce wallet), BYO_STRIPE (the site's own Stripe keys below), or PLATFORM_STRIPE (Plexo's own Stripe account — requires prior approval, see request_commerce_stripe_access/get_commerce_stripe_access_status). currency can't be changed once the site has any orders. Bank transfer: set bankTransferEnabled:true together with bankTransferBankName/AccountName/AccountNumber to let customers pay straight into the owner's account — those orders wait for the owner to confirm the money arrived (resolve_bank_transfer_order). Store pickup is on by default (pickupEnabled) — set pickupLocation to the store's address so customers see where to collect; deliveryEnabled:false hides all shipping methods (delivery and pickup can't both be off). checkoutFields replaces the full list of extra checkout questions (a question can be limited to customers delivering to certain countries via its countries list, e.g. tailor details only for Nigeria). Setting enabled:true auto-provisions a working storefront (shop grid, checkout, order confirmation, order tracking) at /store if one doesn't exist yet — rename its URL any time with storefrontSlug.`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        enabled: { type: "boolean", description: "Master on/off switch for Commerce on this site." },
        storefrontSlug: { type: "string", description: "Renames the auto-provisioned storefront page's URL segment (default \"store\", i.e. /store). Commerce must already be enabled. The order-confirmation and track-order pages are never renameable." },
        currency: { type: "string", description: "Site-wide store currency (ISO 4217, e.g. NGN/USD/GBP/EUR/GHS/KES/ZAR). Set this before taking orders — it can't be changed afterward." },
        paymentProvider: { type: "string", enum: ["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE", "BYO_STRIPE"] },
        paystackMode: { type: "string", enum: ["TEST", "LIVE"], description: "Which BYO Paystack key pair is active." },
        paystackTestPublicKey: { type: "string" },
        paystackTestSecretKey: { type: "string" },
        paystackLivePublicKey: { type: "string" },
        paystackLiveSecretKey: { type: "string" },
        stripeMode: { type: "string", enum: ["TEST", "LIVE"], description: "Which BYO Stripe key pair is active." },
        stripeTestPublishableKey: { type: "string" },
        stripeTestSecretKey: { type: "string" },
        stripeTestWebhookSecret: { type: "string", description: "From the site owner's own Stripe Dashboard webhook endpoint (Test mode), signing secret starting with whsec_." },
        stripeLivePublishableKey: { type: "string" },
        stripeLiveSecretKey: { type: "string" },
        stripeLiveWebhookSecret: { type: "string", description: "Same as stripeTestWebhookSecret, for the Live mode webhook endpoint." },
        maildripApiKey: { type: "string" },
        maildripPaidGroupId: { type: "string" },
        maildripNewsletterGroupId: { type: "string" },
        newsletterPopupEnabled: { type: "boolean", description: "Shows a site-wide newsletter signup popup (5s delay/exit-intent, 30-day dismissal). Only takes effect once maildripNewsletterGroupId is also set. Independent of Commerce enabled." },
        notificationEmail: { type: "string" },
        notifyCustomerOnPaid: { type: "boolean", description: "Email the customer an order confirmation once paid. Default true." },
        notifyCustomerOnProcessing: { type: "boolean", description: "Email the customer when fulfillment status changes to PROCESSING. Default true." },
        notifyCustomerOnReadyForPickup: { type: "boolean", description: "Email the customer when fulfillment status changes to READY_FOR_PICKUP. Default true." },
        notifyCustomerOnShipped: { type: "boolean", description: "Email the customer when fulfillment status changes to SHIPPED. Default true." },
        notifyCustomerOnCompleted: { type: "boolean", description: "Email the customer when fulfillment status changes to COMPLETED. Default true." },
        notifyCustomerOnRefunded: { type: "boolean", description: "Email the customer when their order is refunded. Default true." },
        bankTransferEnabled: { type: "boolean", description: "Offer direct bank transfer at checkout. Requires the three bank fields below (already saved or sent in this call)." },
        bankTransferBankName: { type: "string", description: "e.g. \"GTBank\". Shown to customers at checkout." },
        bankTransferAccountName: { type: "string", description: "Name on the account. Shown to customers at checkout." },
        bankTransferAccountNumber: { type: "string", description: "Shown to customers at checkout." },
        bankTransferInstructions: { type: "string", description: "Optional extra note shown with the bank details (e.g. \"Send a screenshot to 080…\"). Empty string clears it." },
        deliveryEnabled: { type: "boolean", description: "false hides every shipping (COURIER) method at checkout. Default true." },
        pickupEnabled: { type: "boolean", description: "The built-in free \"Store pickup\" option at checkout. Default true." },
        pickupLocation: { type: "string", description: "The store's pickup address, shown to customers at checkout and on their order. Empty string clears it." },
        pickupInstructions: { type: "string", description: "Optional pickup hours/notes. Empty string clears it." },
        checkoutFields: {
          type: "array",
          description: "REPLACES the site's whole list of extra checkout questions (send [] to remove all). Keep an existing question's id to preserve it; omit id for a new one.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string", description: "The question, e.g. \"Gift message\"." },
              type: { type: "string", enum: ["text", "textarea", "select", "date", "phone"] },
              required: { type: "boolean" },
              options: { type: "array", items: { type: "string" }, description: "Choices — required (2+) when type is select." },
              placeholder: { type: "string" },
              countries: {
                type: "array",
                items: { type: "string" },
                description: "Optional. Only ask this question when the order ships to one of these countries (ISO 2-letter codes, e.g. [\"NG\"]). Omit or [] to ask everyone. Never asked for pickup orders.",
              },
            },
            required: ["label", "type"],
          },
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "list_commerce_orders",
    description: "Lists a site's Commerce orders (25 per page, most recent first), with optional status/search filters.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        status: { type: "string", enum: ["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"], description: "Optional status filter." },
        q: { type: "string", description: "Optional search across order number, customer email, and customer name." },
        page: { type: "number", description: "1-indexed page number." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_commerce_order",
    description: "Fetches one Commerce order's full details, including line items, booking (if a service), and digital deliveries (if any digital items).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string", description: "The order's id." },
      },
      required: ["templateId", "orderId"],
    },
  },
  {
    name: "resend_digital_delivery",
    description: "Re-sends a digital product's delivery email for an already-paid order, using its existing access link (never generates a new one). Use get_commerce_order first to find the deliveryId.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string", description: "The order." },
        deliveryId: { type: "string", description: "The CommerceDigitalDelivery id (from get_commerce_order's digitalDeliveries)." },
      },
      required: ["templateId", "orderId", "deliveryId"],
    },
  },
  {
    name: "get_commerce_wallet",
    description: "Fetches a site's (or its org's pooled) Commerce wallet balance and recent ledger — the withdrawable balance from Platform Paystack/Platform Stripe sales.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "list_commerce_withdrawals",
    description: "Lists the Commerce wallet's withdrawal requests and their status (PENDING/PROCESSED/REJECTED — processed manually by the Plexo team).",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "request_commerce_withdrawal",
    description: "Requests a manual bank-transfer payout of the Commerce wallet balance. Reserves the amount immediately; processed manually by the Plexo team.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        amountCents: { type: "number", description: "Amount to withdraw, in the smallest currency unit." },
        accountNumber: { type: "string" },
        accountHolderName: { type: "string" },
        bankName: { type: "string" },
      },
      required: ["templateId", "amountCents", "accountNumber", "accountHolderName", "bankName"],
    },
  },
  {
    name: "get_commerce_stripe_access_status",
    description: "Reports the organization's current standing to use Platform Stripe for Commerce checkout (NONE/PENDING/APPROVED/REJECTED). Org-scoped, not per-site.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_commerce_stripe_access",
    description: "Requests staff approval to route Commerce checkout through Plexo's own Stripe account for international payments. Org-scoped — approval covers every site in the organization once granted.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Optional — why Stripe is needed." },
        expectedVolume: { type: "string", description: "Optional — expected monthly volume." },
      },
    },
  },
  {
    name: "list_commerce_delivery_methods",
    description: "Lists a site's configured delivery/fulfillment methods (pickup and/or courier options with fees and country/state restrictions), sorted by their display order.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_commerce_delivery_method",
    description: "Creates a delivery/fulfillment method a customer can choose at checkout.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        name: { type: "string", description: "Shown to the customer at checkout, e.g. \"Store Pickup\" or \"Lagos Courier\"." },
        type: { type: "string", enum: ["PICKUP", "COURIER"] },
        feeMinor: { type: "number", description: "Fee in the smallest currency unit. Defaults to 0." },
        description: { type: "string" },
        countries: { type: "array", items: { type: "string" }, description: "ISO-3166-1 alpha-2 codes this method is restricted to. Omit/empty for worldwide." },
        states: { type: "array", items: { type: "string" }, description: "State/region names this method is restricted to. Omit/empty for unrestricted." },
        estimatedTimeLabel: { type: "string", description: "e.g. \"2-3 business days\"." },
        sortOrder: { type: "number" },
      },
      required: ["templateId", "name", "type"],
    },
  },
  {
    name: "update_commerce_delivery_method",
    description: "Updates a delivery method. Only the fields provided are changed.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        deliveryMethodId: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["PICKUP", "COURIER"] },
        feeMinor: { type: "number" },
        description: { type: "string", description: "Empty string clears it." },
        countries: { type: "array", items: { type: "string" }, description: "Empty array clears the restriction (worldwide)." },
        states: { type: "array", items: { type: "string" }, description: "Empty array clears the restriction." },
        estimatedTimeLabel: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        sortOrder: { type: "number" },
      },
      required: ["templateId", "deliveryMethodId"],
    },
  },
  {
    name: "delete_commerce_delivery_method",
    description: "Permanently deletes a delivery method.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        deliveryMethodId: { type: "string" },
      },
      required: ["templateId", "deliveryMethodId"],
    },
  },
  {
    name: "update_commerce_order",
    description: "Updates an order's fulfillment status (UNFULFILLED/PROCESSING/READY_FOR_PICKUP/SHIPPED/COMPLETED). Payment status is never settable here — it only changes via the payment webhook or refund_commerce_order.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string" },
        fulfillmentStatus: { type: "string", enum: ["UNFULFILLED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"] },
      },
      required: ["templateId", "orderId", "fulfillmentStatus"],
    },
  },
  {
    name: "refund_commerce_order",
    description: "Refunds a PAID order. IRREVERSIBLE — only call this when the site owner has explicitly asked to refund THIS specific order in the current conversation; never as a guess or a follow-up suggestion. First show them the order (get_commerce_order) and get their reason. Gateway orders refund through the Paystack account they were paid with (Paystack-only today — a Stripe-paid order will error). A bank-transfer order is recorded as refunded only — the owner must send the money back themselves; say so. Does not restock inventory or free a booking slot.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string" },
        reason: { type: "string", description: "The owner's stated reason (min 5 characters) — stored on the order as an audit trail." },
        confirmOrderNumber: { type: "string", description: "The order's human-facing number (e.g. ORD-4F2A9C1B), exactly as the owner confirmed it. Must match the order or the refund is refused." },
      },
      required: ["templateId", "orderId", "reason", "confirmOrderNumber"],
    },
  },
  {
    name: "delete_commerce_order",
    description: "PERMANENTLY deletes an order and its items, booking slot and download links. IRREVERSIBLE and unrecoverable — only call this when the site owner has explicitly asked to delete THIS specific order in the current conversation (typically a test order); never as a guess or a clean-up suggestion. First show them the order (get_commerce_order) and tell them it can't be recovered. Refused for orders still waiting on a card payment and for sales processed through Plexo's own payment processing (those must stay on record — refund instead; the error explains). A bank-transfer order still awaiting payment has its stock/slot released. The customer is not notified. Not a refund: if the customer paid, refund them first (refund_commerce_order).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string" },
        confirmOrderNumber: { type: "string", description: "The order's human-facing number (e.g. ORD-4F2A9C1B), exactly as the owner confirmed it. Must match the order or the delete is refused." },
      },
      required: ["templateId", "orderId", "confirmOrderNumber"],
    },
  },
  {
    name: "resolve_bank_transfer_order",
    description: "Confirms or rejects a bank-transfer order that's waiting for payment (status PENDING, paymentMethod BANK_TRANSFER). action \"confirm\" marks it PAID and runs the normal paid flow (customer confirmation email, digital delivery, booking confirmed) — only use it once the site owner says the money has actually arrived in their account. action \"reject\" cancels it, releases its stock/booking slot, and emails the customer (optional reason is included).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        orderId: { type: "string" },
        action: { type: "string", enum: ["confirm", "reject"] },
        reason: { type: "string", description: "Optional note to the customer when rejecting." },
      },
      required: ["templateId", "orderId", "action"],
    },
  },
  {
    name: "list_commerce_discounts",
    description: "Lists a site's discount codes, most recently created first.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_commerce_discount",
    description: "Creates a discount code customers can redeem at checkout.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        code: { type: "string", description: "Case-insensitive; stored uppercased. Must be unique on this site." },
        type: { type: "string", enum: ["PERCENT", "FIXED"] },
        value: { type: "number", description: "A positive integer. For PERCENT, out of 100 (and can't exceed 100). For FIXED, the smallest currency unit." },
        expiresAt: { type: "string", description: "Optional ISO 8601 date/time after which the code stops working." },
        usageLimit: { type: "number", description: "Optional max number of redemptions." },
      },
      required: ["templateId", "code", "type", "value"],
    },
  },
  {
    name: "update_commerce_discount",
    description: "Updates a discount code's active state, expiry, or usage limit. code/type/value can't be changed once created — delete and recreate instead.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        discountId: { type: "string" },
        active: { type: "boolean" },
        expiresAt: { type: "string", description: "Empty string clears the expiry." },
        usageLimit: { type: "number", description: "0 or omitted-as-empty clears the limit." },
      },
      required: ["templateId", "discountId"],
    },
  },
  {
    name: "delete_commerce_discount",
    description: "Permanently deletes a discount code.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        discountId: { type: "string" },
      },
      required: ["templateId", "discountId"],
    },
  },
  {
    name: "list_commerce_customers",
    description: "Lists everyone who's completed a paid order with this site, aggregated from its own orders (works for Stripe or Paystack, however the customer paid).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        page: { type: "number", description: "1-indexed page number." },
      },
      required: ["templateId"],
    },
  },
];

export const COMMERCE_TOOL_NAMES = new Set(COMMERCE_MCP_TOOLS.map((t) => t.name));

export async function handleCommerceTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  switch (toolName) {
    case "list_commerce_products": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: allProducts } = await CommerceProduct.query.primary({ templateId: siteId }).go({ pages: "all" });
      let products = allProducts;
      if (typeof args.kind === "string" && ["PHYSICAL", "SERVICE", "DIGITAL"].includes(args.kind)) products = products.filter((p) => p.kind === args.kind);
      if (args.activeOnly) products = products.filter((p) => p.active ?? true);
      products = [...products].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return { products: products.map(toPublicProduct) };
    }

    case "get_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const { data: product } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!product) throw new Error(`Product not found with id "${productId}".`);
      return { product: toPublicProduct(product) };
    }

    case "create_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");
      if (args.kind !== "PHYSICAL" && args.kind !== "SERVICE" && args.kind !== "DIGITAL") {
        throw new Error("kind must be PHYSICAL, SERVICE, or DIGITAL.");
      }
      const priceMinor = Number(args.priceMinor);
      if (!Number.isInteger(priceMinor) || priceMinor < 0) throw new Error("priceMinor must be a non-negative integer.");

      const kind = args.kind as "PHYSICAL" | "SERVICE" | "DIGITAL";
      if (kind === "DIGITAL") {
        if (!["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"].includes(args.digitalDeliveryMethod)) {
          throw new Error("digitalDeliveryMethod must be FILE_DOWNLOAD, EXTERNAL_LINK, or ACCESS_LIST for a DIGITAL product.");
        }
        if (args.digitalDeliveryMethod === "FILE_DOWNLOAD" && !args.digitalFileUrl) throw new Error("digitalFileUrl is required for FILE_DOWNLOAD.");
        if (args.digitalDeliveryMethod === "EXTERNAL_LINK" && !args.digitalExternalUrl) throw new Error("digitalExternalUrl is required for EXTERNAL_LINK.");
        if (args.digitalDeliveryMethod === "ACCESS_LIST" && !args.digitalAccessInstructions) throw new Error("digitalAccessInstructions is required for ACCESS_LIST.");
      }

      // Sale price, SKU, options/variants — same rules as the dashboard (lib/commerce/variants.ts).
      const catalog = catalogFieldsFromInput(
        { compareAtPriceMinor: args.compareAtPriceMinor, sku: args.sku, options: args.options, variants: args.variants },
        { kind, priceMinor },
      );

      const limitError = productLimitError(await commercePlanForOrg(resolved.organizationId), await countStoreProducts(siteId));
      if (limitError) throw new Error(limitError);

      const slug = await ensureUniqueProductSlug(siteId, name);
      const categoryId = (await resolveCategoryId(siteId, resolved.organizationId, args.category)) ?? undefined;

      const productId = randomUUID();
      await CommerceProduct.create({
        id: productId,
        templateId: siteId,
        organizationId: resolved.organizationId,
        categoryId,
        name,
        slug,
        description: typeof args.description === "string" ? args.description : undefined,
        kind,
        priceMinor,
        imageUrl: typeof args.imageUrl === "string" && args.imageUrl ? args.imageUrl : undefined,
        stockQuantity: kind === "PHYSICAL" && typeof args.stockQuantity === "number" && !catalog.set.variants ? Math.max(0, Math.trunc(args.stockQuantity)) : undefined,
        ...(catalog.set as Record<string, never>),
        durationMinutes: kind === "SERVICE" && typeof args.durationMinutes === "number" ? Math.max(5, Math.trunc(args.durationMinutes)) : undefined,
        digitalDeliveryMethod: kind === "DIGITAL" ? args.digitalDeliveryMethod : undefined,
        digitalFileUrl: kind === "DIGITAL" && args.digitalDeliveryMethod === "FILE_DOWNLOAD" ? String(args.digitalFileUrl) : undefined,
        digitalFileName: kind === "DIGITAL" && args.digitalDeliveryMethod === "FILE_DOWNLOAD" && typeof args.digitalFileName === "string" ? args.digitalFileName : undefined,
        digitalExternalUrl: kind === "DIGITAL" && args.digitalDeliveryMethod === "EXTERNAL_LINK" ? String(args.digitalExternalUrl) : undefined,
        digitalAccessInstructions: kind === "DIGITAL" && args.digitalDeliveryMethod === "ACCESS_LIST" ? String(args.digitalAccessInstructions) : undefined,
        digitalAccessPasswordEncrypted:
          kind === "DIGITAL" && args.digitalDeliveryMethod === "ACCESS_LIST" && typeof args.digitalAccessPassword === "string" && args.digitalAccessPassword
            ? encryptDigitalAccessSecret(args.digitalAccessPassword)
            : undefined,
        digitalMaxDownloads: kind === "DIGITAL" && typeof args.digitalMaxDownloads === "number" ? Math.max(1, Math.trunc(args.digitalMaxDownloads)) : undefined,
        digitalLinkExpiryDays: kind === "DIGITAL" && typeof args.digitalLinkExpiryDays === "number" ? Math.max(1, Math.trunc(args.digitalLinkExpiryDays)) : undefined,
      }).go();
      const { data: product } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!product) throw new Error(`CommerceProduct ${productId} vanished immediately after being created`);

      return { success: true, product: toPublicProduct(product) };
    }

    case "update_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const { data: existing } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!existing) throw new Error(`Product not found with id "${productId}".`);

      if (args.priceMinor !== undefined && (!Number.isInteger(args.priceMinor) || args.priceMinor < 0)) {
        throw new Error("priceMinor must be a non-negative integer.");
      }
      const isDigital = existing.kind === "DIGITAL";
      if (isDigital && args.digitalDeliveryMethod !== undefined && !["FILE_DOWNLOAD", "EXTERNAL_LINK", "ACCESS_LIST"].includes(args.digitalDeliveryMethod)) {
        throw new Error("digitalDeliveryMethod must be FILE_DOWNLOAD, EXTERNAL_LINK, or ACCESS_LIST.");
      }
      const effectiveDeliveryMethod = isDigital ? (args.digitalDeliveryMethod ?? existing.digitalDeliveryMethod) : null;

      const categoryId = await resolveCategoryId(siteId, resolved.organizationId, args.category);

      const data: Record<string, unknown> = {};
      const toRemove: string[] = [];
      if (typeof args.name === "string" && args.name.trim()) data.name = args.name.trim();
      if (args.description !== undefined) {
        if (typeof args.description === "string" && args.description) data.description = args.description;
        else toRemove.push("description");
      }
      if (typeof args.priceMinor === "number") data.priceMinor = args.priceMinor;
      if (args.imageUrl !== undefined) {
        if (typeof args.imageUrl === "string" && args.imageUrl) data.imageUrl = args.imageUrl;
        else toRemove.push("imageUrl");
      }
      if (categoryId !== undefined) {
        if (categoryId) data.categoryId = categoryId;
        else toRemove.push("categoryId");
      }
      if (typeof args.active === "boolean") data.active = args.active;
      if (existing.kind === "PHYSICAL" && typeof args.stockQuantity === "number") data.stockQuantity = Math.max(0, Math.trunc(args.stockQuantity));
      if (existing.kind === "SERVICE" && typeof args.durationMinutes === "number") data.durationMinutes = Math.max(5, Math.trunc(args.durationMinutes));

      if (isDigital) {
        data.digitalDeliveryMethod = effectiveDeliveryMethod;
        if (effectiveDeliveryMethod === "FILE_DOWNLOAD") {
          if (typeof args.digitalFileUrl === "string") {
            if (args.digitalFileUrl) data.digitalFileUrl = args.digitalFileUrl;
            else toRemove.push("digitalFileUrl");
          }
          if (typeof args.digitalFileName === "string") {
            if (args.digitalFileName) data.digitalFileName = args.digitalFileName;
            else toRemove.push("digitalFileName");
          }
          toRemove.push("digitalExternalUrl", "digitalAccessInstructions", "digitalAccessPasswordEncrypted");
        } else if (effectiveDeliveryMethod === "EXTERNAL_LINK") {
          if (typeof args.digitalExternalUrl === "string") {
            if (args.digitalExternalUrl) data.digitalExternalUrl = args.digitalExternalUrl;
            else toRemove.push("digitalExternalUrl");
          }
          toRemove.push("digitalFileUrl", "digitalFileName", "digitalAccessInstructions", "digitalAccessPasswordEncrypted");
        } else if (effectiveDeliveryMethod === "ACCESS_LIST") {
          if (typeof args.digitalAccessInstructions === "string") {
            if (args.digitalAccessInstructions) data.digitalAccessInstructions = args.digitalAccessInstructions;
            else toRemove.push("digitalAccessInstructions");
          }
          if (typeof args.digitalAccessPassword === "string" && args.digitalAccessPassword) {
            data.digitalAccessPasswordEncrypted = encryptDigitalAccessSecret(args.digitalAccessPassword);
          }
          toRemove.push("digitalFileUrl", "digitalFileName", "digitalExternalUrl");
        }
        if (typeof args.digitalMaxDownloads === "number") data.digitalMaxDownloads = Math.max(1, Math.trunc(args.digitalMaxDownloads));
        if (typeof args.digitalLinkExpiryDays === "number") data.digitalLinkExpiryDays = Math.max(1, Math.trunc(args.digitalLinkExpiryDays));
      }

      const catalog = catalogFieldsFromInput(
        { compareAtPriceMinor: args.compareAtPriceMinor, sku: args.sku, options: args.options, variants: args.variants },
        { kind: existing.kind ?? "PHYSICAL", priceMinor: typeof data.priceMinor === "number" ? data.priceMinor : existing.priceMinor },
      );
      Object.assign(data, catalog.set);
      toRemove.push(...catalog.remove);
      if (catalog.set.variants) delete data.stockQuantity;

      let patch = CommerceProduct.patch({ templateId: siteId, id: productId }).set(data);
      const uniqueRemove = [...new Set(toRemove)].filter((f) => !(f in data));
      if (uniqueRemove.length) patch = patch.remove(uniqueRemove as any);
      await patch.go();
      const { data: product } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!product) throw new Error(`CommerceProduct ${productId} vanished immediately after being updated`);

      return { success: true, product: toPublicProduct(product) };
    }

    case "delete_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const { data: existing } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!existing) throw new Error(`Product not found with id "${productId}".`);
      await CommerceProduct.patch({ templateId: siteId, id: productId }).set({ active: false, suspendedAt: new Date().toISOString() }).go();
      const { data: product } = await CommerceProduct.get({ templateId: siteId, id: productId }).go();
      if (!product) throw new Error(`CommerceProduct ${productId} vanished immediately after being updated`);
      return { success: true, product: toPublicProduct(product) };
    }

    case "get_commerce_settings": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: settings } = await CommerceSettings.get({ templateId: siteId }).go();
      const storefrontSlug = await getStorefrontSlug(siteId);
      return {
        settings: {
          enabled: settings?.enabled ?? false,
          storefrontSlug,
          currency: settings?.currency ?? "NGN",
          paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
          paystackMode: settings?.paystackMode ?? "TEST",
          paystackTestPublicKey: settings?.paystackTestPublicKey ?? null,
          paystackLivePublicKey: settings?.paystackLivePublicKey ?? null,
          paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted)) : null,
          paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted)) : null,
          stripeMode: settings?.stripeMode ?? "TEST",
          stripeTestPublishableKey: settings?.stripeTestPublishableKey ?? null,
          stripeLivePublishableKey: settings?.stripeLivePublishableKey ?? null,
          stripeTestSecretKeyMasked: settings?.stripeTestSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestSecretKeyEncrypted!))) : null,
          stripeLiveSecretKeyMasked: settings?.stripeLiveSecretKeyEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveSecretKeyEncrypted!))) : null,
          stripeTestWebhookSecretMasked: settings?.stripeTestWebhookSecretEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeTestWebhookSecretEncrypted!))) : null,
          stripeLiveWebhookSecretMasked: settings?.stripeLiveWebhookSecretEncrypted ? maskSecret(tryDecrypt(() => decryptStripeKey(settings.stripeLiveWebhookSecretEncrypted!))) : null,
          maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
          maildripPaidGroupId: settings?.maildripPaidGroupId ?? null,
          maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? null,
          newsletterPopupEnabled: settings?.newsletterPopupEnabled ?? false,
          notificationEmail: settings?.notificationEmail ?? null,
          notifyCustomerOnPaid: settings?.notifyCustomerOnPaid ?? true,
          notifyCustomerOnProcessing: settings?.notifyCustomerOnProcessing ?? true,
          notifyCustomerOnReadyForPickup: settings?.notifyCustomerOnReadyForPickup ?? true,
          notifyCustomerOnShipped: settings?.notifyCustomerOnShipped ?? true,
          notifyCustomerOnCompleted: settings?.notifyCustomerOnCompleted ?? true,
          notifyCustomerOnRefunded: settings?.notifyCustomerOnRefunded ?? true,
          ...checkoutSettingsView(settings),
        },
      };
    }

    case "update_commerce_settings": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { paystackMode, paymentProvider, stripeMode, currency } = args;
      if (paystackMode !== undefined && paystackMode !== "TEST" && paystackMode !== "LIVE") {
        throw new Error("paystackMode must be TEST or LIVE.");
      }
      if (stripeMode !== undefined && stripeMode !== "TEST" && stripeMode !== "LIVE") {
        throw new Error("stripeMode must be TEST or LIVE.");
      }
      if (paymentProvider !== undefined && !["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE", "BYO_STRIPE"].includes(paymentProvider)) {
        throw new Error("paymentProvider must be BYO_PAYSTACK, PLATFORM_PAYSTACK, PLATFORM_STRIPE, or BYO_STRIPE.");
      }
      const commercePlan = await commercePlanForOrg(resolved.organizationId);
      const planError = (args.enabled === true ? commerceEnableError(commercePlan) : null) ?? paymentProviderError(commercePlan, paymentProvider);
      if (planError) throw new Error(planError);
      if (paymentProvider === "PLATFORM_STRIPE") {
        const { data: requests } = await CommerceStripeAccessRequest.query.primary({ organizationId: resolved.organizationId }).go({ pages: "all" });
        if (!requests.some((r) => r.status === "APPROVED")) throw new Error("Platform Stripe isn't approved for this organization yet — call request_commerce_stripe_access first.");
      }

      let currencyWarning: string | null = null;
      if (currency !== undefined) {
        if (typeof currency !== "string" || !isKnownCurrency(currency)) throw new Error("That currency isn't supported yet.");
        const { data: existingForCurrencyCheck } = await CommerceSettings.get({ templateId: siteId }).go();
        const currentCurrency = existingForCurrencyCheck?.currency ?? "NGN";
        if (currency.toUpperCase() !== currentCurrency.toUpperCase()) {
          const { data: existingOrders } = await CommerceOrder.query.primary({ templateId: siteId }).go({ pages: 1 });
          if (existingOrders.length > 0) {
            throw new Error("Can't change currency after orders exist — existing prices were entered in the current currency and won't be converted.");
          }
        }
        const effectiveProvider = paymentProvider ?? existingForCurrencyCheck?.paymentProvider ?? "BYO_PAYSTACK";
        if ((effectiveProvider === "BYO_PAYSTACK" || effectiveProvider === "PLATFORM_PAYSTACK") && !isPaystackCompatibleCurrency(currency)) {
          currencyWarning = `Paystack may not support charging in ${currency.toUpperCase()} for every merchant account — this depends on your Paystack account's own configuration and can't be verified from here.`;
        }
      }

      const data: Record<string, unknown> = {};
      const toRemove: string[] = [];
      if (typeof args.enabled === "boolean") data.enabled = args.enabled;
      if (typeof currency === "string") data.currency = currency.toUpperCase();
      if (paymentProvider !== undefined) data.paymentProvider = paymentProvider;
      else if (args.enabled === true) {
        const { data: current } = await CommerceSettings.get({ templateId: siteId }).go();
        if (!current?.paymentProvider) data.paymentProvider = defaultPaymentProvider(commercePlan);
      }
      if (paystackMode !== undefined) data.paystackMode = paystackMode;
      if (typeof args.paystackTestPublicKey === "string") {
        if (args.paystackTestPublicKey) data.paystackTestPublicKey = args.paystackTestPublicKey;
        else toRemove.push("paystackTestPublicKey");
      }
      if (typeof args.paystackLivePublicKey === "string") {
        if (args.paystackLivePublicKey) data.paystackLivePublicKey = args.paystackLivePublicKey;
        else toRemove.push("paystackLivePublicKey");
      }
      if (typeof args.paystackTestSecretKey === "string" && args.paystackTestSecretKey) {
        data.paystackTestSecretKeyEncrypted = encryptPaystackKey(args.paystackTestSecretKey);
      }
      if (typeof args.paystackLiveSecretKey === "string" && args.paystackLiveSecretKey) {
        data.paystackLiveSecretKeyEncrypted = encryptPaystackKey(args.paystackLiveSecretKey);
      }
      if (stripeMode !== undefined) data.stripeMode = stripeMode;
      if (typeof args.stripeTestPublishableKey === "string") {
        if (args.stripeTestPublishableKey) data.stripeTestPublishableKey = args.stripeTestPublishableKey;
        else toRemove.push("stripeTestPublishableKey");
      }
      if (typeof args.stripeLivePublishableKey === "string") {
        if (args.stripeLivePublishableKey) data.stripeLivePublishableKey = args.stripeLivePublishableKey;
        else toRemove.push("stripeLivePublishableKey");
      }
      if (typeof args.stripeTestSecretKey === "string" && args.stripeTestSecretKey) {
        data.stripeTestSecretKeyEncrypted = encryptStripeKey(args.stripeTestSecretKey);
      }
      if (typeof args.stripeLiveSecretKey === "string" && args.stripeLiveSecretKey) {
        data.stripeLiveSecretKeyEncrypted = encryptStripeKey(args.stripeLiveSecretKey);
      }
      if (typeof args.stripeTestWebhookSecret === "string" && args.stripeTestWebhookSecret) {
        data.stripeTestWebhookSecretEncrypted = encryptStripeKey(args.stripeTestWebhookSecret);
      }
      if (typeof args.stripeLiveWebhookSecret === "string" && args.stripeLiveWebhookSecret) {
        data.stripeLiveWebhookSecretEncrypted = encryptStripeKey(args.stripeLiveWebhookSecret);
      }
      if (typeof args.maildripApiKey === "string" && args.maildripApiKey) {
        data.maildripApiKeyEncrypted = encryptMaildripKey(args.maildripApiKey);
      }
      if (typeof args.maildripPaidGroupId === "string") {
        if (args.maildripPaidGroupId) data.maildripPaidGroupId = args.maildripPaidGroupId;
        else toRemove.push("maildripPaidGroupId");
      }
      if (typeof args.maildripNewsletterGroupId === "string") {
        if (args.maildripNewsletterGroupId) data.maildripNewsletterGroupId = args.maildripNewsletterGroupId;
        else toRemove.push("maildripNewsletterGroupId");
      }
      if (typeof args.newsletterPopupEnabled === "boolean") data.newsletterPopupEnabled = args.newsletterPopupEnabled;
      if (typeof args.notificationEmail === "string") {
        if (args.notificationEmail) data.notificationEmail = args.notificationEmail;
        else toRemove.push("notificationEmail");
      }
      if (typeof args.notifyCustomerOnPaid === "boolean") data.notifyCustomerOnPaid = args.notifyCustomerOnPaid;
      if (typeof args.notifyCustomerOnProcessing === "boolean") data.notifyCustomerOnProcessing = args.notifyCustomerOnProcessing;
      if (typeof args.notifyCustomerOnReadyForPickup === "boolean") data.notifyCustomerOnReadyForPickup = args.notifyCustomerOnReadyForPickup;
      if (typeof args.notifyCustomerOnShipped === "boolean") data.notifyCustomerOnShipped = args.notifyCustomerOnShipped;
      if (typeof args.notifyCustomerOnCompleted === "boolean") data.notifyCustomerOnCompleted = args.notifyCustomerOnCompleted;
      if (typeof args.notifyCustomerOnRefunded === "boolean") data.notifyCustomerOnRefunded = args.notifyCustomerOnRefunded;

      const { data: existingSettings } = await CommerceSettings.get({ templateId: siteId }).go();
      // Bank transfer / checkout questions / delivery+pickup — same validation as the
      // dashboard's settings PUT (lib/commerce/checkoutSettings.ts); throws a readable error.
      const checkoutInput = applyCheckoutSettingsInput(args, existingSettings);
      Object.assign(data, checkoutInput.data);
      toRemove.push(...checkoutInput.toRemove);
      if (existingSettings) {
        let patch = CommerceSettings.patch({ templateId: siteId }).set(data);
        if (toRemove.length) patch = patch.remove(toRemove as any);
        await patch.go();
      } else {
        await CommerceSettings.create({ id: randomUUID(), templateId: siteId, organizationId: resolved.organizationId, ...data }).go();
      }

      // Mirrors the settings PUT route: auto-provision the starter product page AND the
      // storefront (shop/checkout/confirmation/tracking pages) the moment Commerce is (or
      // becomes) enabled, so this MCP path doesn't leave a site enabled with nothing to sell
      // from just because it didn't go through the dashboard UI.
      const effectiveEnabled = typeof args.enabled === "boolean" ? args.enabled : (existingSettings?.enabled ?? false);
      let storefrontWarning: string | null = null;
      if (effectiveEnabled) {
        await ensureProductDetailLayout(siteId, resolved.organizationId, resolved.userId);
        await ensureStorefrontLayout(siteId, resolved.organizationId, resolved.userId);
      }
      if (typeof args.storefrontSlug === "string" && args.storefrontSlug.trim()) {
        if (!effectiveEnabled) throw new Error("Enable Commerce before renaming the storefront.");
        try {
          await renameStorefrontSlug(siteId, args.storefrontSlug.trim());
        } catch (err) {
          storefrontWarning = err instanceof Error ? err.message : "Failed to rename the storefront.";
        }
      }

      const { data: settings } = await CommerceSettings.get({ templateId: siteId }).go();
      if (!settings) throw new Error(`CommerceSettings for template ${siteId} vanished immediately after being saved`);
      const resolvedStorefrontSlug = await getStorefrontSlug(siteId);

      return {
        success: true,
        settings: {
          enabled: settings.enabled,
          storefrontSlug: resolvedStorefrontSlug,
          currency: settings.currency ?? "NGN",
          paymentProvider: settings.paymentProvider,
          paystackMode: settings.paystackMode,
          stripeMode: settings.stripeMode ?? "TEST",
          notifyCustomerOnPaid: settings.notifyCustomerOnPaid ?? true,
          notifyCustomerOnProcessing: settings.notifyCustomerOnProcessing ?? true,
          notifyCustomerOnReadyForPickup: settings.notifyCustomerOnReadyForPickup ?? true,
          notifyCustomerOnShipped: settings.notifyCustomerOnShipped ?? true,
          notifyCustomerOnCompleted: settings.notifyCustomerOnCompleted ?? true,
          notifyCustomerOnRefunded: settings.notifyCustomerOnRefunded ?? true,
          ...checkoutSettingsView(settings),
        },
        ...(currencyWarning || storefrontWarning ? { warning: [currencyWarning, storefrontWarning].filter(Boolean).join(" ") } : {}),
      };
    }

    case "list_commerce_orders": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const page = Math.max(1, Number(args.page) || 1);
      const pageSize = 25;

      const { data: allOrders } = await CommerceOrder.query.primary({ templateId: siteId }).go({ pages: "all" });
      let filtered = allOrders;
      if (typeof args.status === "string") filtered = filtered.filter((o) => o.status === args.status);
      if (typeof args.q === "string" && args.q.trim()) {
        const q = args.q.trim().toLowerCase();
        filtered = filtered.filter(
          (o) => o.orderNumber.toLowerCase().includes(q) || o.customerEmail.toLowerCase().includes(q) || (o.customerName ?? "").toLowerCase().includes(q),
        );
      }
      filtered = [...filtered].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      const total = filtered.length;
      const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

      const orders = await Promise.all(
        pageRows.map(async (order) => {
          const { data: items } = await CommerceOrderItem.query.primary({ templateId: siteId, orderId: order.id }).go({ pages: "all" });
          return { ...withoutOrderSecrets(order), items: items.map((i) => ({ nameSnapshot: i.nameSnapshot, quantity: i.quantity ?? 1, unitPriceMinor: i.unitPriceMinor })) };
        }),
      );

      return { orders, total, page, pageSize };
    }

    case "get_commerce_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      const { data: order } = await CommerceOrder.get({ templateId: siteId, id: orderId }).go();
      if (!order) throw new Error(`Order not found with id "${orderId}".`);

      const [{ data: items }, { data: booking }, { data: deliveries }] = await Promise.all([
        CommerceOrderItem.query.primary({ templateId: siteId, orderId }).go({ pages: "all" }),
        CommerceBooking.get({ templateId: siteId, orderId }).go(),
        CommerceDigitalDelivery.query.primary({ orderId }).go({ pages: "all" }),
      ]);
      const digitalDeliveries = await Promise.all(
        deliveries.map(async (d) => {
          const { data: product } = await CommerceProduct.get({ templateId: siteId, id: d.productId }).go();
          return {
            id: d.id,
            method: d.method,
            deliveredAt: d.deliveredAt ?? null,
            downloadCount: d.downloadCount ?? 0,
            maxDownloads: d.maxDownloads ?? null,
            resendCount: d.resendCount ?? 0,
            product: { name: product?.name ?? "" },
          };
        }),
      );

      return { order: { ...withoutOrderSecrets(order), items, booking: booking ? { scheduledStart: booking.scheduledStart, status: booking.status } : null, digitalDeliveries } };
    }

    case "resend_digital_delivery": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      const deliveryId = typeof args.deliveryId === "string" ? args.deliveryId.trim() : "";
      if (!orderId || !deliveryId) throw new Error("orderId and deliveryId are required.");
      const delivery = await resendDigitalDelivery(siteId, orderId, deliveryId);
      return { success: true, delivery };
    }

    case "get_commerce_wallet": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: org } = await Organization.get({ id: resolved.organizationId }).go();
      const pooled = org?.commerceWalletPooled ?? false;
      const { data: wallet } = await CommerceWallet.get({ scopeId: pooled ? resolved.organizationId : siteId }).go();
      if (!wallet) return { wallet: { balanceCents: 0, currency: "NGN", pooled }, ledger: [] };
      const { data: ledger } = await CommerceWalletLedgerEntry.query.primary({ walletId: wallet.id }).go({ limit: 25, order: "desc" });
      return { wallet: { balanceCents: wallet.balanceCents ?? 0, currency: wallet.currency ?? "NGN", pooled }, ledger };
    }

    case "list_commerce_withdrawals": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: org } = await Organization.get({ id: resolved.organizationId }).go();
      const pooled = org?.commerceWalletPooled ?? false;
      const { data: wallet } = await CommerceWallet.get({ scopeId: pooled ? resolved.organizationId : siteId }).go();
      if (!wallet) return { withdrawals: [] };
      const { data: withdrawals } = await CommerceWithdrawalRequest.query.primary({ walletId: wallet.id }).go({ order: "desc" });
      return { withdrawals };
    }

    case "request_commerce_withdrawal": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const amountCents = Number(args.amountCents);
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer.");
      const accountNumber = typeof args.accountNumber === "string" ? args.accountNumber.trim() : "";
      const accountHolderName = typeof args.accountHolderName === "string" ? args.accountHolderName.trim() : "";
      const bankName = typeof args.bankName === "string" ? args.bankName.trim() : "";
      if (!accountNumber || !accountHolderName || !bankName) throw new Error("accountNumber, accountHolderName, and bankName are required.");

      const wallet = await resolveCommerceWallet(siteId, resolved.organizationId);

      let balanceCents = 0;
      let nextBalance = 0;
      const MAX_RETRIES = 5;
      let claimed = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !claimed; attempt++) {
        const { data: current } = await CommerceWallet.get({ scopeId: wallet.scopeId }).go();
        if (!current) throw new Error("Wallet not found.");
        balanceCents = current.balanceCents ?? 0;
        if (amountCents > balanceCents) throw new Error("Requested amount exceeds the wallet's available balance.");
        nextBalance = balanceCents - amountCents;
        try {
          await CommerceWallet.patch({ scopeId: wallet.scopeId })
            .set({ balanceCents: nextBalance })
            .where((attr, op) => op.eq(attr.balanceCents, balanceCents))
            .go();
          claimed = true;
        } catch (err) {
          const anyErr = err as { name?: string; cause?: { name?: string } };
          if (anyErr?.name !== "ConditionalCheckFailedException" && anyErr?.cause?.name !== "ConditionalCheckFailedException") throw err;
        }
      }
      if (!claimed) throw new Error("Too much concurrent balance contention — try again.");

      const withdrawalId = randomUUID();
      await CommerceWithdrawalRequest.create({
        id: withdrawalId,
        walletId: wallet.id,
        organizationId: resolved.organizationId,
        requestedByUserId: resolved.userId,
        amountCents,
        encryptedAccountNumber: encryptBankDetail(accountNumber),
        encryptedAccountHolderName: encryptBankDetail(accountHolderName),
        bankName,
      }).go();
      await CommerceWalletLedgerEntry.create({
        id: randomUUID(),
        walletId: wallet.id,
        type: "WITHDRAWAL_DEBIT",
        netAmountCents: -amountCents,
        balanceAfterCents: nextBalance,
        withdrawalRequestId: withdrawalId,
        description: `Withdrawal requested — ${bankName}`,
      }).go();

      const [{ data: organization }, { data: user }] = await Promise.all([
        Organization.get({ id: resolved.organizationId }).go(),
        User.get({ id: resolved.userId }).go(),
      ]);
      if (organization && user) {
        await sendCommerceWithdrawalRequestNotificationEmail({
          id: withdrawalId, organizationName: organization.name, userEmail: user.email, userName: user.name ?? "A seller", amountCents, currency: wallet.currency ?? "NGN", bankName,
        }).catch((err) => console.error("Failed to send Commerce withdrawal admin notification email:", err));
      }

      return { success: true, withdrawal: { id: withdrawalId, status: "PENDING" } };
    }

    case "get_commerce_stripe_access_status": {
      const { data: requests } = await CommerceStripeAccessRequest.query.primary({ organizationId: resolved.organizationId }).go({ order: "desc" });
      const latest = requests[0];
      if (!latest) return { status: "NONE", requestId: null, rejectionReason: null, reason: null };
      return { status: latest.status ?? "PENDING", requestId: latest.id, rejectionReason: latest.status === "REJECTED" ? (latest.rejectionReason ?? null) : null, reason: latest.reason ?? null };
    }

    case "request_commerce_stripe_access": {
      const [{ data: organization }, { data: user }] = await Promise.all([
        Organization.get({ id: resolved.organizationId }).go(),
        User.get({ id: resolved.userId }).go(),
      ]);
      if (!organization || !user) throw new Error("Unauthorized.");

      const { data: existingRequests } = await CommerceStripeAccessRequest.query.primary({ organizationId: resolved.organizationId }).go({ pages: "all" });
      const blocking = existingRequests.some((r) => r.status === "PENDING" || r.status === "APPROVED");
      if (blocking) throw new Error("A Stripe access request is already pending or approved for this organization.");

      const reason = typeof args.reason === "string" ? args.reason.trim() || undefined : undefined;
      const expectedVolume = typeof args.expectedVolume === "string" ? args.expectedVolume.trim() || undefined : undefined;
      const id = randomUUID();
      await CommerceStripeAccessRequest.create({ id, organizationId: resolved.organizationId, requestedByUserId: resolved.userId, reason, expectedVolume }).go();

      await sendCommerceStripeAccessRequestNotificationEmail({
        id, organizationName: organization.name, userEmail: user.email, userName: user.name ?? "A user", reason: reason ?? null, expectedVolume: expectedVolume ?? null,
      }).catch((err) => console.error("Failed to send Commerce Stripe access admin notification email:", err));

      return { success: true, request: { id, status: "PENDING" } };
    }

    case "list_commerce_delivery_methods": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: methods } = await CommerceDeliveryMethod.query.primary({ templateId: siteId }).go({ pages: "all" });
      methods.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      return { methods };
    }

    case "create_commerce_delivery_method": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const name = typeof args.name === "string" ? args.name.trim() : "";
      if (!name) throw new Error("name is required.");
      if (args.type !== "PICKUP" && args.type !== "COURIER") throw new Error("type must be PICKUP or COURIER.");
      if (args.feeMinor !== undefined && (!Number.isInteger(args.feeMinor) || args.feeMinor < 0)) throw new Error("feeMinor must be a non-negative integer.");

      const id = randomUUID();
      await CommerceDeliveryMethod.create({
        id,
        templateId: siteId,
        organizationId: resolved.organizationId,
        name,
        type: args.type,
        feeMinor: typeof args.feeMinor === "number" ? args.feeMinor : 0,
        description: typeof args.description === "string" && args.description ? args.description : undefined,
        countries: normalizeStringList(args.countries),
        states: normalizeStringList(args.states),
        estimatedTimeLabel: typeof args.estimatedTimeLabel === "string" && args.estimatedTimeLabel ? args.estimatedTimeLabel : undefined,
        sortOrder: typeof args.sortOrder === "number" ? Math.trunc(args.sortOrder) : undefined,
      }).go();
      const { data: method } = await CommerceDeliveryMethod.get({ templateId: siteId, id }).go();
      return { success: true, method };
    }

    case "update_commerce_delivery_method": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const deliveryMethodId = typeof args.deliveryMethodId === "string" ? args.deliveryMethodId.trim() : "";
      if (!deliveryMethodId) throw new Error("deliveryMethodId is required.");
      const { data: existing } = await CommerceDeliveryMethod.get({ templateId: siteId, id: deliveryMethodId }).go();
      if (!existing) throw new Error(`Delivery method not found with id "${deliveryMethodId}".`);

      if (args.type !== undefined && args.type !== "PICKUP" && args.type !== "COURIER") throw new Error("type must be PICKUP or COURIER.");
      if (args.feeMinor !== undefined && (!Number.isInteger(args.feeMinor) || args.feeMinor < 0)) throw new Error("feeMinor must be a non-negative integer.");
      if (args.status !== undefined && args.status !== "ACTIVE" && args.status !== "INACTIVE") throw new Error("status must be ACTIVE or INACTIVE.");

      const data: Record<string, unknown> = {};
      const toRemove: string[] = [];
      if (typeof args.name === "string" && args.name.trim()) data.name = args.name.trim();
      if (args.type !== undefined) data.type = args.type;
      if (typeof args.feeMinor === "number") data.feeMinor = args.feeMinor;
      if (args.description !== undefined) {
        if (typeof args.description === "string" && args.description) data.description = args.description;
        else toRemove.push("description");
      }
      if (args.countries !== undefined) {
        const normalized = normalizeStringList(args.countries);
        if (normalized && normalized.length) data.countries = normalized;
        else toRemove.push("countries");
      }
      if (args.states !== undefined) {
        const normalized = normalizeStringList(args.states);
        if (normalized && normalized.length) data.states = normalized;
        else toRemove.push("states");
      }
      if (args.estimatedTimeLabel !== undefined) {
        if (typeof args.estimatedTimeLabel === "string" && args.estimatedTimeLabel) data.estimatedTimeLabel = args.estimatedTimeLabel;
        else toRemove.push("estimatedTimeLabel");
      }
      if (args.status !== undefined) data.status = args.status;
      if (typeof args.sortOrder === "number") data.sortOrder = Math.trunc(args.sortOrder);

      let patch = CommerceDeliveryMethod.patch({ templateId: siteId, id: deliveryMethodId }).set(data);
      if (toRemove.length) patch = patch.remove(toRemove as any);
      await patch.go();
      const { data: method } = await CommerceDeliveryMethod.get({ templateId: siteId, id: deliveryMethodId }).go();
      return { success: true, method };
    }

    case "delete_commerce_delivery_method": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const deliveryMethodId = typeof args.deliveryMethodId === "string" ? args.deliveryMethodId.trim() : "";
      if (!deliveryMethodId) throw new Error("deliveryMethodId is required.");
      const { data: existing } = await CommerceDeliveryMethod.get({ templateId: siteId, id: deliveryMethodId }).go();
      if (!existing) throw new Error(`Delivery method not found with id "${deliveryMethodId}".`);
      await CommerceDeliveryMethod.remove({ templateId: siteId, id: deliveryMethodId }).go();
      return { success: true, deleted: true };
    }

    case "update_commerce_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      const order = await updateOrderFulfillmentStatus(siteId, resolved.organizationId, orderId, args.fulfillmentStatus);
      return { success: true, order: withoutOrderSecrets(order) };
    }

    case "refund_commerce_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      const order = await refundCommerceOrder(siteId, resolved.organizationId, orderId, {
        reason: args.reason,
        confirmOrderNumber: args.confirmOrderNumber,
        refundedBy: `mcp:${resolved.userId}`,
      });
      return { success: true, order: withoutOrderSecrets(order) };
    }

    case "delete_commerce_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      const { orderNumber } = await deleteCommerceOrder(siteId, orderId, { confirmOrderNumber: args.confirmOrderNumber, deletedBy: `mcp:${resolved.userId}` });
      return { success: true, deleted: true, orderNumber };
    }

    case "resolve_bank_transfer_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      if (args.action !== "confirm" && args.action !== "reject") throw new Error('action must be "confirm" or "reject".');
      const order = await resolveBankTransferOrder({
        templateId: siteId,
        orderId,
        action: args.action,
        resolvedBy: `mcp:${resolved.userId}`,
        reason: typeof args.reason === "string" ? args.reason : null,
      });
      return { success: true, order: withoutOrderSecrets(order) };
    }

    case "list_commerce_discounts": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { data: discounts } = await CommerceDiscountCode.query.primary({ templateId: siteId }).go({ pages: "all" });
      discounts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return { discounts };
    }

    case "create_commerce_discount": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const normalizedCode = typeof args.code === "string" ? args.code.trim().toUpperCase() : "";
      if (!normalizedCode) throw new Error("code is required.");
      if (args.type !== "PERCENT" && args.type !== "FIXED") throw new Error("type must be PERCENT or FIXED.");
      if (typeof args.value !== "number" || !Number.isInteger(args.value) || args.value <= 0) throw new Error("value must be a positive integer.");
      if (args.type === "PERCENT" && args.value > 100) throw new Error("A percentage discount can't exceed 100.");

      const { data: byCode } = await CommerceDiscountCode.query.byCode({ templateId: siteId, code: normalizedCode }).go({ pages: "all" });
      if (byCode[0]) throw new Error(`"${normalizedCode}" is already in use.`);

      const id = randomUUID();
      await CommerceDiscountCode.create({
        id,
        templateId: siteId,
        organizationId: resolved.organizationId,
        code: normalizedCode,
        type: args.type,
        value: args.value,
        expiresAt: typeof args.expiresAt === "string" && args.expiresAt ? new Date(args.expiresAt).toISOString() : undefined,
        usageLimit: typeof args.usageLimit === "number" && args.usageLimit > 0 ? Math.trunc(args.usageLimit) : undefined,
      }).go();
      const { data: discount } = await CommerceDiscountCode.get({ templateId: siteId, id }).go();
      return { success: true, discount };
    }

    case "update_commerce_discount": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const discountId = typeof args.discountId === "string" ? args.discountId.trim() : "";
      if (!discountId) throw new Error("discountId is required.");
      const { data: existing } = await CommerceDiscountCode.get({ templateId: siteId, id: discountId }).go();
      if (!existing) throw new Error(`Discount code not found with id "${discountId}".`);

      const data: Record<string, unknown> = {};
      const toRemove: string[] = [];
      if (typeof args.active === "boolean") data.active = args.active;
      if (args.expiresAt !== undefined) {
        if (args.expiresAt) data.expiresAt = new Date(args.expiresAt).toISOString();
        else toRemove.push("expiresAt");
      }
      if (args.usageLimit !== undefined) {
        if (typeof args.usageLimit === "number" && args.usageLimit > 0) data.usageLimit = Math.trunc(args.usageLimit);
        else toRemove.push("usageLimit");
      }

      let patch = CommerceDiscountCode.patch({ templateId: siteId, id: discountId }).set(data);
      if (toRemove.length) patch = patch.remove(toRemove as any);
      await patch.go();
      const { data: discount } = await CommerceDiscountCode.get({ templateId: siteId, id: discountId }).go();
      return { success: true, discount };
    }

    case "delete_commerce_discount": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const discountId = typeof args.discountId === "string" ? args.discountId.trim() : "";
      if (!discountId) throw new Error("discountId is required.");
      const { data: existing } = await CommerceDiscountCode.get({ templateId: siteId, id: discountId }).go();
      if (!existing) throw new Error(`Discount code not found with id "${discountId}".`);
      await CommerceDiscountCode.remove({ templateId: siteId, id: discountId }).go();
      return { success: true, deleted: true };
    }

    case "list_commerce_customers": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const page = Number(args.page) || 1;
      return await resolveCommerceCustomers(siteId, { page });
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
