"use client";

/** Friendly fallback when a page can't load its data (e.g. the database is unreachable). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold">Couldn&apos;t load this page</h1>
      <p className="mt-3 text-muted">
        The site couldn&apos;t reach its data. If this keeps happening, open{" "}
        <a href="/api/health" className="text-accent-ink underline">
          the setup check
        </a>{" "}
        to see which setting needs fixing.
      </p>
      <button onClick={reset} className="mt-6 rounded-full bg-foreground px-5 py-2 font-semibold text-background">
        Try again
      </button>
    </main>
  );
}
