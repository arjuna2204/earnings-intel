import { connection } from "next/server";

/** Setup check: which settings are present (never their values) and whether the database answers. */
export async function GET() {
  await connection();
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const env = {
    SUPABASE_URL: url ? (url.startsWith("https://") && url.includes(".supabase.co") ? "looks right" : "set, but not a https://….supabase.co address") : false,
    SUPABASE_SECRET_KEY: key
      ? key.startsWith("sb_secret_")
        ? "looks right (sb_secret_…)"
        : key.startsWith("sb_publishable_")
          ? "WRONG KEY: this is the publishable key; use the secret key"
          : key.startsWith("eyJ")
            ? "legacy key (fine if it's the service_role one)"
            : "set, but unrecognized format"
      : false,
    GITHUB_TOKEN: Boolean(process.env.GH_DISPATCH_TOKEN || process.env.GITHUB_DISPATCH_TOKEN),
  };

  let database: string;
  if (!url || !key) {
    database = "not tried (missing settings)";
  } else {
    try {
      const headers: Record<string, string> = { apikey: key };
      if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/tickers?select=ticker&limit=1`, { headers, cache: "no-store" });
      database = res.ok ? "connected ✓" : `error ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      database = `could not reach: ${(e as Error).message}`;
    }
  }
  return Response.json({ env, database, vercel_env: process.env.VERCEL_ENV ?? "unknown" });
}
