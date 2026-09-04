import { SettingsPillNav } from "./_components/SettingsPillNav";

/** Shared chrome for the three Settings sub-pages (General/Payments/Notifications) — a
 * horizontal pill sub-nav, not a sidebar. The parent [templateId]/layout.tsx already did
 * the ownership check; this just adds one more (lighter-weight) level of navigation
 * underneath its site header + section tabs. */
export default async function CommerceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return (
    <div>
      <SettingsPillNav templateId={templateId} />
      {children}
    </div>
  );
}
