import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { UploadRawClient } from "./upload-client";
import { PageContainer } from "../../_components/PageContainer";

export default async function UploadRawPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <PageContainer>
      <UploadRawClient />
    </PageContainer>
  );
}
