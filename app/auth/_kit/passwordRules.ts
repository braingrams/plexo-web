import { PASSWORD_MIN_LENGTH } from "@/lib/passwordPolicy";

export type PasswordCheck = { id: "length" | "lower" | "upper" | "number"; label: string; met: boolean };

/** The password rules as a checklist (same rules as lib/passwordPolicy.ts), so the form can tick them off as the person types. */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: "length", label: `${PASSWORD_MIN_LENGTH}+ characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { id: "lower", label: "A lowercase letter", met: /[a-z]/.test(password) },
    { id: "upper", label: "An uppercase letter", met: /[A-Z]/.test(password) },
    { id: "number", label: "A number", met: /[0-9]/.test(password) },
  ];
}

export function allChecksMet(password: string): boolean {
  return passwordChecks(password).every((c) => c.met);
}

/** Plain-words email check for inline validation. null when it looks like an email. */
export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "That doesn’t look like an email address. It should look like you@example.com.";
  return null;
}
