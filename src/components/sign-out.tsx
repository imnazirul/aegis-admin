"use client";

import { useRouter } from "next/navigation";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.refresh();
        router.replace("/login");
      }}
      className="ml-3 rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-fg"
    >
      Sign out
    </button>
  );
}
