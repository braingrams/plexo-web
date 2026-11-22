import { Metadata } from "next";
import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Notifications | Plexo",
  description: "Review alerts for site transfers, customer payments, comments and updates.",
};

export default function NotificationsPage() {
  return <NotificationsClient />;
}
