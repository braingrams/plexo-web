import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { V3Root } from "@/app/dashboard/_v3/V3Root";
import { resolveThemePreference, THEME_COOKIE } from "@/lib/dashboardV3/theme";
import { PreviewShell } from "./PreviewShell";

export const metadata = { title: "v3 preview", robots: { index: false } };

/**
 * DEV ONLY: the v3 shell + UI kit with made-up data, for building and screenshotting without a
 * signed-in session or a database. 404s anywhere but `next dev`.
 */
export default async function V3PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const jar = await cookies();
  return (
    <V3Root themePreference={resolveThemePreference({ cookie: jar.get(THEME_COOKIE)?.value })} persistTheme={false}>
      <PreviewShell>{children}</PreviewShell>
    </V3Root>
  );
}
