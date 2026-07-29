import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { UploadRawClient } from "./upload-client";

export default async function UploadRawPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  return (
    <div style={{ padding: "2rem 8px", maxWidth: 720, margin: "0 auto" }}>
      <UploadRawClient />
    </div>
  );
}
