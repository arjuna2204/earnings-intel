import type { Metadata, Viewport } from "next";
import Link from "next/link";
// Geist (variable), bundled with the site; browsers only download the Latin file
import "@fontsource-variable/geist/wght.css";
import { Analytics } from "@vercel/analytics/next";
import HeaderSearch from "@/components/HeaderSearch";
import WatchAlerts from "@/components/WatchAlerts";
import MoreMenu from "@/components/MoreMenu";
import NavLinks, { NavLinksStatic } from "@/components/NavLinks";
import { Suspense } from "react";
import Logo from "@/components/Logo";
import { APP_NAME } from "@/lib/app";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Equity Research for the everyday investor",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Runs before first paint so there's no light/dark flash: light unless the visitor picked dark.
// It also arms the scroll reveal (content is visible by default; motion only once JS is running and allowed).
const themeScript = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}try{if(window.IntersectionObserver&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('reveal-armed');}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md">
          <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 sm:gap-6">
            <Link href="/" aria-label={`${APP_NAME} home`} className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
              <Logo />
              <span className="hidden lg:inline">{APP_NAME}</span>
            </Link>
            <div className="flex justify-end md:justify-center">
              <div className="flex w-full max-w-xl justify-end">
                <HeaderSearch />
              </div>
            </div>
            <nav className="flex items-center gap-0.5" aria-label="Main">
              <Suspense fallback={<NavLinksStatic />}>
                <NavLinks />
              </Suspense>
              <MoreMenu />
              <WatchAlerts />
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-auto bg-card/60">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-6 text-[13px] text-muted">
            <span>Educational research, not investment advice. Data may be delayed or contain errors.</span>
            <Link href="/about" className="inline-block py-1.5 hover:text-foreground hover:underline">
              Why Earnings Intel
            </Link>
            <Link href="/terms" className="inline-block py-1.5 hover:text-foreground hover:underline">
              Terms &amp; data sources
            </Link>
            <Link href="/coverage" className="inline-block py-1.5 hover:text-foreground hover:underline">
              Companies covered
            </Link>
            <Link href="/backtest" className="inline-block py-1.5 hover:text-foreground hover:underline">
              Does it work? (backtest)
            </Link>
            <Link href="/status" className="inline-block py-1.5 hover:text-foreground hover:underline">
              Status
            </Link>
          </div>
        </footer>
        {/* anonymous, cookie-free page views (Vercel Web Analytics); off until enabled in the Vercel project */}
        <Analytics />
      </body>
    </html>
  );
}
