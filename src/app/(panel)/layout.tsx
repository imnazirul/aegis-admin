import Link from "next/link";
import { redirect } from "next/navigation";

import { currentAdmin } from "@/lib/auth/admin";
import { SignOut } from "@/components/sign-out";

/**
 * The guard for everything in the panel.
 *
 * A server component, so the check happens before any of it renders and there is no moment
 * where an unauthenticated browser holds the markup. Login sits outside this group, which is
 * why it is not caught by the redirect.
 */
export default async function PanelLayout({ children }: LayoutProps<"/">) {
  const admin = await currentAdmin();
  if (!admin) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-3">
          <Link href="/" className="mr-4 text-sm font-semibold tracking-tight">
            Aegis
          </Link>
          <Link href="/" className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg">
            Dashboard
          </Link>
          <Link href="/users" className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg">
            Users
          </Link>
          <span className="ml-auto text-xs text-muted">{admin.email}</span>
          <SignOut />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
