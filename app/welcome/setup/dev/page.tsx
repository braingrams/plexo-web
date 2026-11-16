import { notFound } from "next/navigation";
import { V3Root } from "@/app/dashboard/_v3/V3Root";
import { Wizard } from "../Wizard";

/** Development-only: the wizard without signing in, with saving switched off (screenshots, design review). */
export default async function OnboardingDevPreview({ searchParams }: { searchParams: Promise<{ theme?: string; existing?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  return (
    <V3Root themePreference={sp.theme === "dark" ? "dark" : "light"} persistTheme={false}>
      <Wizard userId="dev" hasSites={sp.existing === "1"} mock />
    </V3Root>
  );
}
