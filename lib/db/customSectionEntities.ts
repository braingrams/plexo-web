import { Entity } from "electrodb";
import { docClient, TABLES } from "./client";

// A section type the owner designed once ("Testimonials", "Team members", "Menu items") that then
// shows up in the editor's add-section picker for every page of the site. The DESIGN lives here
// (one row, shared by every place it is used); the CONTENT of each use lives in the page itself
// (the page stores each section's own words, like any built-in section). See lib/customSections.
//
// Storage: same plexo-content table as custom content types (no new table / CDK deploy), keyed
// by the SITE's root template id so every page of the site sees the same list. Its own SK prefix
// keeps it apart from that feature's rows. Listing a site's types is the only access pattern, so
// no GSI. Deleting is soft (deletedAt): pages that already use a type keep working, and a starter
// type the owner removed is not quietly re-created next time.

const table = TABLES.content;

export const CustomSectionType = new Entity(
  {
    model: { entity: "customSectionType", version: "1", service: "plexoCustomSections" },
    attributes: {
      id: { type: "string", required: true },
      siteId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      name: { type: "string", required: true },
      description: { type: "string" },
      // "testimonials" | "faq" for the types Plexo sets up for every site; absent for the owner's own.
      starter: { type: "string" },
      // JSON array of the SDK's FieldDef (text, longtext, image, button, icon, toggle, select, list).
      fields: { type: "any", required: true },
      // The section's HTML, with {{field}} / {{#list}}…{{/list}} placeholders.
      html: { type: "string", required: true },
      // What a new use starts with (JSON object keyed by field key).
      defaults: { type: "any" },
      deletedAt: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["siteId"], template: "SECTIONTYPES#${siteId}" },
        sk: { field: "sk", composite: ["id"], template: "SECTIONTYPE#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// ---------------------------------------------------------------------------------------------------------------------
// The index of where each section type is used ("Entries" in the dashboard). Kept up to date whenever a page is saved, so
// listing every testimonial/team member across the site never means opening every page. Two kinds of row, same table:
//  - one row per use of a type on a page (what the owner sees: page, key words, how many repeated rows, last edited);
//  - one small marker per page remembering which of its rows are in the index and the page version they were read from,
//    so a page that changed (from any screen or tool) is noticed and re-read, and a page that went away is dropped.
// Rows are keyed by the site's root id, grouped by type, so "every use of this type" is one query.

export const CustomSectionPlacement = new Entity(
  {
    model: { entity: "customSectionPlacement", version: "1", service: "plexoCustomSections" },
    attributes: {
      siteId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      typeId: { type: "string", required: true },
      pageId: { type: "string", required: true },
      sectionId: { type: "string", required: true },
      pageTitle: { type: "string", required: true },
      // The first heading / name in this use, as plain words (never markup) — what identifies it in a list.
      keyText: { type: "string" },
      // How many repeated rows (testimonials, team members…) this use has; absent when the type doesn't repeat.
      rows: { type: "number" },
      // True when it was read from a working copy that isn't published yet.
      draft: { type: "boolean" },
      // When the page last changed (the page's own timestamp).
      editedAt: { type: "string", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["siteId"], template: "SECTIONPLACE#${siteId}" },
        sk: { field: "sk", composite: ["typeId", "pageId", "sectionId"], template: "TYPE#${typeId}#PAGE#${pageId}#SEC#${sectionId}" },
      },
    },
  },
  { table, client: docClient },
);

export const CustomSectionPageMarker = new Entity(
  {
    model: { entity: "customSectionPageMarker", version: "1", service: "plexoCustomSections" },
    attributes: {
      siteId: { type: "string", required: true },
      pageId: { type: "string", required: true },
      // The page version (its updatedAt) and the section types' version these rows were read at.
      stamp: { type: "string", required: true },
      typesStamp: { type: "string", required: true },
      // [typeId, sectionId] pairs currently indexed for this page.
      keys: { type: "any", required: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["siteId"], template: "SECTIONPAGEMARK#${siteId}" },
        sk: { field: "sk", composite: ["pageId"], template: "PAGE#${pageId}" },
      },
    },
  },
  { table, client: docClient },
);
