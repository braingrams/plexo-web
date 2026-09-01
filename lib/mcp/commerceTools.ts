import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { slugify } from "@/server/slug";
import { encryptDigitalAccessSecret, encryptBankDetail, decryptPaystackKey, decryptMaildripKey } from "@/lib/crypto";
import { maskSecret } from "@/lib/commerce/adminAuth";
import { resolveCommerceWallet } from "@/lib/commerce/wallet";
import { resendDigitalDelivery } from "@/lib/commerce/digitalDelivery";
import { sendCommerceStripeAccessRequestNotificationEmail, sendCommerceWithdrawalRequestNotificationEmail } from "@/lib/email";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Never send the encrypted password ciphertext to a caller — same helper as
// app/api/v1/commerce/[templateId]/products/route.ts's own copy.
function toPublicProduct<T extends { digitalAccessPasswordEncrypted: string | null }>(product: T) {
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
  const site = await prisma.template.findFirst({
    where: { id: trimmed, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
    throw new Error(`No site found with id "${trimmed}" in this account. templateId must be a site's home page (no parent) — use list_landing_pages to find it.`);
  }
  return site.id;
}

async function ensureUniqueProductSlug(templateId: string, baseInput: string): Promise<string> {
  const base = slugify(baseInput) || "product";
  let candidate = base;
  let suffix = 2;
  while (await prisma.commerceProduct.findFirst({ where: { templateId, slug: candidate }, select: { id: true } })) {
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
  const category = await prisma.commerceCategory.upsert({
    where: { templateId_slug: { templateId, slug } },
    create: { templateId, organizationId, name, slug },
    update: { name },
  });
  return category.id;
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
    description: "Fetches a site's Commerce settings: enabled state, payment provider, Paystack mode/keys (masked), MailDrip config, and notification email.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page template id." } },
      required: ["templateId"],
    },
  },
  {
    name: "update_commerce_settings",
    description: `Updates a site's Commerce settings. Only the fields provided are changed. paymentProvider: BYO_PAYSTACK (default — the site's own Paystack keys below), PLATFORM_PAYSTACK (Plexo's own Paystack account, no keys needed, proceeds credit the Commerce wallet), or PLATFORM_STRIPE (Plexo's own Stripe account for international payments — requires prior approval, see request_commerce_stripe_access/get_commerce_stripe_access_status).`,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page template id." },
        enabled: { type: "boolean", description: "Master on/off switch for Commerce on this site." },
        paymentProvider: { type: "string", enum: ["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE"] },
        paystackMode: { type: "string", enum: ["TEST", "LIVE"], description: "Which BYO Paystack key pair is active." },
        paystackTestPublicKey: { type: "string" },
        paystackTestSecretKey: { type: "string" },
        paystackLivePublicKey: { type: "string" },
        paystackLiveSecretKey: { type: "string" },
        maildripApiKey: { type: "string" },
        maildripPaidGroupId: { type: "string" },
        maildripNewsletterGroupId: { type: "string" },
        notificationEmail: { type: "string" },
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
];

export const COMMERCE_TOOL_NAMES = new Set(COMMERCE_MCP_TOOLS.map((t) => t.name));

