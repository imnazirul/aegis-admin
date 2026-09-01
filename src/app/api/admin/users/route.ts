/**
 * GET /api/admin/users
 *
 * A thin wrapper; the query lives in `@/lib/admin-users` because the list page reads it
 * directly as a server component.
 */

import { requireAdmin } from "@/lib/auth/admin";
import { listUsers } from "@/lib/admin-users";
import { ok } from "@/lib/http";

export async function GET(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;

  const url = new URL(request.url);
  return ok(
    await listUsers({
      query: url.searchParams.get("q")?.trim() ?? "",
      status: url.searchParams.get("status") ?? "all",
      page: Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0),
    }),
  );
}
