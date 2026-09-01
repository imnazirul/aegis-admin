import Link from "next/link";

import { listUsers } from "@/lib/admin-users";
import { ago, bytes, limit } from "@/lib/format";

/**
 * The user list.
 *
 * Search and the status filter live in the URL rather than in component state, so a filtered
 * view can be linked, bookmarked and reloaded — and so the back button does what it looks like
 * it should.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = params.status ?? "all";
  const page = Math.max(0, Number(params.page ?? 0) || 0);

  const result = await listUsers({ query, status, page });

  const tab = (value: string, label: string) => {
    const href = `/users?${new URLSearchParams({ ...(query ? { q: query } : {}), status: value })}`;
    const active = status === value;
    return (
      <Link
        key={value}
        href={href}
        className={`rounded-md px-3 py-1.5 text-sm ${
          active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Users</h1>
        <span className="text-sm text-muted">{result.total}</span>

        <form className="ml-auto flex items-center gap-2" action="/users">
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by email"
            className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </form>
      </div>

      <div className="flex gap-1">
        {tab("all", "All")}
        {tab("active", "Active")}
        {tab("blocked", "Blocked")}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2 font-normal">Email</th>
              <th className="px-4 py-2 font-normal">Today</th>
              <th className="px-4 py-2 font-normal">This month</th>
              <th className="px-4 py-2 font-normal">Monthly limit</th>
              <th className="px-4 py-2 font-normal">Devices</th>
              <th className="px-4 py-2 font-normal">Timezone</th>
              <th className="px-4 py-2 font-normal">Joined</th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((u) => {
              const over =
                u.monthlyLimitBytes !== null && u.monthBytes >= u.monthlyLimitBytes;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link href={`/users/${u.id}`} className="flex items-center gap-2">
                      <span className="truncate">{u.email}</span>
                      {/* Said in words, not by colour alone. */}
                      {u.blocked && (
                        <span className="rounded border border-warn/40 px-1.5 py-0.5 text-xs text-warn">
                          blocked
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="tnum px-4 py-2 text-muted">{bytes(u.todayBytes)}</td>
                  <td className={`tnum px-4 py-2 ${over ? "text-danger" : ""}`}>
                    {bytes(u.monthBytes)}
                    {over && <span className="ml-1 text-xs">over</span>}
                  </td>
                  <td className="tnum px-4 py-2 text-muted">{limit(u.monthlyLimitBytes)}</td>
                  <td className="tnum px-4 py-2 text-muted">
                    {u.devices}/{u.deviceLimit}
                  </td>
                  <td className="px-4 py-2 text-muted">{u.timezone}</td>
                  <td className="px-4 py-2 text-muted">{ago(u.createdAt)}</td>
                </tr>
              );
            })}
            {result.users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  {query ? `Nobody matches “${query}”.` : "No accounts yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(page > 0 || result.hasMore) && (
        <div className="flex items-center gap-2">
          {page > 0 && (
            <Link
              href={`/users?${new URLSearchParams({ ...(query ? { q: query } : {}), status, page: String(page - 1) })}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Previous
            </Link>
          )}
          {result.hasMore && (
            <Link
              href={`/users?${new URLSearchParams({ ...(query ? { q: query } : {}), status, page: String(page + 1) })}`}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
