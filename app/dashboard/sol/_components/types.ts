// Shared shapes for the SOL chat surface — mirrors lambda/sol-chat/index.ts's StreamFrame
// union and the CRUD routes under app/api/v1/sol/** exactly (field names/casing verified
// against those files, not guessed).

export type ModelTier = "BASIC" | "MEDIUM" | "HIGH";

export const MODEL_TIER_OPTIONS: Array<{ value: ModelTier; label: string; description: string }> = [
  { value: "BASIC", label: "Standard", description: "Fast and efficient for everyday tasks" },
  { value: "MEDIUM", label: "Advanced", description: "Stronger reasoning for harder problems" },
  { value: "HIGH", label: "Most Capable", description: "SOL's top-tier model for complex work" },
];

export type ToolCallStatus = "running" | "awaiting_confirmation" | "success" | "error" | "cancelled";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  label?: string;
  input: unknown;
  status?: ToolCallStatus;
  result?: unknown;
};
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: unknown };
export type MediaBlock = {
  type: "image" | "document";
  source?: { type?: string; url?: string; media_type?: string };
  url?: string;
  filename?: string;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | MediaBlock | Record<string, unknown>;

export type MessageRole = "user" | "assistant" | "tool";

export type SolMessage = {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  usage?: { inputTokens: number; outputTokens: number } | null;
  confirmationState?: "PENDING" | "CONFIRMED" | "DECLINED" | "AUTO" | null;
  feedback?: "UP" | "DOWN" | null;
  feedbackComment?: string | null;
  createdAt: string;
  /** Client-only flag: true while this message is the live in-flight streaming bubble. */
  pending?: boolean;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  modelTier: ModelTier;
  status: "ACTIVE" | "ARCHIVED";
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PendingAttachment = {
  /** Client-local id, used as a React key before/after upload completes. */
  clientId: string;
  file: File;
  attachmentId?: string;
  url?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  progress?: number;
};

export type ChatAttachment = { type: "image" | "pdf" | "document"; url: string; filename?: string };

/** Classifies a content-type into the attachment "type" buildUserMessageContent
 * (lambda/sol-chat/index.ts) actually understands — anything else (e.g. audio, which is
 * transcribed client-side instead) has no attachment representation in a chat message. */
export function classifyAttachmentType(contentType: string): "image" | "pdf" | "document" | null {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType === "text/plain" ||
    contentType === "text/csv" ||
    contentType === "text/markdown"
  ) {
    return "document";
  }
  return null;
}

export type CreditInfo = { requiredCredits: number; availableCredits: number };
