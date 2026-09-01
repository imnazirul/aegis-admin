/**
 * Formatting for the admin panel.
 *
 * Bytes are binary units — GiB called GB, as every operating system and every VPN provider
 * does. Being pedantically correct here would make the number disagree with what the user's own
 * machine reports, which is worse than being pedantically wrong.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const exp = Math.min(Math.floor(Math.log(value) / Math.log(1024)), UNITS.length - 1);
  const scaled = value / 1024 ** exp;
  // One decimal above kilobytes, none below: "1.4 GB" is useful, "1434.2 B" is noise.
  const digits = exp === 0 ? 0 : scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${UNITS[exp]}`;
}

/** A limit, or the word for not having one. */
export function limit(value: number | null): string {
  return value === null ? "Unlimited" : bytes(value);
}

/** Parse "5 GB", "500mb", "2.5 TB" or a plain number of bytes. Returns `null` for unlimited. */
export function parseBytes(input: string): number | null | undefined {
  const text = input.trim().toLowerCase();
  if (text === "" || text === "unlimited" || text === "none") return null;
  const match = /^([\d.]+)\s*(b|kb|mb|gb|tb)?$/.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const exp = UNITS.indexOf((match[2]?.toUpperCase() ?? "B") as (typeof UNITS)[number]);
  return Math.round(amount * 1024 ** (exp < 0 ? 0 : exp));
}

export function when(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const at = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 days ago", for a column where the exact minute does not matter. */
export function ago(value: Date | string | null | undefined): string {
  if (!value) return "never";
  const at = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(at.getTime())) return "never";

  const seconds = Math.floor((Date.now() - at.getTime()) / 1000);
  if (seconds < 45) return "just now";

  // Largest unit first, so the first match is the one worth saying.
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [size, unit] of steps) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }
  return format.format(-seconds, "second");
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
