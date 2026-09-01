import { requireAdmin } from "@/lib/auth/admin";
import { ok } from "@/lib/http";

export async function GET() {
  const { admin, response } = await requireAdmin();
  if (response) return response;
  return ok({ admin: { id: admin.id, email: admin.email, name: admin.name } });
}
