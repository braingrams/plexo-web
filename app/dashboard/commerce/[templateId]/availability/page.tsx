import { prisma } from "@/server/prisma";
import { AvailabilityClient } from "./AvailabilityClient";

export default async function CommerceAvailabilityPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const services = await prisma.commerceProduct.findMany({
    where: { templateId, kind: "SERVICE" },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { name: "asc" },
  });

  return <AvailabilityClient templateId={templateId} services={services} />;
}
