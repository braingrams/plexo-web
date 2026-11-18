"use client";

import Link from "next/link";
import { MailCheck } from "lucide-react";
import { InboxLinks } from "@/app/auth/_kit/InboxLinks";
import { PageHead } from "@/app/auth/_kit/ui";

/** "Check your inbox" after sign-up. `email` is the address the link went to, when we know it. */
export function ConfirmView({ email }: { email?: string }) {
  return (
    <div className="ax-center-text">
      <div className="ax-badge-icon ax-lime"><MailCheck size={30} aria-hidden="true" /></div>
      <PageHead title="Check your inbox">
        {email ? <>We sent a link to <strong>{email}</strong>.</> : "We sent you a link to confirm your email."}
      </PageHead>
      <InboxLinks />
      <p className="ax-tips">
        Nothing yet? Check your spam folder. Wrong email?{" "}
        <Link href="/auth/register" className="ax-link">Start again</Link>
      </p>
      <p className="ax-foot">
        Already confirmed? <Link href="/auth/login" className="ax-link">Sign in</Link>
      </p>
    </div>
  );
}
