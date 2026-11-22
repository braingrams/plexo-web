"use client";

import { useState } from "react";
import { TabBar } from "../HubFrame";
import { cx } from "../../ui/cx";

export type DonationSubTab = "home" | "wallet" | "payments";

const SUB_TITLES: Record<DonationSubTab, { title: string; sub: string }> = {
  home: { title: "Donations", sub: "Gifts people give, one-off or every month." },
  wallet: { title: "Your money", sub: "What you've earned, and how to move it to your bank account." },
  payments: { title: "Payment settings", sub: "Cards, Paystack, Stripe, bank transfers and currency for your donations." },
};

/**
 * 3-tab layout for Donations: Home (forms, stats, gifts), Wallet (earnings, payouts),
 * and Payment settings (Stripe, Paystack, bank details, currency, alerts email).
 */
export function DonationsHubView({
  initialSub = "home",
  home,
  wallet,
  payments,
}: {
  siteId: string;
  initialSub?: DonationSubTab;
  home: React.ReactNode;
  wallet: React.ReactNode;
  payments: React.ReactNode;
}) {
  const [active, setActive] = useState<DonationSubTab>(initialSub);

  const select = (tab: DonationSubTab) => {
    setActive(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "donations");
      if (tab === "home") {
        url.searchParams.delete("sub");
        url.searchParams.delete("section");
        url.searchParams.delete("part");
      } else {
        url.searchParams.set("sub", tab);
        url.searchParams.delete("section");
        url.searchParams.delete("part");
      }
      window.history.replaceState(null, "", url.toString());
    }
  };

  const nav = (
    <div className="plx-don__subnav" role="tablist" aria-label="Donations navigation">
      <button
        type="button"
        role="tab"
        id="plx-don-tab-home"
        aria-selected={active === "home"}
        className={cx("plx-don__subtab", active === "home" && "is-active")}
        onClick={() => select("home")}
      >
        Home
      </button>
      <button
        type="button"
        role="tab"
        id="plx-don-tab-wallet"
        aria-selected={active === "wallet"}
        className={cx("plx-don__subtab", active === "wallet" && "is-active")}
        onClick={() => select("wallet")}
      >
        Wallet
      </button>
      <button
        type="button"
        role="tab"
        id="plx-don-tab-payments"
        aria-selected={active === "payments"}
        className={cx("plx-don__subtab", active === "payments" && "is-active")}
        onClick={() => select("payments")}
      >
        Payment settings
      </button>
    </div>
  );

  return (
    <div className="plx-don__root" data-tour="hub-donations">
      <TabBar
        title={SUB_TITLES[active].title}
        sub={SUB_TITLES[active].sub}
        action={nav}
      />
      <div className="plx-don__content" style={{ marginTop: 20 }}>
        {active === "home" && home}
        {active === "wallet" && wallet}
        {active === "payments" && payments}
      </div>
    </div>
  );
}
