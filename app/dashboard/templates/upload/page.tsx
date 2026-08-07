import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { UploadRawClient } from "./upload-client";
import { PageContainer } from "../../_components/PageContainer";

export default async function UploadRawPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <PageContainer>
      <UploadRawClient />
    </PageContainer>
  );
}
