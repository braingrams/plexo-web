import { Entity, Service } from "electrodb";
import { docClient, TABLES } from "./client";

// plexo-sol: SolConversation, SolMessage, SolMemoryFact, SolPreferences — the data layer
// for SOL, the AI agent chat feature. Brand-new (no Prisma model to port from). Each
// entity's primary index is scoped to its one real access pattern (a user's conversation
// list, a conversation's transcript, a user's memory facts, a user's own preferences row)
// — no GSIs pre-provisioned here per the "don't pre-provision GSIs unless there's a real
// access pattern" convention (see lib/db/ledgerEntities.ts).

const table = TABLES.sol;

export const SolConversation = new Entity(
  {
    model: { entity: "solConversation", version: "1", service: "plexoSol" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      organizationId: { type: "string", required: true },
      title: { type: "string" }, // auto-summarized, user-editable
      modelTier: { type: ["BASIC", "MEDIUM", "HIGH"] as const, default: "BASIC" },
      status: { type: ["ACTIVE", "ARCHIVED"] as const, default: "ACTIVE" },
      lastMessageAt: { type: "string" },
      messageCount: { type: "number", default: 0 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // A user's conversation list, most-recently-updated first, in a single query.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["updatedAt", "id"], template: "CONVO#${updatedAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const SolMessage = new Entity(
  {
    model: { entity: "solMessage", version: "1", service: "plexoSol" },
    attributes: {
      id: { type: "string", required: true },
      conversationId: { type: "string", required: true },
      userId: { type: "string", required: true }, // denormalized for a future "delete all my SOL data" sweep
      role: { type: ["user", "assistant", "tool"] as const, required: true },
      // A full LLM content-block array (text/tool_use/tool_result/image blocks), stored
      // as-is — schema-free by design so it can be replayed verbatim back into the next
      // model call.
      content: { type: "any", required: true },
      // Populated only on a completed assistant turn, shape like {inputTokens, outputTokens}.
      usage: { type: "any" },
      // Only set on assistant messages that represent a tool call awaiting user
      // confirmation before a destructive action executes.
      confirmationState: { type: ["PENDING", "CONFIRMED", "DECLINED", "AUTO"] as const },
      // User feedback on this specific message (thumbs up/down from the chat UI), plus an
      // optional free-text comment — set once via app/api/v1/sol/feedback/route.ts, never
      // by the agent loop itself. Rolling this up into admin-analytics is a separate task;
      // this is just the persistence side.
      feedback: { type: ["UP", "DOWN"] as const },
      feedbackComment: { type: "string", validate: (value: string) => value.length <= 2000 },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // A conversation's transcript, in chronological order, in a single query.
      primary: {
        pk: { field: "pk", composite: ["conversationId"], template: "CONVO#${conversationId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "MSG#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// A small, user-curated list of durable facts/preferences SOL remembers about a user
// (ChatGPT/Claude-"memory"-feature style) — separate from the raw conversation
// transcript above.
export const SolMemoryFact = new Entity(
  {
    model: { entity: "solMemoryFact", version: "1", service: "plexoSol" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      text: { type: "string", required: true, validate: (value: string) => value.length <= 500 },
      category: { type: ["PREFERENCE", "FACT", "TONE"] as const, default: "FACT" },
      source: { type: ["USER_ADDED", "LLM_EXTRACTED"] as const, required: true },
      // Absent for USER_ADDED facts added directly via a settings page.
      sourceConversationId: { type: "string" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // A user's memory facts. No GSIs: this list is deliberately small per user (tens
      // not thousands of rows), so no pagination-heavy access pattern is needed.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["id"], template: "MEMORY#${id}" },
      },
    },
  },
  { table, client: docClient },
);

// SOL-specific behavior settings, one row per user — kept as its own entity rather than
// more scalars bolted onto the big User item, same reasoning as why ApiKey/Notification
// are their own entities sharing User's pk convention (lib/db/coreEntities.ts).
export const SolPreferences = new Entity(
  {
    model: { entity: "solPreferences", version: "1", service: "plexoSol" },
    attributes: {
      userId: { type: "string", required: true }, // this IS the row's identity, one per user
      tonePreset: { type: ["PROFESSIONAL", "FRIENDLY", "CONCISE", "DETAILED"] as const },
      customInstructions: { type: "string", validate: (value: string) => value.length <= 2000 },
      defaultModelTier: { type: ["BASIC", "MEDIUM", "HIGH"] as const, default: "BASIC" },
      memoryEnabled: { type: "boolean", default: true },
      responseLength: { type: ["CONCISE", "BALANCED", "THOROUGH"] as const, default: "BALANCED" },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
      updatedAt: { type: "string", default: () => new Date().toISOString(), watch: "*", set: () => new Date().toISOString() },
    },
    indexes: {
      // One row per user, direct .get({userId}) lookup — a fixed literal sort key, no
      // query needed.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: [], template: "PREFS" },
      },
    },
  },
  { table, client: docClient },
);

// A file (image, PDF, doc, or voice-note recording) a user attached to a SOL chat —
// either dropped directly into an in-progress conversation, or uploaded before the
// conversation it'll end up attached to even exists yet (e.g. a voice note recorded from
// the composer before the first message of a brand-new chat is sent), hence
// `conversationId` being optional. Deliberately its own entity rather than reusing
// UploadedImage (lib/db/coreEntities.ts): that entity is image-only and organization-
// scoped, whereas SOL attachments are user-scoped and can be any of several content
// types (see app/api/v1/sol/upload/route.ts's allowlist).
export const SolAttachment = new Entity(
  {
    model: { entity: "solAttachment", version: "1", service: "plexoSol" },
    attributes: {
      id: { type: "string", required: true },
      userId: { type: "string", required: true },
      conversationId: { type: "string" },
      url: { type: "string", required: true },
      filename: { type: "string", required: true },
      contentType: { type: "string", required: true },
      sizeBytes: { type: "number", required: true },
      createdAt: { type: "string", default: () => new Date().toISOString(), readOnly: true },
    },
    indexes: {
      // A user's attachments, most-recently-uploaded first — mirrors SolConversation's own
      // "list this user's X" access pattern. No GSI by conversationId: a conversation's
      // attachments are looked up by following the `url`s already embedded in that
      // conversation's SolMessage content blocks, not by querying this entity directly.
      primary: {
        pk: { field: "pk", composite: ["userId"], template: "USER#${userId}" },
        sk: { field: "sk", composite: ["createdAt", "id"], template: "ATTACHMENT#${createdAt}#${id}" },
      },
    },
  },
  { table, client: docClient },
);

export const plexoSolService = new Service(
  { SolConversation, SolMessage, SolMemoryFact, SolPreferences, SolAttachment },
  { table, client: docClient },
);
