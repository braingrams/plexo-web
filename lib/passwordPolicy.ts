// Plexo passwords follow Charisol Auth's password policy (Charisol's
// infra/lib/cognito-products-stack.ts: 10+ characters, a lowercase letter, an uppercase
// letter and a number). Accounts move to Charisol on first sign-in, and Charisol marks a
// moved password that falls short as "must reset" — so a weaker rule here would make a
// brand-new user reset the password they chose minutes earlier. Client-safe: shared by the
// register/reset pages and their API routes.

export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_RULES_TEXT = `At least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter and a number.`;

/** null when the password is acceptable, otherwise a sentence saying what's missing. */
export function passwordProblem(password: string, email?: string): string | null {
  const missing: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/[0-9]/.test(password)) missing.push("a number");
  if (missing.length > 0) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return `Your password needs ${list}.`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Password can't be the same as your email address.";
  }
  return null;
}
