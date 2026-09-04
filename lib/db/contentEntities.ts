import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-content. Field shapes ported 1:1 from schema.prisma. Most entities scope by
// templateId (co-located, matches how they're actually queried — "everything for this
// site"); a few genuinely platform-wide entities (Testimonial, TemplateGenerationJob)
// get their own top-level key instead. GSI1/GSI2 picked per-entity for the real access
// pattern, unique constraints moved into the primary SK wherever DynamoDB's own
// uniqueness (not GSIs) can enforce them for free, same discipline as commerce/ledger.

const table = TABLES.content;

// Local replacement for the Prisma-generated TemplateKind enum — matches Template.kind's
// own literal union below exactly.
export type TemplateKind = "EMAIL" | "LANDING_PAGE";

export const Template = new Entity(
  {
    model: { entity: "template", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      kind: { type: ["EMAIL", "LANDING_PAGE"] as const, required: true },
      sourceType: { type: ["BUILDER", "RAW_UPLOAD"] as const, default: "BUILDER" },
      designJson: { type: "any", required: true },
      compiledHtml: { type: "string", required: true },
      sdkVersion: { type: "string" },
      compiledAt: { type: "string" },
      parentId: { type: "string" },
      slug: { type: "string" },
      order: { type: "number", default: 0 },
      isOfficial: { type: "boolean", default: false },
      marketplaceStatus: { type: ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "REJECTED"] as const },
      marketplaceCategory: { type: "string" },
      marketplaceDescription: { type: "string" },
      priceCents: { type: "number" },
      marketplacePublishedAt: { type: "string" },
      marketplaceRejectionReason: { type: "string" },
      isBlogLayout: { type: "boolean", default: false },
      isSiteLayoutFragment: { type: "boolean", default: false },
      isCommerceLayout: { type: "boolean", default: false },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["id"], template: "TEMPLATE#${id}" },
        sk: { field: "sk", composite: [], template: "TEMPLATE" },
      },
      // The core dashboard need: "my org's templates," newest first.
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["updatedAt", "id"], template: "TEMPLATE#${updatedAt}#${id}" },
      },
      // Multipage: list a page's children in order (prisma: @@index([parentId]), `order`
      // field). Sparse for root templates (parentId null) — they simply don't appear
      // here, which is correct: "list children of no page" isn't a real query.
      byParent: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["parentId"], template: "PARENT#${parentId}" },
        sk: { field: "GSI2SK", composite: ["order", "id"], template: "TEMPLATE#${order}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Known gap, not solved here: marketplace browsing (list by marketplaceStatus,
// platform-wide) has no dedicated index — Template already spent both its GSI slots on
// the two core authenticated-dashboard patterns (org list, page tree), which carry more
// load than the public marketplace browse page. Candidate for the Athena/export path or
// a future GSI3 if real traffic proves it needs one.

export const TemplateRevision = new Entity(
  {
    model: { entity: "templateRevision", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      designJson: { type: "any", required: true },
      compiledHtml: { type: "string", required: true },
      sdkVersion: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Co-located with the template itself — "get this page + its revision history."
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "REVISION#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplateAsset = new Entity(
  {
    model: { entity: "templateAsset", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      path: { type: "string", required: true },
      blobUrl: { type: "string", required: true },
      contentType: { type: "string", required: true },
      size: { type: "number", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // path as the SK enforces @@unique([templateId, path]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["path"], template: "ASSET#${path}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplatePurchase = new Entity(
  {
    model: { entity: "templatePurchase", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      priceCentsPaid: { type: "number", required: true },
      stripeSessionId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // templateId as SK enforces @@unique([userId, templateId]) for free.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["templateId"], template: "PURCHASE#${templateId}" },
      },
      // The seller-side need: "who bought this template" (prisma: @@index([templateId])).
      byTemplate: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "GSI1SK", composite: ["userId"], template: "PURCHASE#${userId}" },
      },
    },
  },
  { table, client: docClient },
);

export const PublishedDomain = new Entity(
  {
    model: { entity: "publishedDomain", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      domain: { type: "string", required: true },
      type: { type: ["SUBDOMAIN", "CUSTOM"] as const, required: true },
      dnsVerified: { type: "boolean", default: false },
      dnsVerifiedAt: { type: "string" },
      active: { type: "boolean", default: true },
      suspendedAt: { type: "string" },
      suspendedReason: { type: "string" },
      flagged: { type: "boolean", default: false },
      flagReason: { type: "string" },
      lastScannedAt: { type: "string" },
      // Site-wide "discourage search engines" toggle (WordPress's Reading Settings
      // equivalent) — read by app/pub/[domain]/[[...slug]]/route.ts to emit
      // <meta name="robots" content="noindex,nofollow"> on every page this domain serves.
      noindex: { type: "boolean", default: false },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
      // CUSTOM domains only — replaces the earlier CloudFront-managed-certificate approach
      // (ManagedCertificateRequest), which turned out to reproducibly issue a certificate
      // that never actually attaches to its distribution tenant, even on a clean first
      // attempt (confirmed directly, not assumed — see lib/acmCertificates.ts's own
      // comment). This app now requests its own ACM certificate directly and attaches it
      // once issued, same reliable customizations.certificate.arn mechanism the
      // plexopages.com/plexo.charisol.io wildcard certs already use, just per-customer-
      // domain and at runtime instead of CDK-deploy-time.
      certificateArn: { type: "string" },
      certificateStatus: { type: ["PENDING_VALIDATION", "ISSUED", "ATTACHED", "FAILED"] as const },
      certificateValidationName: { type: "string" },
      certificateValidationValue: { type: "string" },
      tenantId: { type: "string" },
      // Set only for domains bought through Plexo (RegisteredDomain below) — every
      // manually-connected CUSTOM/SUBDOMAIN row simply omits it. This is the hand-off point
      // the domain-registration reconciliation poller uses to flip the linked
      // RegisteredDomain to ACTIVE once certificateStatus here reaches ATTACHED.
      registeredDomainId: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "DOMAIN#${id}" },
      },
      // THE hot-path lookup: middleware.ts resolves every incoming tenant request by
      // hostname (prisma: domain @unique) — this is the busiest query this entity has.
      byDomain: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["domain"], template: "DOMAIN#${domain}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "DOMAIN#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Tracks the REGISTRAR/BILLING lifecycle of a domain bought through Plexo — separate from
// PublishedDomain, which tracks DNS/cert/tenant serving state for any domain (bought here or
// manually connected). Kept as two entities rather than one because they're genuinely two
// independent lifecycles: PublishedDomain.registeredDomainId links a row here to the
// PublishedDomain row created once DNS provisioning starts (see lib/domains/domainDns.ts),
// and this row's own publishedDomainId mirrors that back once it exists — see
// lib/domains/registrarProvider.ts's own comment for the full state machine this attribute
// walks through, end to end.
export const RegisteredDomain = new Entity(
  {
    model: { entity: "registeredDomain", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      domain: { type: "string", required: true },
      publishedDomainId: { type: "string" },

      registrarProvider: { type: ["ROUTE53", "MANUAL"] as const, required: true },
      registrarOperationId: { type: "string" },
      hostedZoneId: { type: "string" },

      // JSON-encoded DomainContact (lib/domains/registrarProvider.ts) collected at purchase
      // time — RegisterDomain needs a registrant/admin/tech contact and there's nowhere
      // else in this app that already stores a mailing address to reuse (confirmed: no
      // existing User/Organization billing-address field). Kept as one JSON blob rather
      // than a pile of top-level attributes since it's write-once (at PENDING_PAYMENT) and
      // read-once (by the registration poller when it calls provider.register()).
      registrantContactJson: { type: "string" },

      status: {
        type: [
          "SEARCHING",
          "PRICED",
          "PENDING_PAYMENT",
          "PAYMENT_FAILED",
          "REGISTERING",
          "REGISTRATION_FAILED",
          "DNS_PROVISIONING",
          "CERT_PENDING",
          "CERT_ISSUED",
          "TENANT_ATTACHING",
          "ACTIVE",
          "UNLOCK_REQUESTED",
          "AUTH_CODE_EMAILED",
          "TRANSFER_PENDING",
          "TRANSFERRED_OUT",
          "MANUAL_PENDING",
          "MANUAL_FULFILLED",
          "SUSPENDED_NONPAYMENT",
          "EXPIRED",
        ] as const,
        required: true,
        default: "SEARCHING",
      },
      statusReason: { type: "string" },
      lastPolledAt: { type: "string" },

      // Captured at purchase time, always USD cents (Route53 Domains prices in USD only —
      // see the Buy-a-Domain plan's own note on why wallet payment is USD-wallet-only for
      // now rather than converting).
      purchasePriceUsdCents: { type: "number" },
      renewalPriceUsdCents: { type: "number" },
      paymentMethod: { type: ["WALLET", "STRIPE"] as const },
      paymentReference: { type: "string" },
      // Captured off the purchase Checkout Session's PaymentIntent (`setup_future_usage:
      // "off_session"` — see app/api/v1/domains/purchase/route.ts) so
      // app/api/internal/domain-renewal-billing/route.ts can charge a Stripe-funded renewal
      // without the customer re-entering a card. Unset for WALLET-funded domains.
      stripePaymentMethodId: { type: "string" },

      autoRenew: { type: "boolean", default: true },
      renewalDate: { type: "string" },
      transferLocked: { type: "boolean", default: true },
      whoisPrivacyEnabled: { type: "boolean", default: true },
      eppAuthCodeSentAt: { type: "string" },
      unlockRequestedAt: { type: "string" },
      unlockRequestedByUserId: { type: "string" },
      transferOutDetectedAt: { type: "string" },

      // Renewal-billing bookkeeping (app/api/internal/domain-renewal-billing/route.ts) — a
      // charge attempt failing once isn't fatal, so these track the grace window before a
      // domain actually lapses, matching this app's other "retry, warn, then act" patterns
      // (see e.g. Commerce's expire-stale-holds cron).
      renewalAttemptCount: { type: "number", default: 0 },
      renewalGraceUntil: { type: "string" },
      lastRenewalFailureReason: { type: "string" },

      manualFulfillment: { type: "boolean", default: false },
      manualAssignedAdminId: { type: "string" },
      manualNotes: { type: "string" },

      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "REGISTEREDDOMAIN#${id}" },
      },
      // Settings-page/poller lookup by hostname, same shape as PublishedDomain's own hot path.
      byDomain: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["domain"], template: "DOMAIN#${domain}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "REGISTEREDDOMAIN#${id}" },
      },
      // Poller scan-narrowing — unlike PublishedDomain's plain-scan-is-fine certificate-
      // attachment cron, the registration/transfer/renewal pollers here run on tighter
      // cadences against a table expected to scale past low-hundreds of rows.
      byStatus: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["status"], template: "REGISTEREDDOMAINSTATUS#${status}" },
        sk: { field: "GSI2SK", composite: ["updatedAt", "id"], template: "REGISTEREDDOMAIN#${updatedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogSite = new Entity(
  {
    model: { entity: "blogSite", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      enabled: { type: "boolean", default: false },
      title: { type: "string", default: "Blog" },
      description: { type: "string" },
      postsPerPage: { type: "number", default: 10 },
      defaultCategoryId: { type: "string" },
      showOnHomepage: { type: "boolean", default: false },
      accentColor: { type: "string" },
      fontPreset: { type: "string", default: "sans" },
      logoUrl: { type: "string" },
      headerImageUrl: { type: "string" },
      postLayoutTemplateId: { type: "string" },
      listingLayoutTemplateId: { type: "string" },
      commentsEnabled: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // One per template (prisma: templateId @unique) — co-located with the site.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "BLOGSITE" },
      },
    },
  },
  { table, client: docClient },
);

export const SiteLayout = new Entity(
  {
    model: { entity: "siteLayout", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      enabled: { type: "boolean", default: false },
      headerTemplateId: { type: "string" },
      footerTemplateId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "SITELAYOUT" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogAuthor = new Entity(
  {
    model: { entity: "blogAuthor", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      userId: { type: "string" },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      avatarUrl: { type: "string" },
      bio: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // slug as SK enforces @@unique([templateId, slug]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "AUTHOR#${slug}" },
      },
      byUser: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "GSI1SK", composite: ["templateId"], template: "AUTHOR#${templateId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogCategory = new Entity(
  {
    model: { entity: "blogCategory", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      description: { type: "string" },
      parentId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "CATEGORY#${slug}" },
      },
      byParent: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["parentId"], template: "CATPARENT#${parentId}" },
        sk: { field: "GSI1SK", composite: ["id"], template: "CATEGORY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogTag = new Entity(
  {
    model: { entity: "blogTag", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "TAG#${slug}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogPost = new Entity(
  {
    model: { entity: "blogPost", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      authorId: { type: "string" },
      title: { type: "string", required: true },
      slug: { type: "string", required: true },
      excerpt: { type: "string" },
      contentJson: { type: "any", required: true },
      contentHtml: { type: "string", required: true },
      featuredImageUrl: { type: "string" },
      featuredImageAlt: { type: "string" },
      status: { type: ["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const, default: "DRAFT" },
      publishedAt: { type: "string" },
      scheduledAt: { type: "string" },
      metaTitle: { type: "string" },
      metaDescription: { type: "string" },
      ogImageUrl: { type: "string" },
      noindex: { type: "boolean", default: false },
      readingTimeMinutes: { type: "number" },
      viewCount: { type: "number", default: 0 },
      externalId: { type: "string" },
      commentsEnabled: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // slug as SK enforces @@unique([templateId, slug]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["slug"], template: "POST#${slug}" },
      },
      // The real blog-listing need: this site's posts, filterable by status, sorted by
      // publish date (prisma: @@index([templateId, status, publishedAt])).
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATEPOSTS#${templateId}" },
        sk: { field: "GSI1SK", composite: ["status", "publishedAt", "id"], template: "${status}#${publishedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Known gap: @@unique([templateId, externalId]) — WordPress-import dedup — has no index
// here (SK is slug-keyed). Import-batch resumability needs this; deferred to whenever
// the WordPress importer itself gets ported, not fabricated as a guess now.

export const BlogPostCategory = new Entity(
  {
    model: { entity: "blogPostCategory", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true }, // denormalized — not in Prisma, added for co-location
      postId: { type: "string", required: true },
      categoryId: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["postId", "categoryId"], template: "POSTCAT#${postId}#${categoryId}" },
      },
      byCategory: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["categoryId"], template: "CATEGORY#${categoryId}" },
        sk: { field: "GSI1SK", composite: ["postId"], template: "POST#${postId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogPostTag = new Entity(
  {
    model: { entity: "blogPostTag", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true }, // denormalized — not in Prisma, added for co-location
      postId: { type: "string", required: true },
      tagId: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["postId", "tagId"], template: "POSTTAG#${postId}#${tagId}" },
      },
      byTag: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["tagId"], template: "TAG#${tagId}" },
        sk: { field: "GSI1SK", composite: ["postId"], template: "POST#${postId}" },
      },
    },
  },
  { table, client: docClient },
);

export const BlogComment = new Entity(
  {
    model: { entity: "blogComment", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      postId: { type: "string", required: true },
      parentId: { type: "string" },
      authorName: { type: "string", required: true },
      authorEmail: { type: "string", required: true },
      body: { type: "string", required: true },
      status: { type: ["PENDING", "APPROVED", "SPAM", "REJECTED"] as const, default: "PENDING" },
      ipHash: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Scoped by postId, not templateId — the real access pattern is "this post's
      // comment moderation queue," not a site-wide view (prisma: @@index([postId, status])).
      // status prefixed in the SK so a begins_with query filters the moderation queue
      // without a separate GSI.
      primary: {
        pk: { field: "pk", composite: ["postId"], template: "POST#${postId}" },
        sk: { field: "sk", composite: ["status", "createdAt", "id"], template: "COMMENT#${status}#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);
// Rate-limiting by ipHash (prisma: @@index([ipHash, createdAt])) deliberately doesn't
// get a GSI here — that's exactly what plexo-ops's RateLimit table already exists for,
// a better architectural fit than duplicating rate-limit state into plexo-content.

export const BlogRedirect = new Entity(
  {
    model: { entity: "blogRedirect", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      fromPath: { type: "string", required: true },
      toPath: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // fromPath as SK enforces @@unique([templateId, fromPath]) for free.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["fromPath"], template: "REDIRECT#${fromPath}" },
      },
    },
  },
  { table, client: docClient },
);

export const Testimonial = new Entity(
  {
    model: { entity: "testimonial", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      quote: { type: "string", required: true },
      name: { type: "string", required: true },
      role: { type: "string", required: true },
      company: { type: "string" },
      avatarUrl: { type: "string" },
      rating: { type: "number", default: 5 },
      status: { type: ["PENDING", "APPROVED", "REJECTED"] as const, default: "PENDING" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Platform-wide, not site-scoped — no templateId field in the Prisma model at all.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "TESTIMONIAL#${id}" },
        sk: { field: "sk", composite: [], template: "TESTIMONIAL" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "TESTIMONIALSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "TESTIMONIAL#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const TemplateGenerationJob = new Entity(
  {
    model: { entity: "templateGenerationJob", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      status: { type: ["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"] as const, default: "PENDING" },
      kind: { type: ["EMAIL", "LANDING_PAGE"] as const, required: true },
      isOptIn: { type: "boolean", default: false },
      category: { type: "string", required: true },
      priceCents: { type: "number", default: 0 },
      targetStatus: { type: ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "REJECTED"] as const, required: true },
      provider: { type: "string", required: true },
      requestedCount: { type: "number", required: true },
      succeededCount: { type: "number", default: 0 },
      failedCount: { type: "number", default: 0 },
      createdTemplateIds: { type: "list", items: { type: "string" }, default: () => [] },
      errors: { type: "any" },
      lockedAt: { type: "string" },
      createdBy: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Platform-wide admin batch jobs — not site-scoped.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "GENJOB#${id}" },
        sk: { field: "sk", composite: [], template: "GENJOB" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "GENJOBSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "GENJOB#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Not in any original phase's scope — found while walking plexo-admin's actual routes
// against what exists. Both were referenced by real admin dashboard pages
// (script-access-requests, feedback) with no entity anywhere to back them.
export const ScriptAccessRequest = new Entity(
  {
    model: { entity: "scriptAccessRequest", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      userId: { type: "string", required: true },
      reason: { type: "string" },
      status: { type: ["PENDING", "APPROVED", "REJECTED"] as const, default: "PENDING" },
      requestedAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      processedAt: { type: "string" },
      processedByAdminId: { type: "string" },
      approvedMinutes: { type: "number" },
      expiresAt: { type: "string" },
      rejectionReason: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "SCRIPTACCESS#${id}" },
      },
      // The admin review queue (prisma: @@index([status])) — same precedent as
      // WithdrawalRequest/Testimonial. byUserId (@@index([userId])) stays a documented
      // gap, same discipline as elsewhere.
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "SCRIPTACCESSSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["requestedAt", "id"], template: "SCRIPTACCESS#${requestedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const Feedback = new Entity(
  {
    model: { entity: "feedback", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string" },
      userEmail: { type: "string", required: true },
      userName: { type: "string", required: true },
      message: { type: "string", required: true },
      pageUrl: { type: "string" },
      status: { type: ["NEW", "REVIEWED", "ARCHIVED"] as const, default: "NEW" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // Platform-wide, not site-scoped — no templateId in the Prisma model.
      primary: {
        pk: { field: "pk", composite: ["id"], template: "FEEDBACK#${id}" },
        sk: { field: "sk", composite: [], template: "FEEDBACK" },
      },
      byStatus: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["status"], template: "FEEDBACKSTATUS#${status}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "FEEDBACK#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Generic "coming soon" interest capture — first user: the LMS/Funnel page builder's
// "Upload video" option, which is wired to show a coming-soon state + a "Notify me" click
// rather than a real upload flow (raw video hosting/transcoding cost needs deliberate
// design first, see the Funnel/LMS plan's own cost-implications section). Keyed by an
// arbitrary `feature` string rather than a one-off "VideoUploadInterest" entity so any
// future coming-soon flag can reuse this same capture + plexo-admin review shape.
export const FeatureWaitlist = new Entity(
  {
    model: { entity: "featureWaitlist", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      feature: { type: "string", required: true },
      userId: { type: "string", required: true },
      userEmail: { type: "string", required: true },
      userName: { type: "string" },
      organizationId: { type: "string" },
      // Optional context — e.g. which funnel they were editing when they clicked "Notify
      // me" for video upload. Not required: some future feature may not have one.
      templateId: { type: "string" },
      note: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // One signup per user per feature (userId as SK) — clicking "Notify me" twice is a
      // no-op, not a duplicate row, via .create()'s attribute_not_exists.
      primary: {
        pk: { field: "pk", composite: ["feature"], template: "FEATUREWAITLIST#${feature}" },
        sk: { field: "sk", composite: ["userId"], template: "WAITLIST#${userId}" },
      },
    },
  },
  { table, client: docClient },
);

// The Figma-style anchored canvas comments on a template (PlexoBuilder editor) — distinct
// from BlogComment (public blog post comments) above. Scoped by templateId, not postId:
// "list this template's whole comment thread" is the real access pattern (grepped every
// real call site, not assumed) — no status-prefixed SK the way BlogComment has, since
// canvas comments don't go through a moderation queue, just resolved/unresolved in place.
export const Comment = new Entity(
  {
    model: { entity: "comment", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      templateId: { type: "string", required: true },
      authorId: { type: "string", required: true },
      parentId: { type: "string" },
      body: { type: "string", required: true },
      anchorNodeId: { type: "string" },
      anchorNodeType: { type: ["row", "column", "element"] as const },
      anchorX: { type: "number" },
      anchorY: { type: "number" },
      deviceView: { type: ["desktop", "tablet", "mobile"] as const },
      resolvedAt: { type: "string" },
      resolvedById: { type: "string" },
      editedAt: { type: "string" },
      // Soft-delete marker (prisma: Comment.deletedAt) — added here (schemaless attribute
      // add, same discipline as User.strataProjectId elsewhere in this migration) since the
      // app/api/v1/comments/** routes' soft-delete-preserves-thread-integrity behavior
      // depends on it and it was missing from the original port of this entity.
      deletedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      // prisma: @updatedAt — distinct from editedAt above (an explicit "the author edited
      // this comment's body" marker); this one is Prisma's own any-column-changed
      // timestamp. Missing from the original port of this entity (found auditing the
      // Postgres->DynamoDB data migration, 2026-09-02) — added the same way every other
      // schemaless attribute in this migration was, no redeploy needed.
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "COMMENT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// Write-only in the real app (grepped — no read call site exists anywhere; it's a pure
// @mention dedup/audit record) — prisma: @@unique([commentId, userId]) becomes the
// primary key itself, so a repeat mention on an edited comment hits .create()'s
// attribute_not_exists condition exactly the way skipDuplicates: true did.
export const CommentMention = new Entity(
  {
    model: { entity: "commentMention", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      commentId: { type: "string", required: true },
      userId: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["commentId"], template: "COMMENT#${commentId}" },
        sk: { field: "sk", composite: ["userId"], template: "MENTION#${userId}" },
      },
    },
  },
  { table, client: docClient },
);

// Funnel/LMS module: a "funnel" is a capability bolted onto an existing Template row, the
// same way BlogSite/SiteLayout are — not a new Template.kind. This keeps a funnel's
// domain-publishing, ownership, and template-picker eligibility all free. LmsPage,
// LmsEnrollment, and LmsPageProgress are co-located under TEMPLATE#${templateId} so
// "everything about this funnel" is a single query; LmsFunnelAddonSlot lives under the
// org instead since it tracks a billing relationship (Plexo user -> Plexo), not funnel
// content.
export const LmsFunnel = new Entity(
  {
    model: { entity: "lmsFunnel", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      userId: { type: "string", required: true },
      // Flips false when the funnel's plan slot or addon-slot subscription is deactivated
      // (see lib/lms/funnelSlots.ts) — the row and its pages/enrollments are never deleted,
      // just hidden from visitors, so reactivating a lapsed slot restores everything as-is.
      enabled: { type: "boolean", default: true },
      signupMode: { type: ["FREE", "PAID"] as const, default: "FREE" },
      // Set only when signupMode is PAID — points at a CommerceProduct (kind: DIGITAL) the
      // admin creates through the existing Commerce product UI. A paid enrollment is
      // architecturally a digital-product purchase; see lib/lms/enrollment.ts.
      signupProductId: { type: "string" },
      requireName: { type: "boolean", default: true },
      collectPhone: { type: "boolean", default: false },
      welcomeRedirectPath: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // One per template (like BlogSite/SiteLayout) — co-located with the site.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: [], template: "LMSFUNNEL" },
      },
      // Slot-gating check: "how many funnels does this org have" (lib/lms/funnelSlots.ts).
      byOrg: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "GSI1SK", composite: ["createdAt", "id"], template: "LMSFUNNEL#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const LmsPage = new Entity(
  {
    model: { entity: "lmsPage", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      order: { type: "number", required: true },
      kind: { type: ["WELCOME", "VIDEO", "DOCUMENT", "IMAGE"] as const, required: true },
      title: { type: "string", required: true },
      bodyHtml: { type: "string" },
      youtubeVideoId: { type: "string" },
      assetUrl: { type: "string" },
      assetFileName: { type: "string" },
      assetMimeType: { type: "string" },
      assetSizeBytes: { type: "number" },
      // Opaque JSON (lib/lms/rules.ts's LmsPageUnlockRules), not a typed ElectroDB shape —
      // this is exactly what lets a future condition type (e.g. QUIZ_PASS's authoring UI)
      // ship with zero migration: the DynamoDB attribute never changes shape either way.
      unlockRules: { type: "any" },
      visible: { type: "boolean", default: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Direct get-by-id — learner content fetch, admin edit.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "PAGE#${id}" },
      },
      // Ordered listing + reorder — the builder's and the learner portal's real access
      // pattern, same split as Template's own primary-by-id + byParent-GSI-for-order.
      byOrder: {
        index: "GSI1",
        pk: { field: "GSI1PK", composite: ["templateId"], template: "TEMPLATEPAGES#${templateId}" },
        sk: { field: "GSI1SK", composite: ["order", "id"], template: "PAGE#${order}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const LmsEnrollment = new Entity(
  {
    model: { entity: "lmsEnrollment", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // Lowercased — the SK itself. Enforces one enrollment per email per funnel via
      // .create()'s attribute_not_exists, same trick TemplateAsset/BlogPost/BlogRedirect
      // use for their own unique constraints.
      email: { type: "string", required: true },
      name: { type: "string" },
      phone: { type: "string" },
      status: { type: ["ACTIVE", "REVOKED"] as const, default: "ACTIVE" },
      paymentStatus: { type: ["FREE", "PAID", "REFUNDED"] as const, default: "FREE" },
      commerceOrderId: { type: "string" },
      enrolledAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      lastActiveAt: { type: "string" },
      // Denormalized so the admin enrollment-list view never fans out into an
      // LmsPageProgress query per row just to render "3/7 pages".
      completedPageCount: { type: "number", default: 0 },
      lastCompletedAt: { type: "string" },
      completedAt: { type: "string" },
      revokedAt: { type: "string" },
      revokedByUserId: { type: "string" },
      // Resend rate-limiting for the "reach out" / resend-magic-link admin action.
      magicLinkLastSentAt: { type: "string" },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["email"], template: "ENROLLMENT#${email}" },
      },
      // Admin's recent-signups list — the ordering the primary SK (alphabetical by email)
      // can't give. No org-wide GSI: only a per-funnel admin view is a real requirement
      // today: a cross-funnel CRM view is a documented gap, same discipline as
      // RegisteredDomain/PublishedDomain's own gaps, not built speculatively.
      byEnrolledAt: {
        index: "GSI2",
        pk: { field: "GSI2PK", composite: ["templateId"], template: "TEMPLATEENROLL#${templateId}" },
        sk: { field: "GSI2SK", composite: ["enrolledAt", "email"], template: "ENROLLMENT#${enrolledAt}#${email}" },
      },
    },
  },
  { table, client: docClient },
);

export const LmsPageProgress = new Entity(
  {
    model: { entity: "lmsPageProgress", version: "1", service: "plexoContent" },
    attributes: {
      templateId: { type: "string", required: true },
      email: { type: "string", required: true },
      pageId: { type: "string", required: true },
      firstViewedAt: { type: "string" },
      completedAt: { type: "string" },
      adminApprovedAt: { type: "string" },
      adminApprovedByUserId: { type: "string" },
    },
    indexes: {
      // begins_with on PROGRESS#${email}# returns one learner's whole progress in a single
      // query — both the unlock evaluator and the admin drill-in need exactly this, and
      // neither needs a GSI. A row is written only on a real event (first view, completion,
      // admin approval) — never pre-allocated one-row-per-page-per-learner up front.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["email", "pageId"], template: "PROGRESS#${email}#${pageId}" },
      },
    },
  },
  { table, client: docClient },
);

// Tracks the RECURRING billing lifecycle of one extra, paid funnel slot (Plexo user ->
// Plexo) — deliberately one Stripe Subscription object per slot, not shared line items,
// so a payment failure on one slot deactivates only that slot's templateId while every
// other funnel/slot on the org is untouched. See lib/lms/activateFunnelAddonSlot.ts.
export const LmsFunnelAddonSlot = new Entity(
  {
    model: { entity: "lmsFunnelAddonSlot", version: "1", service: "plexoContent" },
    attributes: {
      id: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      userId: { type: "string", required: true },
      // Set at creation — either an existing over-quota funnel, or the funnel-to-be-created
      // (the create-funnel flow buys a slot first, then creates the Template+LmsFunnel only
      // once the slot activates).
      templateId: { type: "string", required: true },
      status: {
        type: ["PENDING_PAYMENT", "ACTIVE", "PAST_DUE", "CANCELLED", "PAYMENT_FAILED"] as const,
        required: true,
        default: "PENDING_PAYMENT",
      },
      stripeSubscriptionId: { type: "string" },
      stripePriceId: { type: "string" },
      activatedAt: { type: "string" },
      pastDueAt: { type: "string" },
      cancelledAt: { type: "string" },
      lastPaymentFailureReason: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // "This org's addon slots" is the primary key itself — no GSI needed, same as
      // CommerceDeliveryMethod's own comment about not needing one when a plain SK-prefix
      // scan already answers the only real question.
      primary: {
        pk: { field: "pk", composite: ["organizationId"], template: "ORG#${organizationId}" },
        sk: { field: "sk", composite: ["id"], template: "SLOT#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoContentService = new Service(
  {
    Template,
    TemplateRevision,
    TemplateAsset,
    TemplatePurchase,
    PublishedDomain,
    RegisteredDomain,
    BlogSite,
    SiteLayout,
    BlogAuthor,
    BlogCategory,
    BlogTag,
    BlogPost,
    BlogPostCategory,
    BlogPostTag,
    BlogComment,
    BlogRedirect,
    Testimonial,
    TemplateGenerationJob,
    ScriptAccessRequest,
    Feedback,
    FeatureWaitlist,
    Comment,
    CommentMention,
    LmsFunnel,
    LmsPage,
    LmsEnrollment,
    LmsPageProgress,
    LmsFunnelAddonSlot,
  },
  { table, client: docClient },
);
