import { redirect } from "next/navigation";

// The public marketing/landing page now lives on www.plexopages.com. This app
// (plexo.charisol.io) is the product/dashboard only — its root sends visitors
// straight to the dashboard, which itself redirects to login when signed out.
// The former landing page is preserved under _archive/app/page.tsx.
export default function RootPage() {
  redirect("/dashboard");
}
