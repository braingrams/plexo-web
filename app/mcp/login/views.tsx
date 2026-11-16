import Link from "next/link";
import { KeyRound, ShieldAlert } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { PageHead } from "@/app/auth/_kit/ui";
import { CopyKey } from "./copy-key";

export function ConnectErrorView({ message }: { message: string }) {
  return (
    <AuthShell layout="center">
      <div className="ax-center-text">
        <div className="ax-badge-icon ax-warn"><ShieldAlert size={30} aria-hidden="true" /></div>
        <PageHead title="We couldn’t connect your app">{message}</PageHead>
        <Link href="/dashboard/integrations" className="ax-btn ax-btn-secondary">Back to Plexo</Link>
      </div>
    </AuthShell>
  );
}

export function ConnectKeyView({ email, rawKey }: { email?: string | null; rawKey: string }) {
  return (
    <AuthShell layout="center">
      <div className="ax-center-text">
        <div className="ax-badge-icon ax-lime"><KeyRound size={30} aria-hidden="true" /></div>
        <PageHead title="Connect your AI tool">
          Paste this key into Claude, ChatGPT or Cursor to let it work on your Plexo account. Signed in as <strong>{email}</strong>.
        </PageHead>
        <div className="ax-stack">
          <code className="ax-token">{rawKey}</code>
          <CopyKey value={rawKey} />
          <Link href="/dashboard/integrations" className="ax-btn ax-btn-ghost">Done</Link>
        </div>
        <p className="ax-tips">Keep this key private. Making a new one replaces this one.</p>
      </div>
    </AuthShell>
  );
}
