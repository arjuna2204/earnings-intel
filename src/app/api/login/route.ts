import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionValue, passwordMatches } from "@/lib/session";
import { clearFailures, isBlocked, recordFailure } from "@/lib/rate-limit";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  // Only allow same-site relative paths.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  const back = (error: string) => {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", error);
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };

  if (isBlocked(ip)) return back("locked");

  const password = form.get("password");
  if (typeof password !== "string" || !(await passwordMatches(password))) {
    recordFailure(ip);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return back("wrong");
  }

  clearFailures(ip);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
