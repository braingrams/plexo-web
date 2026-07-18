import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { SdkClient } from "./sdk-client";

export default async function DashboardSdkPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/sdk");
  }

  // Fetch active API keys for this user to display in their code integration tab
  const apiKeys = await prisma.apiKey.findMany({
    where: {
      userId: session.user.id,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      maskedKey: true,
    },
  });

  return (
    <div style={{ padding: "2rem 1.75rem", maxWidth: 1500, margin: "0 auto" }}>
      <SdkClient initialKeys={apiKeys} />
    </div>
  );
}
