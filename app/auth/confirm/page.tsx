import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { ConfirmView } from "./ConfirmClient";
import { redirect } from "next/navigation";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const email = params.email;

  if (token) {
    // Links sent before the change still carry email; the verify route accepts both shapes.
    const query = new URLSearchParams({ token });
    if (email) query.set("email", email);
    redirect(`/api/auth/verify-email?${query.toString()}`);
  }

  return (
    <AuthShell>
      <ConfirmView />
    </AuthShell>
  );
}
