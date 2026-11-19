// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultLayoutForSlug, contentSnippet } from "@/lib/customContent/embed";
import { normalizeFieldsInput, validateEntryData } from "@/lib/customContent/fields";

const contentJs = readFileSync("public/plexo-content.js", "utf8");
const formsJs = readFileSync("public/plexo-forms.js", "utf8");

const flush = () => new Promise((r) => setTimeout(r, 0));

function load(code: string, attrs: Record<string, string> = {}) {
  (window as any).__plexoContentLoaded = false;
  (window as any).__plexoFormsLoaded = false;
  const el = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => el });
  window.eval(code);
}

// Each test loads the scripts afresh into the same jsdom document; drop the previous test's listeners.
const added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
const realAdd = document.addEventListener.bind(document);
beforeEach(() => {
  document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => { added.push([t, l, o]); realAdd(t, l, o); }) as typeof document.addEventListener;
});
afterEach(() => {
  for (const [t, l, o] of added.splice(0)) document.removeEventListener(t, l, o);
});
beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("content widget", () => {
  it("renders a video gallery with escaped text and opens a player", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ entries: [
        { id: "1", title: "<b>A Life</b> Well Lived", description: "Lessons", video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
        { id: "2", title: "Evil", video: "javascript:alert(1)", image: "javascript:alert(2)" },
      ] }),
    })));
    document.body.innerHTML = `<div data-plexo-content="videos" data-plexo-content-layout="gallery"></div>`;
    load(contentJs);
    await flush(); await flush();
    const cards = document.querySelectorAll(".plx-c-card");
    expect(cards.length).toBe(2);
    expect(document.querySelector("b")).toBeNull(); // text, not markup
    expect(cards[0].querySelector("img")!.getAttribute("src")).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");
    expect(document.body.innerHTML).not.toContain("javascript:");
    (cards[0] as HTMLElement).click();
    expect(document.querySelector(".plx-c-dialog iframe")!.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    (document.querySelector(".plx-c-close") as HTMLElement).click();
    expect(document.querySelector(".plx-c-dialog")).toBeNull();
  });

  it("events: hides past ones, sorts soonest first, friendly empty state", async () => {
    const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 16);
    const mk = (entries: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries }) })));
    mk([{ title: "Later", date: future(20) }, { title: "Past", date: "2001-01-01T10:00" }, { title: "Soon", date: future(2) }]);
    document.body.innerHTML = `<div data-plexo-content="happenings" data-plexo-content-layout="events"></div>`;
    load(contentJs);
    await flush(); await flush();
    const titles = [...document.querySelectorAll(".plx-c-event .plx-c-title")].map((n) => n.textContent);
    expect(titles).toEqual(["Soon", "Later"]);

    document.body.innerHTML = `<div data-plexo-content="happenings" data-plexo-content-layout="events"></div>`;
    mk([{ title: "Past", date: "2001-01-01T10:00" }]);
    load(contentJs);
    await flush(); await flush();
    expect(document.querySelector(".plx-c-empty")!.textContent).toContain("No upcoming events right now");
  });

  it("picks up markers added later (React apps)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ entries: [{ title: "Story one", body: "Para one\n\nPara two" }] }) })));
    load(contentJs);
    const div = document.createElement("div");
    div.setAttribute("data-plexo-content", "stories");
    div.setAttribute("data-plexo-content-layout", "stories");
    document.body.appendChild(div);
    await flush(); await flush(); await flush();
    expect(div.querySelectorAll(".plx-c-card").length).toBe(1);
    (div.querySelector(".plx-c-card") as HTMLElement).click();
    expect(document.querySelectorAll(".plx-c-dialog p").length).toBeGreaterThanOrEqual(2);
  });
});

