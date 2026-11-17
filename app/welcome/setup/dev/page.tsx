import { notFound } from "next/navigation";
import { V3Root } from "@/app/dashboard/_v3/V3Root";
import { Wizard } from "../Wizard";
import { TuneWizard } from "../TuneWizard";
import { MANY_SITES } from "@/app/v3-preview/fixtures";

/** Development-only: the wizard without signing in, with saving switched off (screenshots, design review). */
export default async function OnboardingDevPreview({ searchParams }: { searchParams: Promise<{ theme?: string; existing?: string; one?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  return (
    <V3Root themePreference={sp.theme === "dark" ? "dark" : "light"} persistTheme={false}>
      {sp.existing === "1" ? <TuneWizard sites={sp.one === "1" ? MANY_SITES.slice(0, 1) : MANY_SITES.slice(0, 8)} mock /> : <Wizard userId="dev" hasSites={false} mock />}
    </V3Root>
  );
}
