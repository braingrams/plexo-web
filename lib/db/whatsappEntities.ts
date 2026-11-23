import { Entity } from "electrodb";
import { docClient, TABLES } from "./client";

// WhatsApp ↔ SOL (lib/whatsapp). Three small shapes, no new GSIs:
//   - WhatsAppLink:     phone number → the Plexo account (and chat) it talks to. Looked up on every inbound message.
//   - WhatsAppUserLink: account → its phone number. Lets the dashboard show "Connected: +234…" and disconnect.
//   - WhatsAppLinkCode: the short-lived code the owner sends from their phone to prove which account it is (ttl'd).
//   - WhatsAppMessage:  one row per inbound message id, so Meta's webhook retries never run a turn twice (ttl'd).

const days = (n: number): number => Math.floor(Date.now() / 1000) + n * 24 * 60 * 60;
const minutes = (n: number): number => Math.floor(Date.now() / 1000) + n * 60;

export const WhatsAppLink = new Entity(
  {
    model: { entity: "whatsappLink", version: "1", service: "plexoSol" },
    attributes: {
      phone: { type: "string", required: true }, // digits only, country code included, no "+"
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      // Set after a thumbs-down reaction: the next message they send is kept as what they expected instead.
      feedbackMessageId: { type: "string" },
      feedbackUntil: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["phone"], template: "WAPHONE#${phone}" },
        sk: { field: "sk", composite: [], template: "LINK" },
      },
    },
  },
  { table: TABLES.sol, client: docClient },
);

export const WhatsAppUserLink = new Entity(
  {
    model: { entity: "whatsappUserLink", version: "1", service: "plexoSol" },
    attributes: {
      userId: { type: "string", required: true },
      phone: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: [], template: "WHATSAPP" },
      },
    },
  },
  { table: TABLES.sol, client: docClient },
);

export const WhatsAppLinkCode = new Entity(
  {
    model: { entity: "whatsappLinkCode", version: "1", service: "plexoOps" },
    attributes: {
      code: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      expiresAt: { type: "string", required: true },
      ttl: { type: "number", default: () => minutes(60) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["code"], template: "WACODE#${code}" },
        sk: { field: "sk", composite: [], template: "CODE" },
      },
    },
  },
  { table: TABLES.ops, client: docClient },
);

export const WhatsAppMessage = new Entity(
  {
    model: { entity: "whatsappMessage", version: "1", service: "plexoOps" },
    attributes: {
      messageId: { type: "string", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      ttl: { type: "number", default: () => days(3) },
    },
    indexes: {
      primary: {
        pk: { field: "pk", composite: ["messageId"], template: "WAMSG#${messageId}" },
        sk: { field: "sk", composite: [], template: "MSG" },
      },
    },
  },
  { table: TABLES.ops, client: docClient },
);
