/**
 * GET /api/admin/stats
 *
 * A thin wrapper. The queries live in `@/lib/stats` because the dashboard page reads them
 * directly as a server component — a page fetching its own API over HTTP would add a round
 * trip and a second copy of every type for nothing.
 */

import { requireAdmin } from "@/lib/auth/admin";
import { ok } from "@/lib/http";
import { platformStats } from "@/lib/stats";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  return ok(await platformStats());
}