describe("form connector", () => {
  const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  // The connector also asks (once per form) whether a verification box is set up; only sends count here.
  const sends = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.filter((c) => !String(c[0]).includes("/captcha?"));

  it("connects a form with no action, names unnamed fields, and shows a thank-you", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, redirect: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `<form id="contact"><label for="e">Your email</label><input id="e" type="email" value="a@b.co"><textarea placeholder="Message">hi</textarea><button type="submit">Send</button></form>`;
    load(formsJs, { "data-template-id": "tpl_1", "data-auto": "true" });
    const form = document.getElementById("contact") as HTMLFormElement;
    submit(form);
    await flush(); await flush();
    expect(sends(fetchMock)).toHaveLength(1);
    const [url, init] = sends(fetchMock)[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/public/forms/tpl_1/submit?form=contact");
    const fd = init.body as FormData;
    expect(fd.get("Your email")).toBe("a@b.co");
    expect(fd.get("Message")).toBe("hi");
    expect(form.querySelector("[data-plexo-form-message]")!.textContent).toContain("Thank you");
  });

  it("leaves forms that already post elsewhere, login and search forms alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `
      <form id="a" action="https://example.com/x"><input name="q"></form>
      <form id="b"><input type="password"><input name="u"></form>
      <form id="c" role="search"><input type="search"></form>
      <form id="d" data-plexo-form="off"><input name="x"></form>`;
    load(formsJs, { "data-template-id": "tpl_1", "data-auto": "true" });
    for (const id of ["a", "b", "c", "d"]) {
      const ev = new Event("submit", { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never takes over a shop form — a checkout that is swallowed makes no order", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
      ["/aso-ebi/checkout", `<form id="f" novalidate><input name="name"></form>`, { storefrontPath: "/aso-ebi", checkoutPath: "/aso-ebi/checkout" }],
      ["/aso-ebi/track", `<form id="f"><input name="order"></form>`, { storefrontPath: "aso-ebi", checkoutPath: null }],
      ["/pay", `<form id="f"><input name="n"></form>`, { storefrontPath: "/store", checkoutPath: "/pay/" }],
      ["/give", `<form id="f" data-plexo-donation="c1"><input name="amount"></form>`, undefined],
    ];
    for (const [path, html, cfg] of cases) {
      history.replaceState({}, "", path);
      (window as any).__PLEXO_COMMERCE__ = cfg;
      document.body.innerHTML = html;
      load(formsJs, { "data-template-id": "tpl_1", "data-auto": "true" });
      const ev = new Event("submit", { bubbles: true, cancelable: true });
      document.getElementById("f")!.dispatchEvent(ev);
      expect(ev.defaultPrevented, path).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("draws the owner's verification box on a migrated form that has one saved, and none on a form that doesn't", async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => (url.includes("form=Secured") ? { provider: "turnstile", siteKey: "0x4AAAAAADcYRIowzCZgtAXn" } : { provider: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `<form id="a" method="post" action="/api/public/forms/tpl_1/submit?form=Secured&redirect=%2F"><input name="m"><button>Send</button></form><form id="b" method="post" action="/api/public/forms/tpl_1/submit?form=Open&redirect=%2F"><input name="m"><button>Send</button></form>`;
    load(formsJs, { "data-template-id": "tpl_1", "data-auto": "true" });
    await flush(); await flush();
    expect(document.querySelector("#a [data-plexo-captcha=turnstile]")).not.toBeNull();
    expect(document.querySelector("#b [data-plexo-captcha]")).toBeNull();
  });

  it("still connects an ordinary contact form on a commerce site, and an explicitly marked one anywhere", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    (window as any).__PLEXO_COMMERCE__ = { storefrontPath: "/aso-ebi", checkoutPath: "/aso-ebi/checkout" };
    history.replaceState({}, "", "/contact");
    document.body.innerHTML = `<form id="a"><input name="m" value="hi"></form>`;
    load(formsJs, { "data-template-id": "tpl_1", "data-auto": "true" });
    submit(document.getElementById("a") as HTMLFormElement);
    await flush();
    history.replaceState({}, "", "/aso-ebi/checkout");
    document.body.innerHTML = `<form id="b" data-plexo-form="Questions"><input name="m" value="hi"></form>`;
    submit(document.getElementById("b") as HTMLFormElement);
    await flush();
    expect(sends(fetchMock)).toHaveLength(2);
    delete (window as any).__PLEXO_COMMERCE__;
    history.replaceState({}, "", "/");
  });

  it("React mode connects only forms marked data-plexo-form", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `<form id="x"><input name="a" value="1"></form><form id="y" data-plexo-form="Newsletter"><input name="a" value="1"></form>`;
    load(formsJs, { "data-template-id": "tpl_1", "data-auto": "false" });
    const ex = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("x")!.dispatchEvent(ex);
    expect(ex.defaultPrevented).toBe(false);
    submit(document.getElementById("y") as HTMLFormElement);
    await flush();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("form=Newsletter");
  });

  it("shows the server's message when sending fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Too many submissions. Please try again shortly." }) })));
    document.body.innerHTML = `<form id="f" data-plexo-form="Contact"><input name="a" value="1"><button>Go</button></form>`;
    load(formsJs, { "data-template-id": "tpl_1" });
    submit(document.getElementById("f") as HTMLFormElement);
    await flush(); await flush();
    expect(document.querySelector("[data-plexo-form-message]")!.textContent).toContain("Too many submissions");
    expect(document.querySelector("button")!.disabled).toBe(false);
  });
});

describe("content types", () => {
  it("accepts video and datetime fields", () => {
    const f = normalizeFieldsInput([{ name: "Video", type: "video" }, { name: "Starts", type: "datetime" }]);
    expect("fields" in f).toBe(true);
    if ("fields" in f) expect(validateEntryData(f.fields, { video: "https://youtu.be/x", starts: "2026-11-01T18:00" })).toHaveProperty("data");
  });
  it("snippets", () => {
    expect(defaultLayoutForSlug("happenings")).toBe("events");
    expect(contentSnippet("videos", { limit: 6 })).toBe('<div data-plexo-content="videos" data-plexo-content-layout="gallery" data-plexo-content-limit="6"></div>');
  });
});
