import { describe, expect, it } from "vitest";

import { ago, bytes, limit, parseBytes, percent } from "./format";

describe("bytes", () => {
  it("scales to a readable unit", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1024)).toBe("1.0 KB");
    expect(bytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(bytes(2.75 * 1024 ** 4)).toBe("2.8 TB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(bytes(150 * 1024 ** 2)).toBe("150 MB");
  });

  it("does not produce NaN for nonsense", () => {
    expect(bytes(Number.NaN)).toBe("0 B");
    expect(bytes(-5)).toBe("0 B");
  });
});

describe("limit", () => {
  it("says unlimited rather than showing nothing", () => {
    // A blank cell in a limits column reads as "zero", which is the opposite of what null means.
    expect(limit(null)).toBe("Unlimited");
    expect(limit(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("parseBytes", () => {
  it("accepts what a person would type", () => {
    expect(parseBytes("5 GB")).toBe(5 * 1024 ** 3);
    expect(parseBytes("500mb")).toBe(500 * 1024 ** 2);
    expect(parseBytes("2.5 TB")).toBe(2.5 * 1024 ** 4);
    expect(parseBytes("1024")).toBe(1024);
  });

  it("reads an empty box as unlimited, not as zero", () => {
    // These are different: zero means "may use nothing at all".
    expect(parseBytes("")).toBeNull();
    expect(parseBytes("unlimited")).toBeNull();
    expect(parseBytes("0")).toBe(0);
  });

  it("rejects what it cannot understand rather than guessing", () => {
    expect(parseBytes("five gigabytes")).toBeUndefined();
    expect(parseBytes("-1 GB")).toBeUndefined();
    expect(parseBytes("10 furlongs")).toBeUndefined();
  });

  it("round-trips with bytes", () => {
    for (const value of [0, 1024, 5 * 1024 ** 3, 250 * 1024 ** 2]) {
      expect(parseBytes(bytes(value))).toBe(value);
    }
  });
});

describe("ago", () => {
  it("describes the largest sensible unit", () => {
    const secondsAgo = (n: number) => new Date(Date.now() - n * 1000);
    expect(ago(secondsAgo(5))).toBe("just now");
    expect(ago(secondsAgo(120))).toMatch(/minute/);
    expect(ago(secondsAgo(7200))).toMatch(/hour/);
    expect(ago(secondsAgo(3 * 86_400))).toMatch(/day/);
    expect(ago(secondsAgo(400 * 86_400))).toMatch(/year/);
  });

  it("handles absent and malformed values", () => {
    expect(ago(null)).toBe("never");
    expect(ago(undefined)).toBe("never");
    expect(ago("not a date")).toBe("never");
  });
});

describe("percent", () => {
  it("rounds", () => {
    expect(percent(0.826)).toBe("83%");
    expect(percent(1)).toBe("100%");
  });
});
