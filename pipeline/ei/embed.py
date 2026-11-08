"""Text similarity for matching topics/guidance across periods.

Production uses a small free local embedding model (BAAI/bge-small-en-v1.5 via `fastembed`, ONNX,
no PyTorch) inside GitHub Actions. Tests and environments without the model fall back to a simple
word-overlap similarity so the comparison logic stays deterministic and testable.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from functools import cache
from typing import Protocol

MODEL = "BAAI/bge-small-en-v1.5"


class Embedder(Protocol):
    name: str

    def similarity_matrix(self, a: Sequence[str], b: Sequence[str]) -> list[list[float]]: ...


_STOP = {"the", "a", "an", "and", "of", "to", "in", "for", "on", "with", "our", "we", "is", "are"}


def _tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in _STOP}


class OverlapEmbedder:
    name = "word-overlap"

    def similarity_matrix(self, a: Sequence[str], b: Sequence[str]) -> list[list[float]]:
        ta, tb = [_tokens(x) for x in a], [_tokens(x) for x in b]
        return [[(len(x & y) / len(x | y)) if (x | y) else 0.0 for y in tb] for x in ta]


class FastEmbedder:
    name = MODEL

    def __init__(self) -> None:
        from fastembed import TextEmbedding

        self._model = TextEmbedding(MODEL)

    def _vecs(self, texts: Sequence[str]) -> list[list[float]]:
        out = []
        for v in self._model.embed(list(texts)):
            vec = [float(x) for x in v]
            n = math.sqrt(sum(x * x for x in vec)) or 1.0
            out.append([x / n for x in vec])
        return out

    def similarity_matrix(self, a: Sequence[str], b: Sequence[str]) -> list[list[float]]:
        if not a or not b:
            return [[] for _ in a]
        va, vb = self._vecs(a), self._vecs(b)
        return [[sum(x * y for x, y in zip(u, v, strict=True)) for v in vb] for u in va]


@cache
def default_embedder() -> Embedder:
    try:
        return FastEmbedder()
    except Exception:  # model or package unavailable -> deterministic fallback
        return OverlapEmbedder()


def greedy_match(sim: list[list[float]], threshold: float) -> list[tuple[int, int, float]]:
    """One-to-one matches, best pairs first, above a similarity threshold."""
    pairs = sorted(((s, i, j) for i, row in enumerate(sim) for j, s in enumerate(row)), reverse=True)
    used_a: set[int] = set()
    used_b: set[int] = set()
    out = []
    for s, i, j in pairs:
        if s < threshold:
            break
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        out.append((i, j, s))
    return out
