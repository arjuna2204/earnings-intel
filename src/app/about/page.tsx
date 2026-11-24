import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Why Earnings Intel",
  description: "Most finance sites show you the numbers. Earnings Intel explains what changed, why, and whether it matters — with a source for every claim.",
};

/** What the site is for, how it differs from a data site like Yahoo Finance, and how it works. */
export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-20 pt-10 text-[15px] leading-relaxed sm:pt-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">Why Earnings Intel</p>
      <h1 className="mt-3 text-[34px] font-medium leading-[1.1] sm:text-5xl">
        Finance sites show you the numbers.
        <br />
        <span className="text-muted">We explain what changed.</span>
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">
        After every earnings report, analysts read the new filing, compare it with last quarter, listen to the call, notice what management stopped
        saying, and update their model. Earnings Intel does that work for one company at a time — in plain English, free, with a link to the
        source behind every claim.
      </p>

      <Section title="The goal">
        <p>
          Give everyday investors the research process a Wall Street analyst uses. Not a stream of headlines or a wall of numbers, but answers:
          <em> Was this quarter actually good? Did anything change? Is it expensive? What could go wrong?</em>
        </p>
      </Section>

      <Section title="What it's best for">
        <div className="grid gap-3 sm:grid-cols-3">
          <UseCard title="Right after a report" text="A company you own just reported. Was it good, and did anything change since last quarter?" />
          <UseCard title="Before you buy" text="Is it growing, is it expensive against its own history and its peers, and what could go wrong?" />
          <UseCard title="Building a pitch" text="For a class, an investment club or an interview: a DCF you can download to Excel and sources you can cite." />
        </div>
        <p className="mt-4 text-sm text-muted">
          Not built for day trading, live quotes, breaking news or scanning the whole market. Brokerage apps and data sites do those better.
        </p>
      </Section>

      <Section title="How it's different">
        <div className="overflow-x-auto rounded-2xl bg-card">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="w-28 px-4 py-3 font-medium" />
                <th className="px-4 py-3 font-medium">A typical finance site</th>
                <th className="px-4 py-3 font-semibold text-accent">Earnings Intel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {COMPARE.map(([row, them, us]) => (
                <tr key={row} className="align-top">
                  <th className="px-4 py-3 font-semibold">{row}</th>
                  <td className="px-4 py-3 text-muted">{them}</td>
                  <td className="px-4 py-3">{us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted">
          Sites like Yahoo Finance are excellent at breadth: quotes, news and statements for everything. Earnings Intel goes deep on one company
          at a time and does the reading for you.
        </p>
      </Section>

      <Section title="How it works">
        <ol className="space-y-4">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent tabular-nums">
                {i + 1}
              </span>
              <span>
                <b className="font-semibold">{title}.</b> <span className="text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="What you get for every stock">
        <ul className="divide-y divide-border">
          {FEATURES.map(([title, text]) => (
            <li key={title} className="grid gap-1 py-3.5 sm:grid-cols-[9rem_1fr] sm:gap-6">
              <span className="font-semibold">{title}</span>
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Honest limits">
        <ul className="list-disc space-y-2 pl-5 text-muted">
          <li>It&apos;s a beta. Coverage is US-listed companies, deepest for the largest ones, and some pages are still being built.</li>
          <li>AI does the reading, so it can be wrong. That&apos;s why every claim links to the quote it came from — check anything that matters.</li>
          <li>
            Curious whether the signals mean anything? The{" "}
            <Link href="/backtest" className="font-semibold text-accent hover:underline">
              backtest
            </Link>{" "}
            shows how they would have done.
          </li>
          <li>
            It&apos;s research, not investment advice. See{" "}
            <Link href="/terms" className="font-semibold text-accent hover:underline">
              terms &amp; data sources
            </Link>
            .
          </li>
        </ul>
      </Section>

      <div className="mt-14 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-full bg-accent px-6 py-3 font-semibold text-black hover:brightness-110">
          Look up a stock
        </Link>
        <Link href="/coverage" className="rounded-full px-4 py-3 font-medium text-muted hover:text-foreground">
          See companies covered →
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14">
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function UseCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  );
}

const COMPARE: [string, string, string][] = [
  ["Core job", "Show the data", "Explain what changed and why"],
  ["Earnings", "Reported numbers vs. estimates", "Any two quarters compared: guidance, what drove the numbers, and the call side by side with the last one"],
  ["Filings", "Links to SEC documents", "Reads them: the company's own adjusted figures, and a redline of risk factors added or removed"],
  ["Valuation", "Multiples and analyst targets", "A DCF you can download to Excel with footnoted assumptions, plus bull / base / bear cases"],
  ["Trust", "Take the number on faith", "Every claim links to the filing or call quote it came from"],
  ["Language", "Assumes you know the jargon", "Plain-English questions and explanations, with the full detail one tap away"],
];

const STEPS: [string, string][] = [
  ["Primary sources only", "Financials come straight from SEC filings (up to 15 years), alongside earnings calls, company announcements and daily prices."],
  ["AI reads, you decide", "AI compares two periods and pulls out what changed. Each claim is tied to the exact quote behind it, so you can check it yourself."],
  ["The analyst math is done for you", "Adjusted figures, a DCF, peer comparison and price risk are calculated, not just displayed."],
  ["It keeps itself current", "A daily update refreshes the data and writes a new brief after each company reports."],
];

const FEATURES: [string, string][] = [
  ["Overview", "The price chart, what just happened at the last report, the bottom line, and four plain questions: is it growing, is it expensive, what did management say, how bumpy is the ride."],
  ["Earnings", "What changed between two quarters — beat or miss, guidance, what drove the numbers, the company's own adjusted figures — and the earnings call side by side with the one before."],
  ["Financials", "15 years of financials straight from SEC filings, by quarter and year, with revenue by segment and the debt schedule."],
  ["Valuation", "Fair value from a DCF you can download to Excel, Street estimates and beat history, bull / base / bear cases, and how it compares with peers."],
  ["Risk", "New risk factors the company added, how much the stock swings, and who owns it — funds, insiders and short sellers."],
  ["Business", "Who its biggest customers and suppliers are, and who runs it and how they are paid."],
];
