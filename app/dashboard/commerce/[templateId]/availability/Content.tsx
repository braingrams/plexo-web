import { CommerceProduct } from "@/lib/db/commerceEntities";
import { AvailabilityClient } from "./AvailabilityClient";
import { BookingPanel } from "@/app/dashboard/_v3/hub/shop/BookingPanel";

export async function AvailabilityContent({ templateId, hub }: { templateId: string; hub?: boolean }) {

  const { data: products } = await CommerceProduct.query.primary({ templateId }).go({ pages: "all" });
  const services = products
    .filter((p) => p.kind === "SERVICE")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, durationMinutes: p.durationMinutes ?? null }));

  return hub ? <BookingPanel templateId={templateId} services={services} /> : <AvailabilityClient templateId={templateId} services={services} />;
}
