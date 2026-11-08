"""Successor/predecessor SEC entities.

When a company reorganizes under a new holding company, the SEC assigns a new CIK and the
ticker moves to it, but the XBRL history stays under the old CIK. We merge the predecessor's
facts for any period the successor doesn't report, and say so on the company page.
Entries can also be set per company in the `companies.predecessor_ciks` column.
"""

from __future__ import annotations

from typing import Any

KNOWN: dict[int, list[int]] = {
    2115436: [34088],  # ExxonMobil Holdings Corp <- Exxon Mobil Corp
}


def merge_companyfacts(primary: dict[str, Any], predecessors: list[dict[str, Any]]) -> dict[str, Any]:
    """Union of facts. Overlapping periods resolve later in normalize() by latest filing date,
    so the successor's (newer) filings win wherever both report the same period."""
    merged: dict[str, Any] = {k: v for k, v in primary.items() if k != "facts"}
    facts: dict[str, dict[str, Any]] = {}
    for source in [primary, *predecessors]:
        for tax, tags in source.get("facts", {}).items():
            for tag, node in tags.items():
                dst = facts.setdefault(tax, {}).setdefault(tag, {"units": {}})
                for unit, rows in node.get("units", {}).items():
                    dst["units"].setdefault(unit, []).extend(rows)
    merged["facts"] = facts
    return merged
