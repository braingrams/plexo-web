// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/wpMigration/injectBaseHref", () => ({ injectBaseHref: (html: string) => html }));

import { BackToBlocks, BlockModeSwitch, ConvertToCodeDialog } from "@/app/dashboard/templates/[id]/ConvertToCode";
import { EditModeHint } from "@/app/dashboard/templates/[id]/EditModeHint";
import { EditModeSwitch } from "@/app/dashboard/templates/[id]/EditModeSwitch";
import { DesignCanvas, editFromDraft } from "@/app/dashboard/templates/[id]/DesignCanvas";
import { describeElement, parseSource } from "@/lib/editorModes/htmlSource";
import { MODE_HINT_KEY, hintWasSeen, modeHint } from "@/lib/editorModes/hintCopy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const mount = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
};
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const text = () => host.textContent ?? "";
const button = (label: RegExp | string) => [...host.querySelectorAll("button")].find((b) => (typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => void (el as HTMLElement).click());
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Design | Code | Text switcher in the block editor", () => {
  it("is Design here; picking Code or Text asks to turn the page into code first", async () => {
    const onPick = vi.fn();
    await mount(<BlockModeSwitch onPick={onPick} />);
    const radios = [...host.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(radios.map((r) => r.textContent)).toEqual(["Design", "Code", "Text"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].title).toMatch(/becomes editable code/);
    expect(radios[1].title).toMatch(/backup/);
    await click(radios[0]);
    expect(onPick).not.toHaveBeenCalled();
    await click(radios[1]);
    await click(radios[2]);
    expect(onPick.mock.calls).toEqual([["code"], ["text"]]);
  });
  it("the plain switcher keeps its own hover text", async () => {
    await mount(<EditModeSwitch value="code" onChange={() => undefined} />);
    expect((host.querySelector('[role="radio"]') as HTMLElement).title).toMatch(/as visitors will/);
  });
  it("moves between views with the arrow keys", async () => {
    const onChange = vi.fn();
    await mount(<EditModeSwitch value="design" onChange={onChange} />);
    await act(async () => void (host.querySelector('[role="radio"][aria-checked="true"]') as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("code");
  });
});

describe("the turn-into-code dialog", () => {
  const preview = (over: Record<string, unknown> = {}) => ({
    html: "<p>Hello</p>",
    hasUnpublishedChanges: false,
    isLive: true,
    notes: { copied: ["Your words, pictures, colours and fonts."], heads: ["Pages made of code don't have a separate draft: when you save a change, it goes live straight away."] },
    ...over,
  });
  let calls: { url: string; body: Record<string, unknown> }[];
  const mockFetch = (responses: Record<string, unknown>[], status = 200) => {
    calls = [];
    let i = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      const body = responses[Math.min(i++, responses.length - 1)];
      return { ok: status < 400, status, json: async () => body } as Response;
    });
  };
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockClear();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, configurable: true });
  });
  const open = (over: Partial<React.ComponentProps<typeof ConvertToCodeDialog>> = {}) =>
    mount(<ConvertToCodeDialog templateId="p1" templateName="Home" target="code" saveFirst={async () => undefined} onClose={() => undefined} {...over} />);

  it("explains in plain words, saves first, shows the page as it will be, and keeps the button off until it is ready", async () => {
    const saveFirst = vi.fn(async () => undefined);
    let release!: (r: Response) => void;
    calls = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Promise<Response>((resolve) => (release = resolve));
    });
    await open({ saveFirst });
    expect(text()).toContain("This turns your page into editable code. It will look the same. We keep a backup you can restore.");
    expect(text()).toContain("Getting your page ready");
    expect(button("Turn into code")!.disabled).toBe(true);
    await act(async () => release({ ok: true, json: async () => preview() } as Response));
    expect(saveFirst).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ url: "/api/templates/p1/convert-to-code", body: { preview: true, source: "working" } });
    expect(text()).toContain("What comes along");
    expect(text()).toContain("Good to know");
    expect(text()).toContain("Go back to blocks");
    expect((host.querySelector("iframe") as HTMLIFrameElement).getAttribute("srcdoc")).toBe("<p>Hello</p>");
    expect(button("Turn into code")!.disabled).toBe(false);
  });

  it("does it, then opens the view that was asked for", async () => {
    mockFetch([preview(), { template: { id: "p1" } }]);
    await open({ target: "text" });
    await flush();
    await flush();
    expect(text()).toContain("Change the words on this page");
    await click(button("Turn into code"));
    await flush();
    expect(calls[1]).toEqual({ url: "/api/templates/p1/convert-to-code", body: { source: "working" } });
    expect(assign).toHaveBeenCalledWith("/dashboard/templates/p1?mode=text");
  });

  it("asks which version to keep only when there are unpublished changes on a live page, and previews the one picked", async () => {
    mockFetch([preview({ hasUnpublishedChanges: true }), preview({ hasUnpublishedChanges: true, html: "<p>LIVE</p>" }), { template: { id: "p1" } }]);
    await open();
    await flush();
    await flush();
    expect(text()).toContain("You have changes you haven’t published");
    const radios = [...host.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    await act(async () => void radios[1].click());
    await flush();
    await flush();
    expect(calls[1].body).toEqual({ preview: true, source: "live" });
    expect((host.querySelector("iframe") as HTMLIFrameElement).getAttribute("srcdoc")).toBe("<p>LIVE</p>");
    await click(button("Turn into code"));
    await flush();
    expect(calls[2].body).toEqual({ source: "live" });
  });

  it("doesn't ask when there is nothing to choose, and never sends a stale choice", async () => {
    mockFetch([preview({ hasUnpublishedChanges: true, isLive: false }), { template: { id: "p1" } }]);
    await open();
    await flush();
    await flush();
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    await click(button("Turn into code"));
    await flush();
    expect(calls[1].body).toEqual({ source: "working" });
  });

  it("says what went wrong in plain words, changes nothing, and lets you try again", async () => {
    mockFetch([{ error: "We couldn't be sure this page would look exactly the same as code, so we left it as it is. Nothing was changed." }], 400);
    await open();
    await flush();
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Nothing was changed");
    expect(button("Turn into code")).toBeUndefined();
    expect(button("Try again")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the page when the final step fails", async () => {
    calls = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return n++ === 0 ? ({ ok: true, json: async () => preview() } as Response) : ({ ok: false, json: async () => ({ error: "This page was just changed somewhere else. Please reload it and try again." }) } as Response);
    });
    await open();
    await flush();
    await flush();
    await click(button("Turn into code"));
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("reload it");
    expect(assign).not.toHaveBeenCalled();
    expect(button("Turn into code")!.disabled).toBe(false);
  });

  it("closes with Not now", async () => {
    mockFetch([preview()]);
    const onClose = vi.fn();
    await open({ onClose });
    await flush();
    await click(button("Not now"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("go back to blocks", () => {
  it("says what is lost before it asks, then restores and opens the block editor", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, configurable: true });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    await mount(<BackToBlocks templateId="p1" />);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click(button("Go back to blocks"));
    expect(text()).toContain("Anything you have changed in the code since will be lost.");
    await click(button("Stay with code"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await click(button("Go back to blocks"));
    await click([...host.querySelectorAll("button")].filter((b) => b.textContent === "Go back to blocks")[1]);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/templates/p1/restore-blocks", { method: "POST" });
    expect(assign).toHaveBeenCalledWith("/dashboard/templates/p1");
  });
  it("shows a plain message when it can't", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({ error: "The block version of this page is no longer saved, so it can't be restored." }) }) as Response);
    await mount(<BackToBlocks templateId="p1" />);
    await click(button("Go back to blocks"));
    await click([...host.querySelectorAll("button")].filter((b) => b.textContent === "Go back to blocks")[1]);
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("no longer saved");
  });
});

