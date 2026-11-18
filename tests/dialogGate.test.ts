// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { otherDialogOpen } from "@/lib/dashboardV3/dialogs";

const dialog = (inner = "") => `<div role="dialog" aria-modal="true">${inner}</div>`;

describe("the tour offer waits for other dialogs", () => {
  it("is free to open when nothing else is open, or only the offer itself", () => {
    document.body.innerHTML = "";
    expect(otherDialogOpen(document, "plx-tour-offer")).toBe(false);
    document.body.innerHTML = dialog('<div class="plx-tour-offer"></div>');
    expect(otherDialogOpen(document, "plx-tour-offer")).toBe(false);
  });

  it("steps aside when another dialog is open, even with the offer open too", () => {
    document.body.innerHTML = dialog("<p>Setting things up</p>");
    expect(otherDialogOpen(document, "plx-tour-offer")).toBe(true);
    document.body.innerHTML = dialog('<div class="plx-tour-offer"></div>') + dialog("<p>Other</p>");
    expect(otherDialogOpen(document, "plx-tour-offer")).toBe(true);
  });
});
