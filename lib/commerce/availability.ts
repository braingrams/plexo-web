import type { CommerceAvailabilityRule, CommerceAvailabilityException, CommerceBooking } from "@prisma/client";

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** How many minutes to ADD to a UTC instant to get local wall-clock time in `timeZone`, at
 * that instant — computed via Intl rather than a date library, correct across DST since
 * it's re-derived per instant rather than cached. */
function getOffsetMinutes(utcInstant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcInstant).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return (asUtc - utcInstant.getTime()) / 60_000;
}

/** The local calendar date/weekday/minutes-since-midnight a UTC instant falls on, in `timeZone`. */
export function getZonedDateParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number; minutesSinceMidnight: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday],
    minutesSinceMidnight: hour * 60 + Number(parts.minute),
  };
}

/** The UTC instant for "this local calendar date + this many minutes past midnight, in
 * this IANA zone" — a guess-and-correct resolution (converges in at most 2 passes for any
 * real-world DST transition) since Node has no built-in "zoned time -> UTC instant". */
export function zonedTimeToUtc(year: number, month: number, day: number, minutesSinceMidnight: number, timeZone: string): Date {
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  const naiveGuess = Date.UTC(year, month - 1, day, hour, minute);

  const offset1 = getOffsetMinutes(new Date(naiveGuess), timeZone);
  let corrected = naiveGuess - offset1 * 60_000;

  const offset2 = getOffsetMinutes(new Date(corrected), timeZone);
  if (offset2 !== offset1) {
    corrected = naiveGuess - offset2 * 60_000;
  }
  return new Date(corrected);
}

export interface AvailabilitySlot {
  start: Date;
  end: Date;
}

type RuleInput = Pick<CommerceAvailabilityRule, "dayOfWeek" | "startMinute" | "endMinute" | "timezone">;
type ExceptionInput = Pick<CommerceAvailabilityException, "date" | "closed">;
type BookingInput = Pick<CommerceBooking, "scheduledStart" | "scheduledEnd">;

/**
 * Computes open booking slots for a service between `from` and `to` (UTC instants), from
 * its weekly recurring rules minus one-off closed dates minus anything already held
 * (CONFIRMED, or an unexpired PENDING_PAYMENT hold — callers pass only those in via
 * `existingBookings`). Timezone-aware per rule, without a date library.
 */
export function computeAvailableSlots(params: {
  from: Date;
  to: Date;
  durationMinutes: number;
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  existingBookings: BookingInput[];
}): AvailabilitySlot[] {
  const { from, to, durationMinutes, rules, exceptions, existingBookings } = params;
  if (rules.length === 0 || durationMinutes <= 0 || to.getTime() < from.getTime()) return [];

  const closedDateKeys = new Set(exceptions.filter((e) => e.closed).map((e) => e.date.toISOString().slice(0, 10)));

  const slots: AvailabilitySlot[] = [];
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60_000;

  for (let cursor = from.getTime(); cursor <= to.getTime(); cursor += DAY_MS) {
    const cursorDate = new Date(cursor);
    for (const rule of rules) {
      const { year, month, day, weekday } = getZonedDateParts(cursorDate, rule.timezone);
      if (weekday !== rule.dayOfWeek) continue;

      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (closedDateKeys.has(dateKey)) continue;

      for (let slotStart = rule.startMinute; slotStart + durationMinutes <= rule.endMinute; slotStart += durationMinutes) {
        const start = zonedTimeToUtc(year, month, day, slotStart, rule.timezone);
        const end = new Date(start.getTime() + durationMinutes * 60_000);

        if (start.getTime() < from.getTime() || start.getTime() > to.getTime()) continue;
        if (start.getTime() <= now) continue;

        const overlapsExisting = existingBookings.some(
          (b) => start.getTime() < b.scheduledEnd.getTime() && end.getTime() > b.scheduledStart.getTime(),
        );
        if (overlapsExisting) continue;

        slots.push({ start, end });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/**
 * Whether one exact start/end is open — checkout's server-side re-validation of a
 * client-supplied slot (defense in depth alongside the DB unique-constraint race guard:
 * this rejects a slot that was never open in the first place, e.g. outside business hours
 * or on a closed date, even when nobody is racing for it).
 */
export function isSlotAvailable(params: {
  scheduledStart: Date;
  scheduledEnd: Date;
  rules: RuleInput[];
  exceptions: ExceptionInput[];
  existingBookings: BookingInput[];
}): boolean {
  const durationMinutes = (params.scheduledEnd.getTime() - params.scheduledStart.getTime()) / 60_000;
  const slots = computeAvailableSlots({
    from: new Date(params.scheduledStart.getTime() - 24 * 60 * 60_000),
    to: new Date(params.scheduledStart.getTime() + 24 * 60 * 60_000),
    durationMinutes,
    rules: params.rules,
    exceptions: params.exceptions,
    existingBookings: params.existingBookings,
  });
  return slots.some((s) => s.start.getTime() === params.scheduledStart.getTime());
}
