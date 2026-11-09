# Earnings Intel

**Equity Research for the everyday investor.** A public research site (no login; hidden from search engines). Type any US-listed ticker and get:

1. **Brief** — what changed between two quarters: Street results (beat/miss, GAAP vs. adjusted), guidance, what drove the numbers, what management said on the call, risk-factor changes, and places where the call and the filing don't line up.
2. **Call** — the two earnings calls compared: guidance raised/lowered/dropped, topics, tone, and the analyst questions management answered least directly.
3. **Filings** — the company's own GAAP and non-GAAP figures from its earnings press release, what management says drove results (MD&A), and a word-by-word redline of the risk factors.
4. **Financials** — 15 years of financial statements as interactive charts (annual and quarterly).
5. **Peers** — 3–7 comparable companies, ranked side by side on Street metrics, with a scatter map.
6. **Sources** — every filing the app used, with links to SEC.gov.
7. **Backtest** (top bar) — whether the app's signals came before stocks beating or lagging their sector.

**The rule above all:** every sentence links to its source — a quote from the call, a passage from a filing, or a number from SEC data. If something isn't in the sources, the app shows "Not reported" instead of guessing.

---

## How to use it

- **Open the site:** https://earnings-intel-eight.vercel.app — no login needed. Buttons that start new work (loading a company, writing a brief, peers) are limited to 8 per hour per visitor, and the $10/month AI cap still applies.
- **Add a company:** type a ticker or name on the home page, open it, and press **Load ⟨TICKER⟩ data**. The first load takes 1–3 minutes (it downloads 15 years of SEC data and prices). After that it opens instantly.
- **Write a brief:** open the company → **Brief** → pick two quarters (the same quarter a year apart shows risk-factor changes too) → **Write brief**. Takes 2–4 minutes the first time.
- **Peers:** **Peers** → **Find peers**. Edit the list any time with **Edit peers**.
- **Bull, base & bear:** each Brief opens with three scenarios. The values are arithmetic, not forecasts: analysts' low / consensus / high earnings estimates for the next 12 months × the stock's own forward P/E range over the past 3 years (20th percentile / median / 80th percentile). The reasoning for each case is written by AI from the verified sources only, with a "what to watch next quarter" list.
- **DCF:** the **Financials** tab opens with a 10-year discounted-cash-flow value per share, a sensitivity table and every assumption with its source. **Download Excel model** gives the same model with live formulas: change any yellow cell (growth, margins, capex, tax, beta, risk-free rate, terminal growth…) and the value per share and sensitivity table recalculate. Growth after year 2 fades toward the company's **sector growth rate** (median revenue growth last year of $1B+ US companies in the same sector, refreshed from SEC data), which itself glides to long-run growth by year 10; long-run (terminal) growth is 2.5% plus a small sector bump, capped at 3.5%. Banks, insurers, REITs and companies reporting in a foreign currency show a note instead.
- **Check a claim:** tap any small green number next to a sentence. A panel opens with the exact quote or figure and a link to the original document.
- **Your take:** at the bottom of each brief, mark the quarter Better / Same / Worse. Next quarter's brief reminds you what you said.
- **Is everything working?** Open **Status** (top right) for the AI budget, free-tier usage and recent jobs, or `/api/health` for a setup check.

You can close the tab while something is loading — the work runs on GitHub, not in your browser.

---

## Where the numbers come from

| What | Source | Cost |
|---|---|---|
| Financial statements, filings, risk factors, MD&A, earnings releases | SEC EDGAR (official) | Free |
| Daily stock prices | Tiingo | Free tier: 50 requests/hour, 1,000/day |
| Earnings call transcripts, Street EPS, consensus estimates | Alpha Vantage | Free tier: 25 requests/day |
| Reading and summarizing | Claude (Haiku for extraction, Sonnet for the brief only) | Capped at **$10/month** |

**"Adjusted" numbers, in priority order:**
1. **The Street number** — the adjusted EPS analysts track, vs. consensus (Alpha Vantage).
2. **The company's own non-GAAP figures** — read from its earnings press release (8-K exhibit), with the exact line quoted.
3. **The app's standardized adjusted figures** — calculated from SEC data when a company doesn't publish its own: adjusted EBITDA = operating income + D&A + stock-based pay + restructuring + impairments; adjusted EPS adds those back after tax. Always labeled "computed by this app," with the formula shown.

