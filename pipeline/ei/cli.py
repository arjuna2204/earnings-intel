"""Command line entry point used by GitHub Actions.

python -m ei.cli tickers
python -m ei.cli analyze AAPL [--job-id 12]
python -m ei.cli refresh
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from ei.config import Settings
from ei.jobs import analyze, refresh_all, refresh_tickers, retry_deferred


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="ei")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tickers")
    a = sub.add_parser("analyze")
    a.add_argument("ticker")
    a.add_argument("--job-id", type=int, default=None)
    sub.add_parser("refresh")
    sub.add_parser("retry-deferred")
    sub.add_parser("backfill-calls")
    rv = sub.add_parser("reverify")
    rv.add_argument("ticker")
    c = sub.add_parser("calls")
    c.add_argument("ticker")
    c.add_argument("period_a")
    c.add_argument("period_b")
    c.add_argument("--job-id", type=int, default=None)
    ins = sub.add_parser("insiders")
    ins.add_argument("ticker", nargs="?", default=None)
    hd = sub.add_parser("holders")
    hd.add_argument("--force", action="store_true")
    sub.add_parser("earnings-calendar")
    sub.add_parser("universe")
    dm = sub.add_parser("daily-mark")
    dm.add_argument("status", choices=["running", "done"])
    dm.add_argument("job_id", nargs="?", default=None)
    al = sub.add_parser("autoload")
    al.add_argument("--n", type=int, default=10)
    sub.add_parser("coverage")
    rk = sub.add_parser("risk")
    rk.add_argument("ticker", nargs="?", default=None)
    op = sub.add_parser("options")
    op.add_argument("ticker", nargs="?", default=None)
    hdd = sub.add_parser("holders-debug")
    hdd.add_argument("ticker")
    sg = sub.add_parser("sector-growth")
    sg.add_argument("--force", action="store_true")
    dc = sub.add_parser("dcf")
    dc.add_argument("ticker", nargs="?", default=None)
    cs = sub.add_parser("cases")
    cs.add_argument("ticker")
    btc = sub.add_parser("backtest-collect")
    btc.add_argument("--max-annual", type=int, default=40)
    sub.add_parser("backtest-run")
    pr = sub.add_parser("peers")
    pr.add_argument("ticker")
    pr.add_argument("--job-id", type=int, default=None)
    pr.add_argument("--set", default=None, help="comma-separated peer tickers (edited list)")
    pr.add_argument("--n", type=int, default=None, help="re-pick automatically with this many peers")
    br = sub.add_parser("brief")
    br.add_argument("ticker")
    br.add_argument("period_a")
    br.add_argument("period_b")
    br.add_argument("--job-id", type=int, default=None)
    args = p.parse_args(argv)

    settings = Settings.from_env()
    if args.cmd == "tickers":
        print(json.dumps({"tickers": refresh_tickers(settings)}))
    elif args.cmd == "analyze":
        print(json.dumps(analyze(settings, args.ticker, job_id=args.job_id)))
    elif args.cmd == "refresh":
        res = refresh_all(settings)
        print(json.dumps(res))
        # let later workflow steps skip work when the market had no new trading day
        gh_out = os.environ.get("GITHUB_OUTPUT")
        if gh_out:
            with open(gh_out, "a") as fh:
                fh.write(f"new_trading_day={'true' if res['new_trading_day'] else 'false'}\n")
    elif args.cmd == "calls":
        from ei.calls.run import compare_calls

        print(json.dumps(compare_calls(settings, args.ticker, args.period_a, args.period_b, job_id=args.job_id)))
    elif args.cmd == "sector-growth":
        from ei.sector_growth import refresh

        print(json.dumps(refresh(settings, only_stale=not args.force)))
    elif args.cmd == "insiders":
        from ei.insiders import run_all as run_insiders

        print(json.dumps(run_insiders(settings, [args.ticker.upper()] if args.ticker else None), default=str))
    elif args.cmd == "holders":
        from ei.holders import refresh as refresh_holders

        print(json.dumps(refresh_holders(settings, force=args.force), default=str))
    elif args.cmd == "holders-debug":
        from ei.holders_debug import debug

        print(json.dumps(debug(settings, args.ticker.upper()), default=str))
    elif args.cmd == "daily-mark":
        from ei.jobs import mark_daily

        print(json.dumps(mark_daily(settings, args.status, int(args.job_id) if args.job_id else None)))
    elif args.cmd == "universe":
        from ei.universe import refresh_universe

        print(json.dumps(refresh_universe(settings)))
    elif args.cmd == "autoload":
        from ei.universe import autoload

        print(json.dumps(autoload(settings, args.n)))
    elif args.cmd == "coverage":
        from ei.coverage import run as run_coverage

        print(json.dumps(run_coverage(settings)))
    elif args.cmd == "risk":
        from ei.risk import run_all as run_risk

        print(json.dumps(run_risk(settings, [args.ticker.upper()] if args.ticker else None), default=str))
    elif args.cmd == "options":
        from ei.options import run_all as run_options

        print(json.dumps(run_options(settings, [args.ticker.upper()] if args.ticker else None), default=str))
    elif args.cmd == "earnings-calendar":
        from ei.earnings_calendar import refresh as refresh_calendar

        print(json.dumps(refresh_calendar(settings)))
    elif args.cmd == "dcf":
        from ei.dcf import run_all

        print(json.dumps(run_all(settings, [args.ticker.upper()] if args.ticker else None), default=str))
    elif args.cmd == "cases":
        from ei.filings.cases import run_cases

        print(json.dumps(run_cases(settings, args.ticker)))
    elif args.cmd == "backtest-collect":
        from ei.backtest import collect

        print(json.dumps(collect(settings, max_annual=args.max_annual)))
    elif args.cmd == "backtest-run":
        from ei.backtest import run as run_backtest

        print(json.dumps(run_backtest(settings)))
    elif args.cmd == "peers":
        from ei.peers import run_peers

        override = [t for t in args.set.split(",") if t.strip()] if args.set else None
        print(json.dumps(run_peers(settings, args.ticker, job_id=args.job_id, override=override, n=args.n)))
    elif args.cmd == "brief":
        from ei.filings.run import run_brief

        print(json.dumps(run_brief(settings, args.ticker, args.period_a, args.period_b, job_id=args.job_id)))
    elif args.cmd == "reverify":
        from ei.calls.run import reverify

        print(json.dumps(reverify(settings, args.ticker)))
    elif args.cmd == "backfill-calls":
        from ei.calls.run import backfill_all

        print(json.dumps(backfill_all(settings)))
    elif args.cmd == "retry-deferred":
        print(json.dumps({"retried": retry_deferred(settings)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
