"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { limit as showLimit, parseBytes } from "@/lib/format";

type Props = {
  userId: string;
  blocked: boolean;
  blockedReason: string | null;
  timezone: string;
  deviceLimit: number;
  dailyLimitBytes: number | null;
  weeklyLimitBytes: number | null;
  monthlyLimitBytes: number | null;
};

/**
 * The controls that change an account.
 *
 * Limits are typed as text — "5 GB", "500mb", or empty for unlimited — rather than as a number
 * of bytes. Nobody wants to type 5368709120, and a units dropdown beside a number box is two
 * controls where one will do.
 *
 * An empty box means unlimited, which is deliberately *not* the same as `0`. Zero would mean an
 * account allowed to use nothing at all, and the two must never be confused: one is a generous
 * setting and the other is a silent block.
 */
export function UserControls(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [daily, setDaily] = useState(text(props.dailyLimitBytes));
  const [weekly, setWeekly] = useState(text(props.weeklyLimitBytes));
  const [monthly, setMonthly] = useState(text(props.monthlyLimitBytes));
  const [devices, setDevices] = useState(String(props.deviceLimit));
  const [zone, setZone] = useState(props.timezone);
  const [reason, setReason] = useState(props.blockedReason ?? "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${props.userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => null);
      if (!res.ok) {
        setError(answer?.message ?? "could not save");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  function saveLimits() {
    const parsed = {
      dailyLimitBytes: parseBytes(daily),
      weeklyLimitBytes: parseBytes(weekly),
      monthlyLimitBytes: parseBytes(monthly),
    };
    // `undefined` is what parseBytes returns for something it could not read. Sending it would
    // silently mean "leave unchanged", so a typo would look like it saved.
    for (const [field, value] of Object.entries(parsed)) {
      if (value === undefined) {
        setError(`could not read the ${field.replace("LimitBytes", "")} limit — try "5 GB"`);
        return;
      }
    }
    const count = Number(devices);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setError("devices must be a whole number between 1 and 50");
      return;
    }
    void patch({ ...parsed, deviceLimit: count, timezone: zone.trim() });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Limits</h2>
        <p className="mt-1 text-xs text-muted">
          Leave a box empty for unlimited. Periods reset at midnight in this user&rsquo;s own
          timezone, and weeks start on Monday.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Daily" value={daily} onChange={setDaily} placeholder="Unlimited" />
          <Field label="Weekly" value={weekly} onChange={setWeekly} placeholder="Unlimited" />
          <Field label="Monthly" value={monthly} onChange={setMonthly} placeholder="Unlimited" />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Devices allowed" value={devices} onChange={setDevices} />
          <Field label="Timezone" value={zone} onChange={setZone} placeholder="Asia/Dhaka" />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={saveLimits}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-ok">Saved</span>}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Access</h2>
        {props.blocked ? (
          <>
            <p className="mt-1 text-xs text-warn">
              Blocked{props.blockedReason ? ` — ${props.blockedReason}` : ""}. They cannot sign in
              or connect.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ blocked: false })}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Unblock
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              Blocking signs them out everywhere immediately, rather than waiting for their
              session to expire.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="min-w-48 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ blocked: true, blockedReason: reason || null })}
                className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                Block
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function text(value: number | null): string {
  return value === null ? "" : showLimit(value);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-fg outline-none focus:border-accent"
      />
    </label>
  );
}
