// The address a new account was sent to. Kept in sessionStorage, not the URL, so it never
// reaches the address bar, history, or third-party scripts on the confirm page.
const PENDING_CONFIRM_EMAIL_KEY = "plexo_pending_confirm_email";

export function rememberPendingEmail(email: string) {
  try {
    window.sessionStorage.setItem(PENDING_CONFIRM_EMAIL_KEY, email);
  } catch {
    // Storage can be blocked (private mode, strict settings). The confirm page still works without it.
  }
}

export function readPendingEmail(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_CONFIRM_EMAIL_KEY);
  } catch {
    return null;
  }
}
