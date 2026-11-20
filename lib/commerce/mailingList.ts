/** Plain-words rules for connecting a mailing list (MailDrip) in the hub. The sign-in itself is MailDrip's own, through our connect route. */

export type ConnectTab = "login" | "register";
export type ConnectFields = { email: string; password: string; name: string; phone: string };

/** What to fix before we try, in the owner's words. null = good to go. */
export function connectProblem(tab: ConnectTab, f: ConnectFields): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return "Type the email you use for MailDrip, like name@example.com.";
  if (!f.password) return tab === "login" ? "Type your MailDrip password." : "Choose a password for your new MailDrip account.";
  if (tab === "register") {
    if (!f.name.trim()) return "Tell us your name so MailDrip can set up your account.";
    if (f.phone.replace(/\D/g, "").length < 7) return "Add a phone number MailDrip can reach you on.";
  }
  return null;
}

export type ConnectStep = 1 | 2 | 3;
export const CONNECT_STEPS: { step: ConnectStep; title: string; body: string }[] = [
  { step: 1, title: "Sign in to MailDrip", body: "Use your MailDrip account, or make one here in a minute." },
  { step: 2, title: "Confirm it's you", body: "MailDrip emails you a short code. Type it in." },
  { step: 3, title: "Choose your lists", body: "Pick where customers and newsletter sign-ups are added." },
];
export const stepFor = (connected: boolean, verifying: boolean): ConnectStep => (connected ? 3 : verifying ? 2 : 1);

/** A raw server message made kinder; unknown ones pass through untouched. */
export function friendlyConnectError(raw: string | undefined | null): string {
  const m = (raw ?? "").trim();
  if (!m) return "Something went wrong connecting to MailDrip. Please try again.";
  if (/invalid|incorrect|credentials|unauthor/i.test(m)) return "MailDrip didn't accept that email and password. Check them and try again.";
  if (/code/i.test(m) && /invalid|expired|wrong|incorrect/i.test(m)) return "That code didn't work. Check the latest email from MailDrip, or ask for a new code.";
  return m;
}

export const groupLabel = (g: { title: string; totalContacts: number }) => `${g.title} (${g.totalContacts} ${g.totalContacts === 1 ? "person" : "people"})`;
