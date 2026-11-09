// Fails if server code (files without "use client") imports a non-type value other than a component
// from a "use client" module. Server code can render client components (default export or a named export
// starting with a capital letter), but can't call their functions.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
const isClient = (f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8"));
const resolve = (spec) => {
  const base = spec.replace(/^@\//, "src/");
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      statSync(base + ext);
      return base + ext;
    } catch {}
  }
  return null;
};
let bad = 0;
for (const f of files) {
  if (isClient(f)) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s+(?!type\b)([^;]*?)\s+from\s+["'](@\/[^"']+)["']/g)) {
    const target = resolve(m[2]);
    if (!target || !isClient(target)) continue;
    const named = (m[1].match(/\{([^}]*)\}/)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type "))
      .filter((s) => !/^[A-Z]/.test(s.split(/\s+as\s+/)[0])); // components are fine to render
    if (named.length) {
      console.error(`${f}: imports ${named.join(", ")} from client module ${m[2]} — move shared code to src/lib`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log("client-import check passed");
