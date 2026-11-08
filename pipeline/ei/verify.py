"""Quote verification: every quote must appear verbatim (after whitespace normalization) in its source."""

from __future__ import annotations

import re

_TRANSLATE = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def normalize(text: str) -> str:
    """Collapse whitespace and unify typographic quotes/dashes. Wording and case are NOT changed."""
    return re.sub(r"\s+", " ", text.translate(_TRANSLATE)).strip()


def quote_in(quote: str, source: str) -> bool:
    q = normalize(quote).strip(" \"'")
    return len(q) >= 8 and q in normalize(source)


def locate(quote: str, sources: list[str], preferred: int | None = None) -> int | None:
    """Index of the source containing the quote, checking the cited one first. None if not found."""
    if preferred is not None and 0 <= preferred < len(sources) and quote_in(quote, sources[preferred]):
        return preferred
    for i, s in enumerate(sources):
        if quote_in(quote, s):
            return i
    return None
