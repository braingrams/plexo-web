"use client";

import "@/app/dashboard/_v3/v3.css";
import { EmailLogClient } from "@/app/dashboard/settings/email-log/EmailLogClient";

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();

/** DEV ONLY: the sent-emails screen with sample rows. */
export default function Page() {
  return (
    <div className="plx-page">
      <EmailLogClient
        logs={[
          { id: "1", to: "ama@example.com", subject: "New message from your website", context: "form_submission", status: "sent", createdAt: ago(2) },
          { id: "2", to: "kofi@gmail.con", subject: "Your receipt from Ama's Kitchen", context: "commerce_receipt", status: "failed", errorMessage: "550 5.1.1 mailbox does not exist", createdAt: ago(20) },
          { id: "3", to: "ama@example.com", subject: "You have a new order", context: "commerce_payment_received", status: "sent", createdAt: ago(30) },
        ]}
      />
    </div>
  );
}