export async function handleCommerceTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  switch (toolName) {
    case "list_commerce_products": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const where: any = { templateId: siteId };
      if (typeof args.kind === "string" && ["PHYSICAL", "SERVICE", "DIGITAL"].includes(args.kind)) where.kind = args.kind;
      if (args.activeOnly) where.active = true;
      const products = await prisma.commerceProduct.findMany({ where, orderBy: { createdAt: "desc" } });
      return { products: products.map(toPublicProduct) };
    }

    case "get_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const product = await prisma.commerceProduct.findFirst({ where: { id: productId, templateId: siteId } });
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

      const slug = await ensureUniqueProductSlug(siteId, name);
      const categoryId = (await resolveCategoryId(siteId, resolved.organizationId, args.category)) ?? null;

      const product = await prisma.commerceProduct.create({
        data: {
          templateId: siteId,
          organizationId: resolved.organizationId,
          categoryId,
          name,
          slug,
          description: typeof args.description === "string" ? args.description : null,
          kind,
          priceMinor,
          imageUrl: typeof args.imageUrl === "string" && args.imageUrl ? args.imageUrl : null,
          stockQuantity: kind === "PHYSICAL" && typeof args.stockQuantity === "number" ? Math.max(0, Math.trunc(args.stockQuantity)) : null,
          durationMinutes: kind === "SERVICE" && typeof args.durationMinutes === "number" ? Math.max(5, Math.trunc(args.durationMinutes)) : null,
          digitalDeliveryMethod: kind === "DIGITAL" ? args.digitalDeliveryMethod : null,
          digitalFileUrl: kind === "DIGITAL" && args.digitalDeliveryMethod === "FILE_DOWNLOAD" ? String(args.digitalFileUrl) : null,
          digitalFileName: kind === "DIGITAL" && args.digitalDeliveryMethod === "FILE_DOWNLOAD" && typeof args.digitalFileName === "string" ? args.digitalFileName : null,
          digitalExternalUrl: kind === "DIGITAL" && args.digitalDeliveryMethod === "EXTERNAL_LINK" ? String(args.digitalExternalUrl) : null,
          digitalAccessInstructions: kind === "DIGITAL" && args.digitalDeliveryMethod === "ACCESS_LIST" ? String(args.digitalAccessInstructions) : null,
          digitalAccessPasswordEncrypted:
            kind === "DIGITAL" && args.digitalDeliveryMethod === "ACCESS_LIST" && typeof args.digitalAccessPassword === "string" && args.digitalAccessPassword
              ? encryptDigitalAccessSecret(args.digitalAccessPassword)
              : null,
          digitalMaxDownloads: kind === "DIGITAL" && typeof args.digitalMaxDownloads === "number" ? Math.max(1, Math.trunc(args.digitalMaxDownloads)) : null,
          digitalLinkExpiryDays: kind === "DIGITAL" && typeof args.digitalLinkExpiryDays === "number" ? Math.max(1, Math.trunc(args.digitalLinkExpiryDays)) : null,
        },
      });

      return { success: true, product: toPublicProduct(product) };
    }

    case "update_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const existing = await prisma.commerceProduct.findFirst({ where: { id: productId, templateId: siteId } });
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

      const product = await prisma.commerceProduct.update({
        where: { id: productId },
        data: {
          name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined,
          description: args.description === undefined ? undefined : (typeof args.description === "string" ? args.description : null),
          priceMinor: typeof args.priceMinor === "number" ? args.priceMinor : undefined,
          imageUrl: args.imageUrl === undefined ? undefined : (typeof args.imageUrl === "string" && args.imageUrl ? args.imageUrl : null),
          categoryId,
          active: typeof args.active === "boolean" ? args.active : undefined,
          stockQuantity: existing.kind === "PHYSICAL" && typeof args.stockQuantity === "number" ? Math.max(0, Math.trunc(args.stockQuantity)) : undefined,
          durationMinutes: existing.kind === "SERVICE" && typeof args.durationMinutes === "number" ? Math.max(5, Math.trunc(args.durationMinutes)) : undefined,
          digitalDeliveryMethod: isDigital ? effectiveDeliveryMethod : undefined,
          digitalFileUrl:
            isDigital && effectiveDeliveryMethod === "FILE_DOWNLOAD" && typeof args.digitalFileUrl === "string"
              ? args.digitalFileUrl || null
              : isDigital && effectiveDeliveryMethod !== "FILE_DOWNLOAD" ? null : undefined,
          digitalFileName:
            isDigital && effectiveDeliveryMethod === "FILE_DOWNLOAD" && typeof args.digitalFileName === "string"
              ? args.digitalFileName || null
              : isDigital && effectiveDeliveryMethod !== "FILE_DOWNLOAD" ? null : undefined,
          digitalExternalUrl:
            isDigital && effectiveDeliveryMethod === "EXTERNAL_LINK"
              ? (typeof args.digitalExternalUrl === "string" ? args.digitalExternalUrl || null : undefined)
              : isDigital ? null : undefined,
          digitalAccessInstructions:
            isDigital && effectiveDeliveryMethod === "ACCESS_LIST"
              ? (typeof args.digitalAccessInstructions === "string" ? args.digitalAccessInstructions || null : undefined)
              : isDigital ? null : undefined,
          digitalAccessPasswordEncrypted:
            isDigital && effectiveDeliveryMethod === "ACCESS_LIST"
              ? (typeof args.digitalAccessPassword === "string" && args.digitalAccessPassword ? encryptDigitalAccessSecret(args.digitalAccessPassword) : undefined)
              : isDigital ? null : undefined,
          digitalMaxDownloads: isDigital && typeof args.digitalMaxDownloads === "number" ? Math.max(1, Math.trunc(args.digitalMaxDownloads)) : undefined,
          digitalLinkExpiryDays: isDigital && typeof args.digitalLinkExpiryDays === "number" ? Math.max(1, Math.trunc(args.digitalLinkExpiryDays)) : undefined,
        },
      });

      return { success: true, product: toPublicProduct(product) };
    }

    case "delete_commerce_product": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const productId = typeof args.productId === "string" ? args.productId.trim() : "";
      if (!productId) throw new Error("productId is required.");
      const existing = await prisma.commerceProduct.findFirst({ where: { id: productId, templateId: siteId } });
      if (!existing) throw new Error(`Product not found with id "${productId}".`);
      const product = await prisma.commerceProduct.update({ where: { id: productId }, data: { active: false, suspendedAt: new Date() } });
      return { success: true, product: toPublicProduct(product) };
    }

    case "get_commerce_settings": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const settings = await prisma.commerceSettings.findUnique({ where: { templateId: siteId } });
      return {
        settings: {
          enabled: settings?.enabled ?? false,
          paymentProvider: settings?.paymentProvider ?? "BYO_PAYSTACK",
          paystackMode: settings?.paystackMode ?? "TEST",
          paystackTestPublicKey: settings?.paystackTestPublicKey ?? null,
          paystackLivePublicKey: settings?.paystackLivePublicKey ?? null,
          paystackTestSecretKeyMasked: settings?.paystackTestSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackTestSecretKeyEncrypted)) : null,
          paystackLiveSecretKeyMasked: settings?.paystackLiveSecretKeyEncrypted ? maskSecret(decryptPaystackKey(settings.paystackLiveSecretKeyEncrypted)) : null,
          maildripApiKeyMasked: settings?.maildripApiKeyEncrypted ? maskSecret(decryptMaildripKey(settings.maildripApiKeyEncrypted)) : null,
          maildripPaidGroupId: settings?.maildripPaidGroupId ?? null,
          maildripNewsletterGroupId: settings?.maildripNewsletterGroupId ?? null,
          notificationEmail: settings?.notificationEmail ?? null,
        },
      };
    }

    case "update_commerce_settings": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const { paystackMode, paymentProvider } = args;
      if (paystackMode !== undefined && paystackMode !== "TEST" && paystackMode !== "LIVE") {
        throw new Error("paystackMode must be TEST or LIVE.");
      }
      if (paymentProvider !== undefined && !["BYO_PAYSTACK", "PLATFORM_PAYSTACK", "PLATFORM_STRIPE"].includes(paymentProvider)) {
        throw new Error("paymentProvider must be BYO_PAYSTACK, PLATFORM_PAYSTACK, or PLATFORM_STRIPE.");
      }
      if (paymentProvider === "PLATFORM_STRIPE") {
        const approved = await prisma.commerceStripeAccessRequest.findFirst({ where: { organizationId: resolved.organizationId, status: "APPROVED" } });
        if (!approved) throw new Error("Platform Stripe isn't approved for this organization yet — call request_commerce_stripe_access first.");
      }

      const data: Record<string, unknown> = {};
      if (typeof args.enabled === "boolean") data.enabled = args.enabled;
      if (paymentProvider !== undefined) data.paymentProvider = paymentProvider;
      if (paystackMode !== undefined) data.paystackMode = paystackMode;
      if (typeof args.paystackTestPublicKey === "string") data.paystackTestPublicKey = args.paystackTestPublicKey || null;
      if (typeof args.paystackLivePublicKey === "string") data.paystackLivePublicKey = args.paystackLivePublicKey || null;
      if (typeof args.paystackTestSecretKey === "string" && args.paystackTestSecretKey) {
        const { encryptPaystackKey } = await import("@/lib/crypto");
        data.paystackTestSecretKeyEncrypted = encryptPaystackKey(args.paystackTestSecretKey);
      }
      if (typeof args.paystackLiveSecretKey === "string" && args.paystackLiveSecretKey) {
        const { encryptPaystackKey } = await import("@/lib/crypto");
        data.paystackLiveSecretKeyEncrypted = encryptPaystackKey(args.paystackLiveSecretKey);
      }
      if (typeof args.maildripApiKey === "string" && args.maildripApiKey) {
        const { encryptMaildripKey } = await import("@/lib/crypto");
        data.maildripApiKeyEncrypted = encryptMaildripKey(args.maildripApiKey);
      }
      if (typeof args.maildripPaidGroupId === "string") data.maildripPaidGroupId = args.maildripPaidGroupId || null;
      if (typeof args.maildripNewsletterGroupId === "string") data.maildripNewsletterGroupId = args.maildripNewsletterGroupId || null;
      if (typeof args.notificationEmail === "string") data.notificationEmail = args.notificationEmail || null;

      const settings = await prisma.commerceSettings.upsert({
        where: { templateId: siteId },
        create: { templateId: siteId, organizationId: resolved.organizationId, ...data },
        update: data,
      });

      return { success: true, settings: { enabled: settings.enabled, paymentProvider: settings.paymentProvider, paystackMode: settings.paystackMode } };
    }

    case "list_commerce_orders": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const page = Math.max(1, Number(args.page) || 1);
      const pageSize = 25;
      const where: any = { templateId: siteId };
      if (typeof args.status === "string") where.status = args.status;
      if (typeof args.q === "string" && args.q.trim()) {
        const q = args.q.trim();
        where.OR = [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { customerEmail: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
        ];
      }
      const [orders, total] = await Promise.all([
        prisma.commerceOrder.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { items: { select: { nameSnapshot: true, quantity: true, unitPriceMinor: true } } },
        }),
        prisma.commerceOrder.count({ where }),
      ]);
      return { orders, total, page, pageSize };
    }

    case "get_commerce_order": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const orderId = typeof args.orderId === "string" ? args.orderId.trim() : "";
      if (!orderId) throw new Error("orderId is required.");
      const order = await prisma.commerceOrder.findFirst({
        where: { id: orderId, templateId: siteId },
        include: {
          items: true,
          booking: { select: { scheduledStart: true, status: true } },
          digitalDeliveries: { select: { id: true, method: true, deliveredAt: true, downloadCount: true, maxDownloads: true, resendCount: true, product: { select: { name: true } } } },
        },
      });
      if (!order) throw new Error(`Order not found with id "${orderId}".`);
      return { order };
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
      const org = await prisma.organization.findUnique({ where: { id: resolved.organizationId }, select: { commerceWalletPooled: true } });
      const wallet = org?.commerceWalletPooled
        ? await prisma.commerceWallet.findFirst({ where: { organizationId: resolved.organizationId, templateId: null } })
        : await prisma.commerceWallet.findUnique({ where: { templateId: siteId } });
      if (!wallet) return { wallet: { balanceCents: 0, currency: "NGN", pooled: Boolean(org?.commerceWalletPooled) }, ledger: [] };
      const ledger = await prisma.commerceWalletLedgerEntry.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 25 });
      return { wallet: { balanceCents: wallet.balanceCents, currency: wallet.currency, pooled: Boolean(org?.commerceWalletPooled) }, ledger };
    }

    case "list_commerce_withdrawals": {
      const siteId = await resolveCommerceSiteId(resolved, args.templateId);
      const org = await prisma.organization.findUnique({ where: { id: resolved.organizationId }, select: { commerceWalletPooled: true } });
      const wallet = org?.commerceWalletPooled
        ? await prisma.commerceWallet.findFirst({ where: { organizationId: resolved.organizationId, templateId: null } })
        : await prisma.commerceWallet.findUnique({ where: { templateId: siteId } });
      if (!wallet) return { withdrawals: [] };
      const withdrawals = await prisma.commerceWithdrawalRequest.findMany({ where: { walletId: wallet.id }, orderBy: { requestedAt: "desc" } });
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
      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.commerceWallet.findUniqueOrThrow({ where: { id: wallet.id } });
        if (amountCents > current.balanceCents) throw new Error("Requested amount exceeds the wallet's available balance.");
        const nextBalance = current.balanceCents - amountCents;
        await tx.commerceWallet.update({ where: { id: wallet.id }, data: { balanceCents: nextBalance } });
        const withdrawal = await tx.commerceWithdrawalRequest.create({
          data: {
            walletId: wallet.id,
            organizationId: resolved.organizationId,
            requestedByUserId: resolved.userId,
            amountCents,
            encryptedAccountNumber: encryptBankDetail(accountNumber),
            encryptedAccountHolderName: encryptBankDetail(accountHolderName),
            bankName,
          },
        });
        await tx.commerceWalletLedgerEntry.create({
          data: { walletId: wallet.id, type: "WITHDRAWAL_DEBIT", netAmountCents: -amountCents, balanceAfterCents: nextBalance, withdrawalRequestId: withdrawal.id, description: `Withdrawal requested — ${bankName}` },
        });
        return withdrawal;
      });

      const [organization, user] = await Promise.all([
        prisma.organization.findUnique({ where: { id: resolved.organizationId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: resolved.userId }, select: { email: true, name: true } }),
      ]);
      if (organization && user) {
        await sendCommerceWithdrawalRequestNotificationEmail({
          id: result.id, organizationName: organization.name, userEmail: user.email, userName: user.name, amountCents: result.amountCents, bankName: result.bankName,
        }).catch((err) => console.error("Failed to send Commerce withdrawal admin notification email:", err));
      }

      return { success: true, withdrawal: { id: result.id, status: result.status } };
    }

    case "get_commerce_stripe_access_status": {
      const latest = await prisma.commerceStripeAccessRequest.findFirst({ where: { organizationId: resolved.organizationId }, orderBy: { requestedAt: "desc" } });
      if (!latest) return { status: "NONE", requestId: null, rejectionReason: null, reason: null };
      return { status: latest.status, requestId: latest.id, rejectionReason: latest.status === "REJECTED" ? latest.rejectionReason : null, reason: latest.reason };
    }

    case "request_commerce_stripe_access": {
      const [organization, user] = await Promise.all([
        prisma.organization.findUnique({ where: { id: resolved.organizationId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: resolved.userId }, select: { email: true, name: true } }),
      ]);
      if (!organization || !user) throw new Error("Unauthorized.");

      const blocking = await prisma.commerceStripeAccessRequest.findFirst({
        where: { organizationId: resolved.organizationId, OR: [{ status: "PENDING" }, { status: "APPROVED" }] },
      });
      if (blocking) throw new Error("A Stripe access request is already pending or approved for this organization.");

      const reason = typeof args.reason === "string" ? args.reason.trim() || null : null;
      const expectedVolume = typeof args.expectedVolume === "string" ? args.expectedVolume.trim() || null : null;
      const created = await prisma.commerceStripeAccessRequest.create({
        data: { organizationId: resolved.organizationId, requestedByUserId: resolved.userId, reason, expectedVolume },
      });

      await sendCommerceStripeAccessRequestNotificationEmail({
        id: created.id, organizationName: organization.name, userEmail: user.email, userName: user.name, reason, expectedVolume,
      }).catch((err) => console.error("Failed to send Commerce Stripe access admin notification email:", err));

      return { success: true, request: { id: created.id, status: created.status, requestedAt: created.requestedAt } };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
