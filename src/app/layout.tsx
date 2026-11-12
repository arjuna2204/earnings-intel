import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";
import MobileNav from "@/components/MobileNav";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import ThemeToggle from "@/components/ThemeToggle";
import ModeToggle from "@/components/ModeToggle";
import { Analytics } from "@vercel/analytics/next";
import HeaderSearch from "@/components/HeaderSearch";
import WatchAlerts from "@/components/WatchAlerts";
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

// Runs before first paint so there's no light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}try{document.documentElement.dataset.mode=localStorage.getItem('mode')==='pro'?'pro':'simple';}catch(e){document.documentElement.dataset.mode='simple';}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-mode="simple" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col pb-16 sm:pb-0">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="page-wrap flex h-14 items-center gap-4">
            <Link href="/" className="shrink-0 whitespace-nowrap font-semibold tracking-tight">
              <span className="text-accent">●</span> {APP_NAME}
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link href="/compare" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Compare stocks
              </Link>
              <Link href="/earnings" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Earnings
              </Link>
              <Link href="/screener" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Screener
              </Link>
              <Link href="/portfolio" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Portfolio
              </Link>
              <Link href="/macro" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground md:block">
                Economy
              </Link>
              <ModeToggle />
              <ThemeToggle />
              <WatchAlerts />
              <HeaderSearch />
            </nav>
          </div>
        </header>
        {children}
        <Suspense fallback={null}>
          <MobileNav />
        </Suspense>
        <footer className="mt-auto border-t border-border">
          <div className="page-wrap flex flex-wrap items-center gap-x-5 gap-y-1 py-5 text-xs text-muted">
            <span>Educational research, not investment advice. Data may be delayed or contain errors.</span>
            <Link href="/terms" className="hover:text-foreground hover:underline">
              Terms &amp; data sources
            </Link>
            <Link href="/coverage" className="hover:text-foreground hover:underline">
              Companies covered
            </Link>
            <Link href="/backtest" className="hover:text-foreground hover:underline">
              Does it work? (backtest)
            </Link>
            <Link href="/status" className="hover:text-foreground hover:underline">
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
