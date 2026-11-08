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
from ei.jobs import analyze, refresh_all, refresh_tickers


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="ei")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tickers")
    a = sub.add_parser("analyze")
    a.add_argument("ticker")
    a.add_argument("--job-id", type=int, default=None)
    sub.add_parser("refresh")
    args = p.parse_args(argv)

    settings = Settings.from_env()
    if args.cmd == "tickers":
        print(json.dumps({"tickers": refresh_tickers(settings)}))
    elif args.cmd == "analyze":
        print(json.dumps(analyze(settings, args.ticker, job_id=args.job_id)))
    elif args.cmd == "refresh":
        print(json.dumps({"refreshed": refresh_all(settings)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
