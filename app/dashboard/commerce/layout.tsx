import { PageContainer } from "../_components/PageContainer";
import { CommerceNav } from "./_components/CommerceNav";

/** Shell for every /dashboard/commerce/* route: the module's own sub-navigation
 * (Overview/Products/Orders/Availability/Customers/Discounts/Settings) beside whatever
 * that page renders. Each page still does its own auth/org check (same convention as
 * every other dashboard page) — this layout is purely structural. */
export default function CommerceLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer>
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start" }}>
        <CommerceNav />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </PageContainer>
  );
}
