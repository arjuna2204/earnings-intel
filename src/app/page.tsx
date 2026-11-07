export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-emerald-500">Phase 0 ✓</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">You&apos;re in.</h1>
      <p className="mt-4 text-lg opacity-70">
        The password lock works. Ticker search, charts and analysis arrive in the next phases.
      </p>
      <form action="/api/logout" method="post" className="mt-10">
        <button type="submit" className="rounded-full border border-current/20 px-5 py-2 text-sm opacity-70 hover:opacity-100">
          Log out
        </button>
      </form>
    </main>
  );
}
