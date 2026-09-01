import { describe, expect, it } from "vitest";

import {
  addDays,
  isValidTimeZone,
  localDay,
  monthStart,
  periodRange,
  periodResetsAt,
  startOfDayUtc,
  weekStart,
} from "./period";

describe("localDay", () => {
  it("buckets an instant into the user's calendar date, not the server's", () => {
    // 22:30 UTC is already tomorrow in Dhaka (+06:00) and still today in New York (-05:00).
    // Getting this wrong shifts a user's whole quota history by a day.
    const at = new Date("2026-03-10T22:30:00Z");
    expect(localDay(at, "UTC")).toBe("2026-03-10");
    expect(localDay(at, "Asia/Dhaka")).toBe("2026-03-11");
    expect(localDay(at, "America/New_York")).toBe("2026-03-10");
  });

  it("handles an offset that is not a whole hour", () => {
    // Kathmandu is UTC+05:45. Any code that models offsets as whole hours is wrong here, and
    // nowhere else obviously enough to notice.
    const at = new Date("2026-03-10T18:20:00Z"); // 00:05 on the 11th in Kathmandu
    expect(localDay(at, "Asia/Kathmandu")).toBe("2026-03-11");
    expect(localDay(new Date("2026-03-10T18:10:00Z"), "Asia/Kathmandu")).toBe("2026-03-10");
  });
});

describe("weekStart", () => {
  it("starts weeks on Monday", () => {
    // 2026-03-11 is a Wednesday.
    expect(weekStart("2026-03-11")).toBe("2026-03-09");
  });

  it("treats Sunday as the end of a week, not the start of one", () => {
    // The half of "weeks start on Monday" that is easy to get backwards: Sunday belongs to the
    // week that began six days earlier.
    expect(weekStart("2026-03-15")).toBe("2026-03-09"); // Sunday
    expect(weekStart("2026-03-16")).toBe("2026-03-16"); // Monday, its own start
  });

  it("crosses a month and a year boundary", () => {
    expect(weekStart("2026-03-01")).toBe("2026-02-23"); // Sunday
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // Friday
  });
});

describe("periodRange", () => {
  it("covers exactly one day, seven days, or a whole month", () => {
    expect(periodRange("daily", "2026-03-11")).toEqual({
      from: "2026-03-11",
      to: "2026-03-11",
    });
    expect(periodRange("weekly", "2026-03-11")).toEqual({
      from: "2026-03-09",
      to: "2026-03-15",
    });
    expect(periodRange("monthly", "2026-03-11")).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });

  it("gets short and leap months right", () => {
    expect(periodRange("monthly", "2026-02-14").to).toBe("2026-02-28");
    expect(periodRange("monthly", "2028-02-14").to).toBe("2028-02-29");
    expect(periodRange("monthly", "2026-04-30").to).toBe("2026-04-30");
  });
});

describe("startOfDayUtc", () => {
  it("finds the instant a day begins in a zone", () => {
    expect(startOfDayUtc("2026-03-11", "UTC").toISOString()).toBe("2026-03-11T00:00:00.000Z");
    // Dhaka is UTC+6, so its midnight is 18:00 the previous day in UTC.
    expect(startOfDayUtc("2026-03-11", "Asia/Dhaka").toISOString()).toBe(
      "2026-03-10T18:00:00.000Z",
    );
    expect(startOfDayUtc("2026-03-11", "Asia/Kathmandu").toISOString()).toBe(
      "2026-03-10T18:15:00.000Z",
    );
  });

  it("survives a daylight saving transition", () => {
    // US DST starts on 2026-03-08. A day either side of it must still begin at that zone's
    // real midnight, which is what the second correction pass is for.
    expect(startOfDayUtc("2026-03-07", "America/New_York").toISOString()).toBe(
      "2026-03-07T05:00:00.000Z",
    );
    expect(startOfDayUtc("2026-03-09", "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });

  it("round-trips with localDay for every zone we care about", () => {
    for (const zone of ["UTC", "Asia/Dhaka", "Asia/Kathmandu", "America/New_York", "Pacific/Auckland"]) {
      for (const day of ["2026-01-01", "2026-03-08", "2026-06-15", "2026-11-01", "2026-12-31"]) {
        expect(localDay(startOfDayUtc(day, zone), zone)).toBe(day);
      }
    }
  });
});

describe("periodResetsAt", () => {
  it("is the next midnight in the user's own zone", () => {
    const at = new Date("2026-03-11T10:00:00Z"); // 16:00 in Dhaka
    expect(periodResetsAt("daily", at, "Asia/Dhaka").toISOString()).toBe(
      "2026-03-11T18:00:00.000Z",
    );
  });

  it("is the Monday after, for a weekly period", () => {
    const at = new Date("2026-03-11T10:00:00Z"); // Wednesday
    expect(periodResetsAt("weekly", at, "UTC").toISOString()).toBe("2026-03-16T00:00:00.000Z");
  });

  it("is not simply 24 hours later across a DST change", () => {
    // 2026-03-08 is 23 hours long in New York. Adding 86,400,000 ms would land an hour late
    // and hold a user over their limit for an extra hour.
    const at = new Date("2026-03-07T12:00:00Z");
    const resets = periodResetsAt("daily", at, "America/New_York");
    expect(resets.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(resets.getTime() - at.getTime()).not.toBe(86_400_000);
  });
});

describe("guards", () => {
  it("rejects a timezone the runtime does not know", () => {
    expect(isValidTimeZone("Asia/Dhaka")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("rejects something that is not a calendar date", () => {
    expect(() => addDays("not-a-date", 1)).toThrow();
    expect(() => weekStart("2026-13-99")).toThrow();
  });

  it("keeps monthStart on the first", () => {
    expect(monthStart("2026-03-31")).toBe("2026-03-01");
    expect(monthStart("2026-03-01")).toBe("2026-03-01");
  });
});
