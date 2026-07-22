import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import IntegrationsClient from "./integrations-client";

export default async function IntegrationsPage() {
  const reqHeaders = await headers();
  let session = null;
  
  try {
    session = await auth.api.getSession({ headers: reqHeaders });
  } catch (err) {
    console.warn("[integrations] Session retrieval failed, redirecting to login:", err);
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/integrations");
  }

  // Fetch user's active API keys for easy 1-click copying
  const apiKeys = await prisma.apiKey.findMany({
    where: { userId: session.user.id, isActive: true },
    select: { id: true, name: true, maskedKey: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexobuilder.com";

  return (
    <IntegrationsClient
      user={{
        name: session.user.name ?? "Plexo User",
        email: session.user.email,
      }}
      apiKeys={apiKeys}
      baseUrl={baseUrl}
    />
  );
}
