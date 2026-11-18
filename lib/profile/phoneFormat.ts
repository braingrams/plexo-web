// Pure, so it can be tested without the database.

/** "2348012345678" or "+234 801 234 5678" → "+2348012345678". Null when it can't be a real number (8 to 15 digits). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
