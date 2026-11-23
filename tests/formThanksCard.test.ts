// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(process.cwd(), "public/plexo-forms.js"), "utf8");

function load(url: string, body: string) {
  window.history.replaceState(null, "", url);
  document.body.innerHTML = body;
  const el = document.createElement("script");
  el.setAttribute("data-template-id", "site1");
  Object.defineProperty(document, "currentScript", { value: el, configurable: true });
  (window as unknown as { __plexoFormsLoaded?: boolean }).__plexoFormsLoaded = false;
  new Function(SRC)();
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });
}

const MIGRATED = `<form id="get_started_form" action="/api/public/forms/site1/submit?form=Contact"></form>
  <div role="status">Thank you — your submission has been received. We'll be in touch soon.</div>`;

describe("the thank-you card after a form is sent", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("shows a clear card with a promise when a migrated form sends the visitor back", () => {
    load("/?plexo_form=get-started-form#get_started_form", MIGRATED);
    const card = document.querySelector("[data-plexo-thanks]");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Message received");
    expect(card!.textContent).toContain("someone will reach out to you soon");
  });
  it("replaces the old note that sat out of sight beside the form", () => {
    load("/?plexo_form=get-started-form", MIGRATED);
    expect(document.querySelectorAll('[role="status"]').length).toBe(1);
    expect(document.querySelector("[data-plexo-thanks]")).not.toBeNull();
  });
  it("shows it once: the address is cleaned so a reload doesn't repeat it", () => {
    load("/?plexo_form=get-started-form#get_started_form", MIGRATED);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#get_started_form");
  });
  it("can be closed with the button", () => {
    load("/?plexo_form=x", MIGRATED);
    (document.querySelector("[data-plexo-thanks] button") as HTMLButtonElement).click();
    expect(document.querySelector("[data-plexo-thanks]")).toBeNull();
  });
  it("says nothing on an ordinary visit", () => {
    load("/", MIGRATED);
    expect(document.querySelector("[data-plexo-thanks]")).toBeNull();
  });
  it("asks to try again when the verification box was missed", () => {
    load("/?plexo_form_error=captcha", MIGRATED);
    const card = document.querySelector("[data-plexo-thanks]");
    expect(card?.getAttribute("role")).toBe("alert");
    expect(card?.textContent).toContain("verification box");
  });
});
