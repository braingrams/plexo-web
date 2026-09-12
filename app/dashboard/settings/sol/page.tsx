import { redirect } from "next/navigation";

/**
 * Sol's settings moved to app/dashboard/sol/settings — a dedicated page nested inside
 * SolShell (conversation sidebar visible, SOL's own dark visual language) rather than a
 * generic dashboard settings page reachable only via SettingsShell's nav. This route is
 * kept as a redirect for anything that still links to the old location.
 */
export default function LegacySolSettingsRedirect() {
  redirect("/dashboard/sol/settings");
}
