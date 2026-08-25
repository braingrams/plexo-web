import { ComingSoonPanel } from "../../_components/ComingSoonPanel";

export default function CommerceDiscountsPage() {
  return (
    <ComingSoonPanel
      title="Discount codes"
      description="Percentage or fixed-amount codes, with an expiry and a usage limit — a fast-follow once the core checkout is live and proven."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.8"><path d="M20.6 12l-8.3 8.3a2 2 0 0 1-2.8 0l-6.8-6.8a2 2 0 0 1 0-2.8L11 2.4 20.6 12z" /><circle cx="8.5" cy="8.5" r="1.4" fill="#34d399" stroke="none" /></svg>}
    />
  );
}
