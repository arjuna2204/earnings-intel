# Earnings Intel

A private, password-protected research site for one person. Type any US-listed ticker and get:

1. **Brief** — what changed between two quarters: Street results (beat/miss, GAAP vs. adjusted), guidance, what drove the numbers, what management said on the call, risk-factor changes, and places where the call and the filing don't line up.
2. **Call** — the two earnings calls compared: guidance raised/lowered/dropped, topics, tone, and the analyst questions management answered least directly.
3. **Filings** — the company's own GAAP and non-GAAP figures from its earnings press release, what management says drove results (MD&A), and a word-by-word redline of the risk factors.
4. **Financials** — 15 years of financial statements as interactive charts (annual and quarterly).
5. **Peers** — 3–7 comparable companies, ranked side by side on Street metrics, with a scatter map.
6. **Sources** — every filing the app used, with links to SEC.gov.

**The rule above all:** every sentence links to its source — a quote from the call, a passage from a filing, or a number from SEC data. If something isn't in the sources, the app shows "Not reported" instead of guessing.

---

## How to use it

- **Open the site:** https://earnings-intel-eight.vercel.app — log in with your site password.
- **Add a company:** type a ticker or name on the home page, open it, and press **Load ⟨TICKER⟩ data**. The first load takes 1–3 minutes (it downloads 15 years of SEC data and prices). After that it opens instantly.
- **Write a brief:** open the company → **Brief** → pick two quarters (the same quarter a year apart shows risk-factor changes too) → **Write brief**. Takes 2–4 minutes the first time.
- **Peers:** **Peers** → **Find peers**. Edit the list any time with **Edit peers**.
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
- **Vercel** (website): `SITE_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GH_DISPATCH_TOKEN`.
- **GitHub → Settings → Secrets → Actions** (background jobs): `ANTHROPIC_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `TIINGO_API_KEY`, `SEC_USER_AGENT`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

To change the site password: Vercel → Settings → Environment Variables → edit `SITE_PASSWORD` → then Deployments → ⋯ → Redeploy.

---

## For developers

- `src/` — the website (Next.js on Vercel). Pages read from Supabase on the server; the password gate is `src/proxy.ts`.
- `pipeline/` — the data jobs (Python, run by `.github/workflows/pipeline.yml`).
  - `ei/xbrl/` SEC financial data → standardized metrics; `ei/calls/` transcripts → guidance/topics/tone; `ei/filings/` filing text, risk redlines, press releases, MD&A, brief; `ei/peers.py` peer selection and ranking; `ei/street.py` Street multiples; `ei/budget.py` the $10 cap.
- `prompts/` — every AI instruction, versioned (`*.v1.md`, `*.v2.md`). Changing a prompt means adding a new version so stored results are re-made.
- `supabase/migrations/` — database tables.
- Checks: `cd pipeline && ruff check . && mypy ei && pytest` and `npx tsc --noEmit && npx eslint src`. Tests use real SEC data and real filings saved under `pipeline/tests/fixtures/`.
- All math is done in code; the AI only reads text and writes sentences, and code verifies every quote and number it returns.