describe("first-use hint", () => {
  it("shows once, in plain words, and stays closed after Got it", async () => {
    await mount(<EditModeHint pageKey="p1" />);
    expect(text()).toContain("Three ways to change this page");
    expect(text()).toContain("Click anything on the page");
    await click(button("Got it"));
    expect(host.querySelector('[role="region"]')).toBeNull();
    expect(localStorage.getItem(MODE_HINT_KEY)).toBe("1");
    await act(async () => root.render(<EditModeHint pageKey="p2" />));
    expect(host.querySelector('[role="region"]')).toBeNull();
  });
  it("speaks to a block page differently and says it is safe", async () => {
    await mount(<EditModeHint pageKey="p1" blocks />);
    expect(text()).toContain("You can change this page as code, too");
    expect(text()).toContain("we keep a backup");
  });
  it("copes with storage that isn't there", () => {
    expect(hintWasSeen(null)).toBe(false);
    expect(hintWasSeen({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(modeHint(false).points.map((p) => p.label)).toEqual(["Design", "Code", "Text"]);
  });
});

describe("Design view: change it right on the page", () => {
  const html = '<!doctype html><html><body><h1>Hello</h1><a href="/about">About us</a><img src="a.png" alt="Logo"><div id="app"></div></body></html>';
  const pick = async (index: number) => {
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { plx: "pick", index }, source: frame.contentWindow as MessageEventSource }));
    });
  };
  const indexOf = (tag: string) => parseSource(html).elements.find((e) => e.name === tag)!.index;

  it("starts by saying what to do", async () => {
    await mount(<DesignCanvas files={[]} edits={{ "index.html": html }} html={html} onChangeHtml={() => undefined} />);
    expect(text()).toContain("Click anything on your page");
    expect((host.querySelector("iframe") as HTMLIFrameElement).title).toMatch(/Click anything/);
  });

  it("changes words and a link in the page's own code, only after Apply", async () => {
    const onChange = vi.fn();
    await mount(<DesignCanvas files={[]} edits={{ "index.html": html }} html={html} onChangeHtml={onChange} />);
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    if (!frame.contentWindow) throw new Error("no frame window");
    await pick(indexOf("a"));
    const words = host.querySelector("#plx-dc-t-0") as HTMLTextAreaElement;
    expect(words.value).toBe("About us");
    expect(button("Apply")!.disabled).toBe(true);
    const set = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => set(words, "Who we are"));
    await act(async () => set(host.querySelector("#plx-dc-href") as HTMLInputElement, "/team"));
    expect(onChange).not.toHaveBeenCalled();
    await click(button("Apply"));
    expect(onChange).toHaveBeenCalledWith(html.replace("/about", "/team").replace("About us", "Who we are"));
  });

  it("offers a picture's description and upload, and says what can't be changed by clicking", async () => {
    await mount(<DesignCanvas files={[]} edits={{ "index.html": html }} html={html} onChangeHtml={() => undefined} />);
    const frame = host.querySelector("iframe") as HTMLIFrameElement;
    if (!frame.contentWindow) throw new Error("no frame window");
    await pick(indexOf("img"));
    expect(text()).toContain("Choose a new picture");
    expect((host.querySelector("#plx-dc-alt") as HTMLInputElement).value).toBe("Logo");
    await pick(indexOf("div"));
    expect(text()).toContain("Use Code to change it");
  });
});

