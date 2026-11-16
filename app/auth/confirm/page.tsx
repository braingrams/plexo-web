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

  if (token && email) {
    const target = `/api/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    redirect(target);
  }

  return (
    <AuthShell>
      <ConfirmView email={email} />
    </AuthShell>
  );
}
