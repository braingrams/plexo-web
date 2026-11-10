import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

import { parseInboundMessages, verifyWebhookSignature } from "@/lib/whatsapp/cloudApi";
import { markdownToWhatsApp, splitForWhatsApp } from "@/lib/whatsapp/format";


describe("webhook signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts Meta's signature", () => expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true));
  it("rejects a wrong secret, a tampered body, and a missing header", () => {
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false);
    expect(verifyWebhookSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=zz", "s3cret")).toBe(false);
  });
});

describe("parseInboundMessages", () => {
  const payload = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "2348012345678", profile: { name: "Ada" } }], messages } }] }] });
  it("reads text messages and the sender's name", () => {
    expect(parseInboundMessages(payload([{ id: "wamid.1", from: "2348012345678", type: "text", text: { body: "hi" } }]))).toEqual([
      { id: "wamid.1", from: "2348012345678", type: "text", text: "hi", media: null, profileName: "Ada" },
    ]);
  });
  it("treats a button tap as what the person said, and keeps non-text messages with no text", () => {
    const out = parseInboundMessages(payload([{ id: "a", from: "1", type: "interactive", interactive: { button_reply: { title: "Yes" } } }, { id: "b", from: "1", type: "image" }]));
    expect(out.map((m) => m.text)).toEqual(["Yes", null]);
  });
  it("reads photos (with caption), documents and voice notes as media", () => {
    const out = parseInboundMessages(
      payload([
        { id: "i", from: "1", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "fix this banner" } },
        { id: "d", from: "1", type: "document", document: { id: "m2", mime_type: "application/pdf", filename: "menu.pdf" } },
        { id: "a", from: "1", type: "audio", audio: { id: "m3", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { id: "s", from: "1", type: "sticker" },
      ]),
    );
    expect(out.map((m) => [m.media?.kind ?? null, m.media?.id ?? null, m.text])).toEqual([
      ["image", "m1", "fix this banner"],
      ["document", "m2", null],
      ["audio", "m3", null],
      [null, null, null],
    ]);
    expect(out[1].media?.filename).toBe("menu.pdf");
  });
  it("ignores delivery receipts and junk", () => {
    expect(parseInboundMessages({ entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] })).toEqual([]);
    expect(parseInboundMessages(null)).toEqual([]);
  });
});

describe("markdownToWhatsApp", () => {
  it("converts bold, italics, headings, bullets and links", () => {
    const out = markdownToWhatsApp("# Title\n\nThis is **bold** and *italic*.\n\n- one\n- two\n\nSee [the page](https://x.io/p).");
    expect(out).toBe("*Title*\n\nThis is *bold* and _italic_.\n\n• one\n• two\n\nSee the page: https://x.io/p.");
  });
  it("leaves code blocks untouched", () => {
    expect(markdownToWhatsApp("```js\nconst a = **1**;\n```")).toBe("```const a = **1**;```");
  });
});

describe("splitForWhatsApp", () => {
  it("keeps a short reply whole and splits a long one on boundaries with a counter", () => {
    expect(splitForWhatsApp("hi")).toEqual(["hi"]);
    const long = Array.from({ length: 400 }, (_, i) => `Line number ${i} of the answer.`).join("\n");
    const parts = splitForWhatsApp(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts[0]).toMatch(/\(1\/\d+\)$/);
    expect(parts.join("\n").replace(/\n\n\(\d+\/\d+\)/g, "").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });
});
