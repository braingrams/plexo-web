import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-custom-content (v1). This is the site-owner-defined structured content feature —
// the WordPress ACF/CPT-UI equivalent this app had zero concept of before this file (grepped
// every lib/db/*Entities.ts for ContentType/customField/fieldSchema/acf: zero hits). Two
// entities: CustomContentType (the schema an owner defines — "Testimonial" has a quote/name/
// rating) and CustomContentEntry (a row of data conforming to that schema).
//
// Table/service decision: this piggybacks on the EXISTING plexo-content table (TABLES.content)
// rather than a new one — a new DynamoDB table needs a CDK deploy (cdk/lib/data-stack.ts),
// which this v1 is explicitly scoped to avoid (see the no-new-GSI note below). It gets its OWN
// service name, "plexoCustomContent", rather than folding into "plexoContent" — same reasoning
// commerceEntities.ts gives for why Commerce is its own "plexoCommerce" service: this is a
// distinct, self-contained feature area with its own two-entity object graph, not something
// any existing plexoContent entity ever needs to Service-join against. A service is a pure code-
// level grouping construct in ElectroDB (not a table), so this costs nothing infra-wise.
//
// Indexing:
// - CustomContentType is listed by templateId ("every content type this site has defined" —
//   the only real access pattern, confirmed against the dashboard/API scope in this v1), so it
//   gets the same TEMPLATE#<templateId> partition + id-suffixed SK shape CommerceDiscountCode/
//   CommerceDeliveryMethod use for their own template-scoped lists. No GSI: like
//   CommerceDeliveryMethod, "list everything for this site" is fully answered by the primary
//   key's SK prefix alone.
// - CustomContentEntry is listed by contentTypeId, not templateId — entries are always browsed/
//   queried scoped to the content type that owns their schema (the dashboard entries list, and
//   the public read API's per-typeSlug listing), never "every entry across every type on this
//   site" in one shot. So its partition is CONTENTTYPE#<contentTypeId>, deliberately different
//   from its parent's own templateId-scoped partition. If a templateId-wide entry listing is
//   ever needed, the answer is the same "fan out over a small parent list" shape this migration
//   already uses elsewhere (e.g. app/api/v1/templates/[id]/route.ts's DELETE walking descendant
//   ids, or app/api/public/commerce/products/route.ts's bestSellerProductIds fanning out per
//   order): fetch the template's CustomContentTypes first (bounded, owner-curated, small), then
//   query each one's entries. No GSI added for this — a real infra deploy is out of scope here.
//
// Slug uniqueness (CustomContentType.slug, unique per templateId) is NOT enforced by the key
// shape (the SK is id-suffixed, not slug-suffixed, matching the task's specified indexing) — the
// content-types API route enforces it with a find-before-create check against the (small,
// per-site, owner-curated) list, same discipline CommerceDiscountCode documents for its own
// code-uniqueness check, just without that entity's extra GSI since this v1 deliberately omits
// one.

const table = TABLES.content;

export type CustomContentFieldType = "text" | "textarea" | "richtext" | "number" | "boolean" | "date" | "image_url" | "url";

export type CustomContentField = {
  id: string;
  name: string;
  key: string;
  type: CustomContentFieldType;
  required: boolean;
};

export const CustomContentType = new Entity(
  {
    model: { entity: "customContentType", version: "1", service: "plexoCustomContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: true },
      // A JSON array of CustomContentField — {id, name, key, type, required}. "any" here
      // mirrors Template.designJson/CommerceOrder.metadata's own precedent for schemaless
      // JSON blobs elsewhere in this migration.
      fields: { type: "any", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // "every content type this site has defined" — same shape as CommerceDeliveryMethod's
      // own no-GSI primary key.
      primary: {
        pk: { field: "pk", composite: ["templateId"], template: "TEMPLATE#${templateId}" },
        sk: { field: "sk", composite: ["id"], template: "CONTENTTYPE#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const CustomContentEntry = new Entity(
  {
    model: { entity: "customContentEntry", version: "1", service: "plexoCustomContent" },
    attributes: {
      id: { type: "string", required: true },
      templateId: { type: "string", required: true },
      contentTypeId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      // A JSON object keyed by each field's `key`, matching the owning CustomContentType's
      // `fields` schema at write time — validated in the API route, not by ElectroDB itself.
      data: { type: "any", required: true },
      status: { type: ["PUBLISHED", "DRAFT"] as const, default: "DRAFT" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // Scoped by contentTypeId, not templateId — entries are always browsed/queried within
      // one content type (dashboard entries list, public read API), never site-wide in one
      // query. See the file header for how a templateId-wide listing would be answered
      // without a GSI, if that's ever needed.
      primary: {
        pk: { field: "pk", composite: ["contentTypeId"], template: "CONTENTTYPE#${contentTypeId}" },
        sk: { field: "sk", composite: ["id"], template: "ENTRY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoCustomContentService = new Service(
  {
    CustomContentType,
    CustomContentEntry,
  },
  { table, client: docClient },
);
