import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import ThemeToggle from "@/components/ThemeToggle";
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
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="text-accent">●</span> {APP_NAME}
            </Link>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <Link href="/compare" className="rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground">
                Compare
              </Link>
              <Link href="/earnings" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Earnings
              </Link>
              <Link href="/screener" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground sm:block">
                Screener
              </Link>
              <Link href="/coverage" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground md:block">
                What&apos;s ready
              </Link>
              <Link href="/backtest" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground lg:block">
                Backtest
              </Link>
              <Link href="/status" className="hidden rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-foreground lg:block">
                Status
              </Link>
              <ThemeToggle />
              <WatchAlerts />
              <HeaderSearch />
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
