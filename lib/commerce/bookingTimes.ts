/** Plain-words rules for the "Booking times" screen, shared by the hub and the old availability page. */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The order a week is shown in a shop: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function minutesToTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
/** "9:00 AM" for the owner, never "540". */
export function friendlyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export type HourRule = { id: string; dayOfWeek: number; startMinute: number; endMinute: number; timezone: string };

/** The week as seven rows, Monday first; a day with no hours is "Closed". */
export function weekRows(rules: HourRule[]): { day: number; name: string; windows: HourRule[] }[] {
  return WEEK_ORDER.map((day) => ({ day, name: DAY_NAMES[day], windows: rules.filter((r) => r.dayOfWeek === day).sort((a, b) => a.startMinute - b.startMinute) }));
}

/** A plain sentence when the hours can't work, else null. */
export function hoursProblem(start: string, end: string, existing: HourRule[], day: number): string | null {
  if (!start || !end) return "Choose when you open and when you close.";
  const s = timeInputToMinutes(start);
  const e = timeInputToMinutes(end);
  if (s >= e) return "Closing time needs to be later than opening time.";
  if (existing.some((r) => r.dayOfWeek === day && s < r.endMinute && e > r.startMinute)) return `You already have hours that overlap on ${DAY_NAMES[day]}. Remove those first, or choose different times.`;
  return null;
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