describe("what the panel applies", () => {
  const html = '<h1>Hello</h1><a href="/x"><img src="a.png" alt="A"></a>';
  const info = (tag: string) => describeElement(parseSource(html), parseSource(html).elements.find((e) => e.name === tag)!.index)!;
  it("is only what changed", () => {
    const h1 = info("h1");
    expect(editFromDraft(h1, { texts: { 0: "Hello" }, href: "", src: "", alt: "" })).toEqual({});
    expect(editFromDraft(h1, { texts: { 0: "Hi" }, href: "", src: "", alt: "" })).toEqual({ texts: [{ id: 0, text: "Hi" }] });
    const img = info("img");
    expect(editFromDraft(img, { texts: {}, href: "/x", src: "b.png", alt: "A" })).toEqual({ src: "b.png" });
    expect(editFromDraft(img, { texts: {}, href: "/y", src: "a.png", alt: "B" })).toEqual({ href: "/y", alt: "B" });
  });
});

describe("the script that runs inside the Design preview", async () => {
  const { annotateForDesign: annotate, designBridgeScript: bridge, describeElement: describe2, parseSource: parse2 } = await import("@/lib/editorModes/htmlSource");
  it("reports which element was clicked (even a click on something inside it), outlines it, and stops links and forms", () => {
    const html = '<body><h1 id="h">Hello <b id="b">big</b></h1><a id="a" href="/x">Go</a><form id="f"><button>Send</button></form><p id="added">no number</p></body>';
    document.body.innerHTML = annotate(html).replace(/^.*<body>|<\/body>.*$/g, "");
    document.getElementById("added")!.removeAttribute("data-plx-i");
    const sent: unknown[] = [];
    vi.spyOn(window, "postMessage").mockImplementation(((m: unknown) => void sent.push(m)) as never);
    const code = /<script data-plx-bridge>([\s\S]*)<\/script>/.exec(bridge({ scrollY: 0, selected: -1 }))![1];
    new Function(code)();

    const doc = parse2(html);
    const b = document.getElementById("b")!;
    const clicked = new MouseEvent("click", { bubbles: true, cancelable: true });
    b.dispatchEvent(clicked);
    expect(sent.at(-1)).toEqual({ plx: "pick", index: doc.elements.find((e) => e.name === "b")!.index });
    expect(describe2(doc, (sent.at(-1) as { index: number }).index)!.texts[0].text).toBe("big");
    expect(b.classList.contains("plx-picked")).toBe(true);
    expect(clicked.defaultPrevented).toBe(true);

    const link = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("a")!.dispatchEvent(link);
    expect(link.defaultPrevented).toBe(true);
    expect(b.classList.contains("plx-picked")).toBe(false);

    const submit = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("f")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);

    // Something the page's own script added has no number: nothing is picked.
    document.getElementById("added")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(sent.at(-1)).toEqual({ plx: "pick", index: -1 });
  });
});
