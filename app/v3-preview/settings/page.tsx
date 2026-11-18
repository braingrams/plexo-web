import { notFound } from "next/navigation";
import { SettingsPreview } from "./SettingsPreview";

/** DEV ONLY: Settings home with fake data. */
export default function V3PreviewSettingsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SettingsPreview section="profile" />;
}
