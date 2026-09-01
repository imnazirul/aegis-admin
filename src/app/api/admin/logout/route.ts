import { cookies } from "next/headers";

import { clearAdminCookie } from "@/lib/auth/admin";
import { ADMIN_COOKIE, revokeAdminSession } from "@/lib/auth/sessions";

export async function POST() {
  const store = await cookies();
  await revokeAdminSession(store.get(ADMIN_COOKIE)?.value);
  await clearAdminCookie();
  return new Response(null, { status: 204 });
}