**Peers** = competitors named in the 10-K (when the company names any) + companies in the same SEC industry code with similar revenue and total assets. If an industry code has too few companies, the app widens to related codes and says so.

---

## Backtest

For every earnings report and every new 10-K of the companies you've loaded, the app records a signal (earnings surprise, revenue growth speeding up or slowing, change in management's tone and hedging on the call, stronger risk-factor wording, new risk factors, guidance raised vs. cut) and the stock's return **minus its sector ETF**:

- **Next day** — the market's immediate reaction (shows a signal matters, but too late to act on).
- **1 month / 3 months** — the 20 / 60 trading days *after* the reaction day. This is the real test.

Events are split into groups (top third vs. bottom third, or any vs. none), and the page shows the difference with a 95% "likely range". If the range crosses zero, treat it as luck. With 7 signals and 2 horizons, one result can look significant by chance, so look for results that hold up as more data arrives.

History grows every morning within the free limits (transcripts: Alpha Vantage, using the whole 25-a-day allowance; old 10-Ks: SEC, free). Because the morning run uses the full allowance, a brief on quarters whose transcripts aren't stored yet may pause until the next day. No AI is used, so the backtest costs nothing. This is research, not a trading recommendation.

---

## What it costs

- Hosting (Vercel), database (Supabase) and background jobs (GitHub Actions): free tiers.
- AI: a new brief costs about **3–5¢**, a call comparison under **1¢**, a peer summary under **0.1¢**. Re-opening anything is free (results are stored).
- The app tracks every AI call. It **warns at $8** and **refuses new AI work at $10** for the month; everything already generated stays available.

---

## What runs automatically

- **Every day at 6:17am Eastern:** refreshes the list of US tickers, new filings, financials and prices for every company you've loaded, and continues building call history. No AI cost.
- **Every 3 hours:** resumes anything paused by a free-tier limit (for example, prices when Tiingo's hourly limit was hit).

---

## If something breaks

| You see | What it means | What to do |
|---|---|---|
| "Couldn't load this page" | The site can't reach its data | Open `/api/health` — it shows which setting is missing |
| A job stuck on "Waiting for GitHub" | The GitHub token expired or was removed | Create a new fine-grained token (earnings-intel repo only, Actions: read & write) and replace `GH_DISPATCH_TOKEN` in Vercel → Settings → Environment Variables |
| "Paused — free limit reached" | Tiingo or Alpha Vantage daily/hourly limit | Nothing; it resumes automatically within 3 hours (or the next day for Alpha Vantage) |
| "Monthly AI budget reached" | $10 used this month | Wait for the 1st, or raise the cap (ask Claude) |
| A chart says "Not reported" | The company didn't file that number | Expected — the app never fills gaps with guesses |

**Where the keys live** (never in the code):
- **Vercel** (website): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GH_DISPATCH_TOKEN`.
- **GitHub → Settings → Secrets → Actions** (background jobs): `ANTHROPIC_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `TIINGO_API_KEY`, `SEC_USER_AGENT`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

`SITE_PASSWORD` and `SESSION_SECRET` are no longer used and can be deleted from Vercel.

---

## For developers

- `src/` — the website (Next.js on Vercel). Pages read from Supabase on the server; job-starting endpoints are rate-limited per visitor (`src/lib/rate-limit.ts`).
- `pipeline/` — the data jobs (Python, run by `.github/workflows/pipeline.yml`).
  - `ei/xbrl/` SEC financial data → standardized metrics; `ei/calls/` transcripts → guidance/topics/tone; `ei/filings/` filing text, risk redlines, press releases, MD&A, brief; `ei/peers.py` peer selection and ranking; `ei/street.py` Street multiples; `ei/budget.py` the $10 cap.
- `prompts/` — every AI instruction, versioned (`*.v1.md`, `*.v2.md`). Changing a prompt means adding a new version so stored results are re-made.
- `supabase/migrations/` — database tables.
- Checks: `cd pipeline && ruff check . && mypy ei && pytest` and `npx tsc --noEmit && npx eslint src`. Tests use real SEC data and real filings saved under `pipeline/tests/fixtures/`.
- All math is done in code; the AI only reads text and writes sentences, and code verifies every quote and number it returns.
