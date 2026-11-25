import { describe, expect, it } from "vitest";
import { applySlotCopy, cleanCopy, copyBySlot, listSlots, MAX_SLOTS, removableSections, removeSections, slotNodes, type SlotDoc } from "@/lib/onboarding/designSlots";

// Realistic V2 shapes: rootNode.children[] are sections, each holding props.block = { kind, content } (see tests/designTextSyncReal.test.ts).
const section = (id: string, kind: string, content: Record<string, unknown>) => ({ id, type: "section", props: { block: { kind, content } } });
const v2 = (...sections: unknown[]) => ({ format: "plexo-v2@1", pages: [{ id: "p1", name: "Home", slug: "", rootNode: { id: "root", type: "page", children: sections } }] });
const page = (d: unknown): SlotDoc[] => [{ role: "page", design: d }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const contentOf = (d: any, i: number) => d.pages[0].rootNode.children[i].props.block.content;
const slotOf = (slots: ReturnType<typeof listSlots>, text: string) => slots.find((s) => s.text === text)!;

describe("listing the words of a design", () => {
  it("finds the words in reading order and skips structure, addresses, colours and settings", () => {
    const d = v2(
      section("h", "header", { brand: "Iron & Grain", logo: "https://x/logo.png", links: [{ label: "Home", href: "/" }, { label: "Plans", href: "#plans" }] }),
      section("a", "hero", { headline: "Strength starts here", sub: "Open daily until late for everyone nearby", image: "https://x/hero.jpg", align: "center", variant: "primary", color: "#e0b040", cta: { label: "Join now", href: "/join" } }),
    );
    const texts = listSlots(page(d)).map((s) => s.text);
    expect(texts).toEqual(["Iron & Grain", "Home", "Plans", "Strength starts here", "Open daily until late for everyone nearby", "Join now"]);
  });

  it("gives stable ids that point at the JSON path", () => {
    const d = v2(section("a", "hero", { headline: "Hello there" }));
    const [s] = listSlots(page(d));
    expect(s.id).toBe("page0|pages.0.rootNode.children.0.props.block.content.headline");
    expect(listSlots(page(JSON.parse(JSON.stringify(d))))[0].id).toBe(s.id);
    expect(s.blockKind).toBe("hero");
  });

  it("does not take form field names or ids for words, but takes a testimonial's author name", () => {
    const d = v2(section("f", "form", { fields: [{ name: "email", type: "email", label: "Your email" }] }), section("t", "testimonials", { items: [{ name: "Jane Doe", quote: "Brilliant" }] }));
    expect(listSlots(page(d)).map((s) => s.text)).toEqual(["Your email", "Jane Doe", "Brilliant"]);
  });

  it("splits rich text into one slot per stretch between its inline tags", () => {
    const d = v2(section("a", "hero", { headline: "Build <em>strong</em> habits that <strong>last</strong>" }));
    const slots = listSlots(page(d));
    expect(slots.map((s) => s.text)).toEqual(["Build", "strong", "habits that", "last"]);
    expect(slots.map((s) => s.part)).toEqual([0, 2, 4, 6]);
    expect(new Set(slots.map((s) => s.id)).size).toBe(4);
  });

  it("gives repeated text its own slot each time", () => {
    const d = v2(section("a", "cta", { label: "Learn more" }), section("b", "cta", { label: "Learn more" }), section("c", "cta", { label: "Learn more" }));
    const slots = listSlots(page(d));
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
  });

  it("offers blank optional lines (a tagline) last, and only a few", () => {
    const d = v2(section("a", "hero", { headline: "Hello there", eyebrow: "", sub: "" }), section("b", "cta", { label: "Go on" }));
    const slots = listSlots(page(d));
    expect(slots.map((s) => [s.text, !!s.empty])).toEqual([["Hello there", false], ["Go on", false], ["", true], ["", true]]);
    expect(slotNodes(slots).map((n) => n.id)).toEqual([0, 1, 2, 3]);
  });

  it("reads the shared header and footer as further docs, addressed apart from the page", () => {
    const docs: SlotDoc[] = [
      { role: "header", design: v2(section("h", "header", { brand: "Iron & Grain" })) },
      { role: "page", design: v2(section("a", "hero", { headline: "Iron & Grain trains you" })) },
      { role: "footer", design: v2(section("f", "footer", { copyright: "© 2026 Iron & Grain" })) },
    ];
    const slots = listSlots(docs);
    expect(slots.map((s) => s.role)).toEqual(["header", "page", "footer"]);
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
  });

  it("never lists anything outside the page's sections (brand, meta)", () => {
    const d = { ...v2(section("a", "hero", { headline: "Hello there" })), designSystem: { tokens: [{ key: "--note", value: "Not words at all" }] }, meta: { htmlTitle: "Iron & Grain" } };
    expect(listSlots(page(d)).map((s) => s.text)).toEqual(["Hello there"]);
  });

  it("shows SOL at most 260 words and numbers them from 0", () => {
    const d = v2(...Array.from({ length: 300 }, (_, i) => section(`s${i}`, "cta", { label: `Label ${i}` })));
    const nodes = slotNodes(listSlots(page(d)));
    expect(nodes).toHaveLength(MAX_SLOTS);
    expect(nodes[0]).toEqual({ id: 0, text: "Label 0" });
  });
});

describe("putting SOL's words back", () => {
  it("replaces each slot where it lives and leaves everything else exactly as it was", () => {
    const d = v2(section("a", "hero", { headline: "Strength starts here", image: "https://x/hero.jpg", sub: "Open daily until late for everyone nearby" }));
    const slots = listSlots(page(d));
    const out = applySlotCopy(page(d), { [slotOf(slots, "Strength starts here").id]: "Cakes baked for you" });
    expect(contentOf(out.docs[0].design, 0)).toEqual({ headline: "Cakes baked for you", image: "https://x/hero.jpg", sub: "Open daily until late for everyone nearby" });
    expect(out.applied).toBe(1);
    expect(contentOf(d, 0).headline).toBe("Strength starts here"); // the input is never modified
  });

  it("changes only the stretch of a rich field that SOL rewrote, keeping the emphasis and entities", () => {
    const d = v2(section("a", "hero", { headline: "Build <em>strong</em> habits &amp; <strong>last</strong>" }));
    const slots = listSlots(page(d));
    const habits = slots.find((s) => s.text.startsWith("habits"))!;
    const out = applySlotCopy(page(d), { [habits.id]: "routines & more" });
    expect(contentOf(out.docs[0].design, 0).headline).toBe("Build <em>strong</em> routines &amp; more <strong>last</strong>");
  });

  it("changes the right one of three repeated texts", () => {
    const d = v2(section("a", "cta", { label: "Learn more" }), section("b", "cta", { label: "Learn more" }), section("c", "cta", { label: "Learn more" }));
    const slots = listSlots(page(d));
    const out = applySlotCopy(page(d), { [slots[1].id]: "Find out more" });
    expect([0, 1, 2].map((i) => contentOf(out.docs[0].design, i).label)).toEqual(["Learn more", "Find out more", "Learn more"]);
  });

  it("fills a blank optional line", () => {
    const d = v2(section("a", "hero", { headline: "Hello there", eyebrow: "" }));
    const slots = listSlots(page(d));
    const blank = slots.find((s) => s.empty)!;
    const out = applySlotCopy(page(d), { [blank.id]: "Fresh every morning" });
    expect(contentOf(out.docs[0].design, 0).eyebrow).toBe("Fresh every morning");
  });

  it("writes into the shared header and footer docs", () => {
    const docs: SlotDoc[] = [
      { role: "header", design: v2(section("h", "header", { brand: "Iron & Grain" })) },
      { role: "page", design: v2(section("a", "hero", { headline: "Hello there" })) },
      { role: "footer", design: v2(section("f", "footer", { copyright: "© 2026 Iron & Grain" })) },
    ];
    const slots = listSlots(docs);
    const out = applySlotCopy(docs, { [slots[0].id]: "Aria", [slots[2].id]: "© 2026 Aria" });
    expect(contentOf(out.docs[0].design, 0).brand).toBe("Aria");
    expect(contentOf(out.docs[2].design, 0).copyright).toBe("© 2026 Aria");
    expect(contentOf(out.docs[1].design, 0).headline).toBe("Hello there");
  });

  it("ignores ids the design does not have, empty text, and markup SOL should not write", () => {
    const d = v2(section("a", "hero", { headline: "Hello there" }));
    const [s] = listSlots(page(d));
    const out = applySlotCopy(page(d), { "page0|pages.0.nope": "x", [s.id]: "   " });
    expect(out.applied).toBe(0);
    expect(out.skipped).toBe(2);
    expect(contentOf(out.docs[0].design, 0).headline).toBe("Hello there");
    expect(contentOf(applySlotCopy(page(d), { [s.id]: "<script>alert(1)</script>Welcome <b>friends</b>" }).docs[0].design, 0).headline).toBe("alert(1) Welcome friends");
    expect(cleanCopy(42)).toBeNull();
    expect(cleanCopy("x".repeat(900))).toHaveLength(600);
  });

  it("turns SOL's numbered answers into slot ids, ignoring numbers it was never shown", () => {
    const d = v2(section("a", "hero", { headline: "Hello there", sub: "A longer line of text here" }));
    const slots = listSlots(page(d));
    expect(copyBySlot(slots, { "0": "Hi", "1": "Hey", "5": "never shown", x: "bad" })).toEqual({ [slots[0].id]: "Hi", [slots[1].id]: "Hey" });
  });
});

describe("removing an optional section", () => {
  const base = () =>
    v2(
      section("h", "header", { brand: "Iron & Grain" }),
      section("a", "hero", { headline: "Hello there" }),
      section("t", "testimonials", { items: [{ name: "Jane Doe", quote: "Brilliant" }] }),
      section("p", "pricing", { plans: [{ label: "Pro", price: "$99" }] }),
      section("c", "contact-form", { headline: "Write to us" }),
      section("f", "footer", { copyright: "© 2026 Iron & Grain" }),
    );

  it("offers only optional claims, never the header, hero, forms or footer", () => {
    expect(removableSections(page(base())[0]).map((s) => [s.id, s.kind])).toEqual([["t", "testimonials"], ["p", "pricing"]]);
    expect(removableSections(page(base())[0])[0].preview).toContain("Jane Doe");
  });

  it("removes only what is offered, and leaves everything else alone", () => {
    const out = removeSections(page(base())[0], ["t", "a", "h", "zzz"]);
    expect(out.removed).toEqual(["t"]);
    const ids = (out.doc.design as { pages: Array<{ rootNode: { children: Array<{ id: string }> } }> }).pages[0].rootNode.children.map((c) => c.id);
    expect(ids).toEqual(["h", "a", "p", "c", "f"]);
  });

  it("keeps a section a menu link jumps to", () => {
    const d = base();
    contentOf(d, 0).links = [{ label: "Pricing", href: "#p" }];
    expect(removableSections(page(d)[0]).map((s) => s.id)).toEqual(["t"]);
  });

  it("never leaves a page with almost nothing on it", () => {
    const small = v2(section("a", "hero", { headline: "Hello there" }), section("t", "testimonials", { items: [] }), section("f", "footer", { copyright: "© 2026" }));
    expect(removableSections(page(small)[0])).toEqual([]);
    expect(removeSections(page(small)[0], ["t"]).removed).toEqual([]);
  });
});
