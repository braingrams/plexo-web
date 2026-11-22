import { describe, expect, it } from "vitest";
import { formatAiActivityDescription } from "@/lib/dashboardV3/billingView";

describe("formatAiActivityDescription", () => {
  it("translates raw agent chat codes with model tiers to human-friendly description", () => {
    expect(formatAiActivityDescription("agent_chat (bedrock_claude/MEDIUM)")).toBe("Chat with SOL");
    expect(formatAiActivityDescription("agent_chat (bedrock_claude/BASIC)")).toBe("Chat with SOL");
    expect(formatAiActivityDescription("agent_chat")).toBe("Chat with SOL");
  });

  it("translates blog post generation codes to human-friendly description", () => {
    expect(formatAiActivityDescription("generate_blog_post (bedrock_claude/MEDIUM)")).toBe("Wrote blog post");
    expect(formatAiActivityDescription("generate_blog_post")).toBe("Wrote blog post");
  });

  it("translates other AI actions to meaningful labels", () => {
    expect(formatAiActivityDescription("page_assist (bedrock_claude/BASIC)")).toBe("Page design assist");
    expect(formatAiActivityDescription("edit_element (bedrock_claude/BASIC)")).toBe("Edited page content");
    expect(formatAiActivityDescription("edit_layout (bedrock_claude/BASIC)")).toBe("Edited page layout");
    expect(formatAiActivityDescription("generate_layout (bedrock_claude/BASIC)")).toBe("Generated page layout");
    expect(formatAiActivityDescription("write_brand_voice (bedrock_claude/BASIC)")).toBe("Wrote brand voice");
    expect(formatAiActivityDescription("import_products (bedrock_claude/BASIC)")).toBe("Imported products with AI");
    expect(formatAiActivityDescription("design_section_type (bedrock_claude/BASIC)")).toBe("Designed custom section");
    expect(formatAiActivityDescription("image_to_design (bedrock_claude/BASIC)")).toBe("Converted image to design");
  });

  it("formats top-up purchases nicely", () => {
    expect(formatAiActivityDescription("Top-up purchase (SMALL)")).toBe("Credit top-up (SMALL)");
    expect(formatAiActivityDescription("Top-up purchase (custom)")).toBe("Credit top-up");
    expect(formatAiActivityDescription("Top-up purchase (credits)")).toBe("Credit top-up");
    expect(formatAiActivityDescription("Top-up purchase (1,000 credits)")).toBe("Credit top-up (1,000 credits)");
  });

  it("keeps already friendly descriptions intact", () => {
    expect(formatAiActivityDescription("Monthly Pro allowance")).toBe("Monthly Pro allowance");
    expect(formatAiActivityDescription("Plan changed to Pro — allowance refreshed")).toBe("Plan changed to Pro — allowance refreshed");
    expect(formatAiActivityDescription("Credits you bought")).toBe("Credits you bought");
  });

  it("falls back to activity type label when description is missing", () => {
    expect(formatAiActivityDescription(null, "AI_USAGE")).toBe("AI help");
    expect(formatAiActivityDescription(null, "MONTHLY_GRANT")).toBe("Your monthly credits");
    expect(formatAiActivityDescription(null, "TOPUP_PURCHASE")).toBe("Credits you bought");
    expect(formatAiActivityDescription("", null)).toBe("Credits");
  });
});
