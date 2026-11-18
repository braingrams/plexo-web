import { notFound } from "next/navigation";
import { NewSiteFlow } from "@/app/dashboard/_v3/newsite/NewSiteFlow";

/** DEV ONLY: the new "Make a new website" flow with made-up data. ?mode=page|dialog  &plan=FREE|PRO */
export default async function NewSitePreview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const q = await searchParams;
  return (
    <NewSiteFlow
      preview={q.screen === "goal" || q.screen === "look" || q.screen === "all" ? { screen: q.screen, goal: "store", mock: q.mock === "1" } : undefined}
      mode={q.mode === "dialog" ? "dialog" : "page"}
      context={{ plan: q.plan ?? "FREE", brand: { name: "Ama's Kitchen", about: "Homemade meals", colors: ["#E4572E"] }, siteNames: ["Ama's Kitchen"], liveSiteNames: ["Ama's Kitchen"] }}
    />
  );
}
