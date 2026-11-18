import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
import { ListingsView } from "@/app/dashboard/_v3/designs/ListingsView";
import { PayoutsView } from "@/app/dashboard/_v3/designs/PayoutsView";

describe("Designs screens render in plain words", () => {
  it("an empty listings page says what to do next", () => {
    const html = renderToStaticMarkup(<ListingsView listings={[]} />);
    expect(html).toContain("You have not put a design up for sale yet");
    expect(html).toContain("Sell a design");
    expect(html).not.toMatch(/template/i);
  });
  it("a rejected listing shows the reason and a plain status", () => {
    const html = renderToStaticMarkup(
      <ListingsView listings={[{ id: "1", name: "Cafe", kind: "LANDING_PAGE", marketplaceStatus: "REJECTED", marketplaceRejectionReason: "Add a real picture", priceCents: 500, purchaseCount: 1 }]} />,
    );
    expect(html).toContain("Not approved");
    expect(html).toContain("Add a real picture");
    expect(html).not.toContain("REJECTED");
  });
  it("earnings show the balance, the split and empty states", () => {
    const html = renderToStaticMarkup(<PayoutsView balanceCents={12345} feeBps={2000} withdrawals={[]} ledger={[]} ledgerTotal={0} page={1} pageSize={25} />);
    expect(html).toContain("$123.45");
    expect(html).toContain("You keep 80%");
    expect(html).toContain("No sales yet");
  });
});
