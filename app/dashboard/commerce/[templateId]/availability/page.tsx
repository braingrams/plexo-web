import { CommerceProduct } from "@/lib/db/commerceEntities";
import { AvailabilityClient } from "./AvailabilityClient";

export default async function CommerceAvailabilityPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const { data: products } = await CommerceProduct.query.primary({ templateId }).go();
  const services = products
    .filter((p) => p.kind === "SERVICE")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, durationMinutes: p.durationMinutes ?? null }));

  return <AvailabilityClient templateId={templateId} services={services} />;
}
