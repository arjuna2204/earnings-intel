"""Command line entry point used by GitHub Actions.

python -m ei.cli tickers
python -m ei.cli analyze AAPL [--job-id 12]
python -m ei.cli refresh
"""

from __future__ import annotations

import argparse
import json
import logging
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
        print(json.dumps({"refreshed": refresh_all(settings)}))
    elif args.cmd == "calls":
        from ei.calls.run import compare_calls

        print(json.dumps(compare_calls(settings, args.ticker, args.period_a, args.period_b, job_id=args.job_id)))
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
