import type { Metadata } from "next";
import Link from "next/link";
import { CBOE_ON } from "@/lib/flags";

export const metadata: Metadata = { title: "Terms, disclaimer and data sources" };

const UPDATED = "November 11, 2026";

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-lg font-semibold tracking-tight">{children}</h2>;
}

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 text-[15px] leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Terms, disclaimer and data sources</h1>
      <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-4">
        <p className="font-semibold">Not investment advice.</p>
        <p className="mt-1">
          Earnings Intel is an educational research tool. Nothing on this site is a recommendation to buy, sell or hold any security, and it is not
          personalized to your situation. We are not a registered investment adviser or broker-dealer. Investing involves risk, including the loss
          of everything you invest. Do your own research and consider talking to a licensed professional before making decisions.
        </p>
      </div>

      <H>Using this site</H>
      <p className="mt-2">
        By using Earnings Intel you agree to these terms. The site is provided free, &quot;as is&quot; and &quot;as available&quot;, for personal,
        non-commercial use. You may not resell or republish its data, scrape it in bulk, or use it in a way that disrupts the service. We may change
        or stop any part of the site at any time.
      </p>

      <H>Accuracy</H>
      <p className="mt-2">
        Numbers come from public filings and third-party providers and are processed by software. They can be late, incomplete or wrong — for
        example when a company restates results, tags its filings unusually, or a provider makes an error. We run automatic checks every day and
        hold back numbers that fail them, but checks can&apos;t catch everything. Always confirm important figures in the original source; every
        number links to where it came from. We are not liable for any loss arising from use of, or reliance on, the site.
      </p>

      <H>AI-written content</H>
      <p className="mt-2">
        Some summaries (call comparisons, briefs, peer lists, customers and suppliers) are written by an AI model from the documents shown. Each
        claim is checked against an exact quote from the source, but AI can still misread context. Treat these summaries as a starting point, not a
        conclusion.
      </p>

      <H>Where the data comes from</H>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>Financial statements, filings, insider trades, fund holdings, 8-K events, proxy statements, 13D/13G:</b> U.S. Securities and Exchange
          Commission (EDGAR), public domain.
        </li>
        <li>
          <b>Daily stock prices:</b> Tiingo, end of day.
        </li>
        <li>
          <b>Analyst estimates, earnings dates and call transcripts:</b> Alpha Vantage.
        </li>
        {CBOE_ON && (
          <li>
            <b>Options data, prices for &quot;Basic&quot; screener rows, VIX:</b> Cboe delayed quotes (delayed at least 15 minutes). Cboe data is
            the property of Cboe Global Markets.
          </li>
        )}
        <li>
          <b>Short interest:</b> FINRA, published twice a month.
        </li>
        <li>
          <b>Economy:</b> U.S. Treasury, Federal Reserve Bank of New York, Bureau of Labor Statistics, and Federal Reserve Bank of St. Louis (FRED).
        </li>
      </ul>
      <p className="mt-2">
        Prices are not real time. Data is refreshed once each morning on business days; the &quot;Data as of&quot; note on each company page shows
        exactly how fresh each part is. Each provider&apos;s own terms apply to its data.
      </p>

      <H>Your data and privacy</H>
      <p className="mt-2">
        There are no accounts. Your watchlist, portfolio holdings, recent searches and display settings are stored only in your own browser and are
        never sent to us; clearing your browser data removes them. Searches you run on the site (for example a ticker lookup or a filing search) are
        processed on our servers to return results but are not linked to you. We collect anonymous, cookie-free page-view statistics to learn which
        pages are useful.
      </p>

      <H>Links to other sites</H>
      <p className="mt-2">Links to the SEC and other sites are provided for convenience. We don&apos;t control those sites and aren&apos;t responsible for them.</p>

      <H>Changes</H>
      <p className="mt-2">We may update these terms; the date at the top shows the latest version. Continuing to use the site means you accept them.</p>

      <p className="mt-10 text-sm text-muted">
        <Link href="/" className="hover:underline">
          ← Back to Earnings Intel
        </Link>
      </p>
    </main>
  );
}
