import { Suspense } from "react";

const MESSAGES: Record<string, string> = {
  wrong: "That password didn't work. Try again.",
  locked: "Too many attempts. Wait 15 minutes and try again.",
};

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <LoginForm searchParams={props.searchParams} />
    </Suspense>
  );
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? MESSAGES[params.error] : undefined;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6">
      <form
        action="/api/login"
        method="post"
        className="w-full max-w-sm rounded-2xl border border-black/10 p-8 shadow-sm dark:border-white/10"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Earnings Intel</h1>
        <p className="mt-1 text-sm opacity-60">Equity Research for the everyday investor</p>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password" className="mt-8 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-4 py-3 text-base outline-none focus:border-emerald-500 dark:border-white/15"
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="mt-6 w-full rounded-full bg-emerald-500 py-3 font-semibold text-black transition hover:bg-emerald-400"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
