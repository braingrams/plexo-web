// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The wizard does network work on mount; the modal test only cares that it opens, closes, and gets the plan.
const wizardProps = vi.hoisted(() => ({ last: null as null | { plan?: string; onClose?: () => void } }));
vi.mock("../app/dashboard/new/NewSiteWizard", () => ({
  NewSiteWizard: (props: { plan?: string; onClose?: () => void }) => {
    wizardProps.last = props;
    return null;
  },
}));

import { NewSiteProvider, useNewSite } from "../app/dashboard/_components/NewSiteModal";

function Opener() {
  const { openNewSite } = useNewSite();
  return <button id="open" onClick={openNewSite}>open</button>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  wizardProps.last = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NewSiteProvider", () => {
  it("is closed until a button asks for it", () => {
    act(() => root.render(<NewSiteProvider plan="PRO"><Opener /></NewSiteProvider>));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens the wizard in a modal and passes the plan through", () => {
    act(() => root.render(<NewSiteProvider plan="PRO"><Opener /></NewSiteProvider>));
    act(() => (document.getElementById("open") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(wizardProps.last?.plan).toBe("PRO");
    expect(typeof wizardProps.last?.onClose).toBe("function");
  });

  it("closes on Escape", () => {
    act(() => root.render(<NewSiteProvider plan="FREE"><Opener /></NewSiteProvider>));
    act(() => (document.getElementById("open") as HTMLButtonElement).click());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("throws when used outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => act(() => root.render(<Opener />))).toThrow(/inside NewSiteProvider/);
    spy.mockRestore();
  });
});
