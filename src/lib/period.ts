/**
 * Turning an instant into the calendar period a user's quota belongs to.
 *
 * Quotas reset at midnight **in the user's own timezone**, weeks start on Monday, and months on
 * the 1st. That is easy to say and easy to get wrong, so all of it lives here, is pure, and is
 * tested — including Kathmandu, which is UTC+05:45 and breaks any code that assumes offsets are
 * whole hours.
 *
 * The rule that keeps the rest of the system simple: **bucket at write time.** When a usage
 * report arrives, [`localDay`] converts that instant to the user's local calendar date once,
 * and it is stored against that date. Every query afterwards is plain arithmetic on
 * `YYYY-MM-DD` strings with no timezone involved at all.
 *
 * Dates are strings, never `Date`. A `Date` is an instant, and treating a calendar date as an
 * instant is exactly how a report silently shifts by a day for everyone east of UTC.
 */

/** A calendar date as `YYYY-MM-DD`. */
export type Day = string;

/** The three periods a limit can apply to. */
export type PeriodKind = "daily" | "weekly" | "monthly";

/**
 * Whether a string is an IANA timezone this runtime understands.
 *
 * Worth checking before storing one: an unknown zone makes `Intl` throw at the moment a usage
 * report is being written, which is the worst possible time to find out.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date `at` falls on, in `timeZone`.
 *
 * Uses `formatToParts` rather than formatting to a locale that happens to produce ISO order.
 * Reading the parts by name cannot be broken by a locale or ICU change.
 *
 * @throws if `timeZone` is not a zone this runtime knows.
 */
export function localDay(at: Date, timeZone: string): Day {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const found = parts.find((p) => p.type === type)?.value;
    if (!found) throw new Error(`could not read ${type} for timezone ${timeZone}`);
    return found;
  };

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Calendar arithmetic on a `Day`, done in UTC.
 *
 * UTC not because the date is UTC — it is the user's local date — but because it is the one
 * zone with no offsets and no daylight saving, so adding a day always adds a day. Doing this in
 * the server's local zone would make results depend on where the server happens to run.
 */
function asUtc(day: Day): Date {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`not a calendar date: ${day}`);
  return at;
}

function toDay(at: Date): Day {
  return at.toISOString().slice(0, 10);
}

/** The Monday of the week containing `day`. */
export function weekStart(day: Day): Day {
  const at = asUtc(day);
  // getUTCDay is 0 for Sunday. Shifting by 6 makes Monday 0, so Sunday counts back six days
  // rather than starting a new week — which is the half of "weeks start on Monday" that is
  // easy to get backwards.
  const back = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - back);
  return toDay(at);
}

/** The 1st of the month containing `day`. */
export function monthStart(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

/** `day` moved by `n` days, which may be negative. */
export function addDays(day: Day, n: number): Day {
  const at = asUtc(day);
  at.setUTCDate(at.getUTCDate() + n);
  return toDay(at);
}

/**
 * The inclusive range of days a period covers.
 *
 * Inclusive on both ends because the rows being summed are whole days, so a half-open range
 * would need an exclusive end that is a day nobody has any data for — an easy off-by-one every
 * time it is written out by hand.
 */
export function periodRange(kind: PeriodKind, day: Day): { from: Day; to: Day } {
  switch (kind) {
    case "daily":
      return { from: day, to: day };
    case "weekly": {
      const from = weekStart(day);
      return { from, to: addDays(from, 6) };
    }
    case "monthly": {
      const from = monthStart(day);
      const at = asUtc(from);
      at.setUTCMonth(at.getUTCMonth() + 1);
      return { from, to: toDay(new Date(at.getTime() - 86_400_000)) };
    }
  }
}

/**
 * When the period containing `at` ends, as an instant.
 *
 * What the client shows as "resets in 4h 12m". Computed by walking forward to the day after the
 * period's last day and finding when that day begins in the user's zone — rather than adding 24
 * hours, which is wrong on the two days a year a DST zone has 23 or 25.
 */
export function periodResetsAt(kind: PeriodKind, at: Date, timeZone: string): Date {
  const { to } = periodRange(kind, localDay(at, timeZone));
  return startOfDayUtc(addDays(to, 1), timeZone);
}

/**
 * The instant at which `day` begins in `timeZone`.
 *
 * There is no direct API for this, so it is solved by search: guess midnight UTC, measure how
 * far off the guess lands in that zone, and correct. Two passes settle it even across a DST
 * transition, where the first correction can overshoot.
 */
export function startOfDayUtc(day: Day, timeZone: string): Date {
  let guess = asUtc(day);
  for (let i = 0; i < 2; i += 1) {
    const offset = zoneOffsetMs(guess, timeZone);
    guess = new Date(asUtc(day).getTime() - offset);
  }
  return guess;
}

/** How far ahead of UTC `timeZone` is at `at`, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  // Formatting an instant in a zone and reading it back as if it were UTC gives a value shifted
  // by exactly that zone's offset. Crude, but it needs no timezone database of our own.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asIfUtc - at.getTime();
}
