"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? "could not sign in");
        return;
      }
      // `refresh` first: the layout guard is a server component and would otherwise render
      // with the cookie it had before this request.
      router.refresh();
      router.replace("/");
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Aegis Admin</h1>
      <p className="mt-1 text-sm text-muted">Accounts, bandwidth and limits.</p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-xs text-muted">
        There is no sign-up. Admins are created with{" "}
        <code className="font-mono text-fg">node scripts/create-admin.mjs</code> on a machine that
        already holds the database credentials.
      </p>
    </main>
  );
}
