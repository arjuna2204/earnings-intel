// Signed session cookie helpers. Uses Web Crypto so it works in the proxy and in route handlers.
// Cookie value format: "<expiresAtMillis>.<hex HMAC-SHA256 of expiresAtMillis>"

export const SESSION_COOKIE = "ei_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET env var is missing or shorter than 32 characters");
  }
  return secret;
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compare two strings in constant time (relative to their length). */
export function safeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function createSessionValue(now: number = Date.now()): Promise<string> {
  const expiresAt = String(now + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAt}.${await hmacHex(expiresAt, getSecret())}`;
}

export async function isValidSession(value: string | undefined, now: number = Date.now()): Promise<boolean> {
  if (!value) return false;
  const [expiresAt, sig] = value.split(".");
  if (!expiresAt || !sig || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < now) return false;
  const expected = await hmacHex(expiresAt, getSecret());
  return safeEqual(sig, expected);
}

/** Password check: compare HMACs so timing doesn't leak the password length or contents. */
export async function passwordMatches(candidate: string): Promise<boolean> {
  const real = process.env.SITE_PASSWORD;
  if (!real) throw new Error("SITE_PASSWORD env var is missing");
  const secret = getSecret();
  const [a, b] = await Promise.all([hmacHex(candidate, secret), hmacHex(real, secret)]);
  return safeEqual(a, b);
}
