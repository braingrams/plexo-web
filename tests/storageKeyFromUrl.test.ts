import { describe, expect, it } from "vitest";
import { keyFromUrl } from "@/lib/storage";

describe("a stored file's key from its URL", () => {
  it("is decoded — spaces and U+202F included (SOL thumbnails were broken for these)", () => {
    const url = "https://plexo-user-content.s3.us-east-1.amazonaws.com/private/sol-attachments/u/d81-WhatsApp Image 2026-09-20 at 7.19.12 PM.jpeg";
    expect(keyFromUrl(url)).toBe("private/sol-attachments/u/d81-WhatsApp Image 2026-09-20 at 7.19.12 PM.jpeg");
  });

  it("leaves a plain key alone, and survives a stray %", () => {
    expect(keyFromUrl("https://b.s3.us-east-1.amazonaws.com/public/a/b.png")).toBe("public/a/b.png");
    expect(keyFromUrl("https://b.s3.us-east-1.amazonaws.com/public/100%-real.png")).toBe("public/100%-real.png");
  });
});
