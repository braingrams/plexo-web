import { ComingSoonPanel } from "../../_components/ComingSoonPanel";

export default function CommerceOrdersPage() {
  return (
    <ComingSoonPanel
      title="Orders"
      description="Every order, its payment and fulfillment status, and a refund action — the Overview page's recent-orders list moves here once there's enough volume to need its own page."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v6h6" /></svg>}
    />
  );
}
