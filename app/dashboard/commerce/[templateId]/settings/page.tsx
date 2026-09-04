import { redirect } from "next/navigation";

/** Bare /settings has no content of its own — General/Payments/Notifications are the
 * three real sub-pages (see settings/layout.tsx's pill nav). Same redirect-stub pattern
 * as the Commerce module's own root (app/dashboard/commerce/page.tsx). */
export default async function CommerceSettingsRootPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  redirect(`/dashboard/commerce/${templateId}/settings/general`);
}
