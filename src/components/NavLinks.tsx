"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/earnings", label: "This week" },
  { href: "/my-stocks", label: "My stocks" },
];

/** The two main links in the top bar (tablets and up; on phones they live in More). */
export default function NavLinks() {
  return <Links path={usePathname()} />;
}

/** Same links with no current-page mark: the first paint, before the address is known. */
export function NavLinksStatic() {
  return <Links path="" />;
}

function Links({ path }: { path: string }) {
  return (
    <>
      {LINKS.map((l) => {
        const on = path === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? "page" : undefined}
            className={`hidden whitespace-nowrap rounded-full px-3 py-2 text-[15px] font-medium transition hover:bg-card sm:block ${on ? "text-foreground" : ""}`}
          >
            {l.label}
            <span aria-hidden className={`mx-auto mt-0.5 block h-0.5 w-4 rounded-full bg-foreground transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} />
          </Link>
        );
      })}
    </>
  );
}
