import { Mail } from "lucide-react";

/** "Open Gmail / Outlook" shortcuts for the "check your inbox" screens. */
export function InboxLinks() {
  return (
    <div className="ax-mail-row">
      <a className="ax-btn ax-btn-secondary" href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer"><Mail size={18} aria-hidden="true" />Open Gmail</a>
      <a className="ax-btn ax-btn-secondary" href="https://outlook.live.com/mail/0/inbox" target="_blank" rel="noopener noreferrer"><Mail size={18} aria-hidden="true" />Open Outlook</a>
    </div>
  );
}
