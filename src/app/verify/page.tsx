import Link from "next/link";

import { verify } from "@/lib/verification";

/**
 * The page a confirmation link opens.
 *
 * A server component that does the work and renders the outcome — no client-side fetch, no
 * spinner, and it works with JavaScript disabled, which matters because this link is opened
 * from an email client that may preview it in something unusual.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const outcome = await verify(token ?? "");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="rounded-xl border border-border bg-surface p-6">
        {outcome.ok ? (
          <>
            <h1 className="text-lg font-semibold">
              {outcome.already ? "Already confirmed" : "Email confirmed"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {outcome.already
                ? `${outcome.email} was already confirmed. There is nothing more to do.`
                : `${outcome.email} is confirmed. Go back to the Aegis app and connect.`}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-warn">
              {outcome.reason === "expired" ? "This link has expired" : "This link is not valid"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {outcome.reason === "expired"
                ? "Confirmation links last 24 hours. Open the Aegis app, sign in, and ask for a new one."
                : "It may already have been used, or a newer link may have replaced it. Open the Aegis app, sign in, and ask for a new one."}
            </p>
          </>
        )}

        <p className="mt-6 text-xs text-muted">
          <Link href="/login" className="underline underline-offset-2">
            Administrator sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
