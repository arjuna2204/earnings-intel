"""Minimal Supabase (PostgREST) client using the project's secret key. Server-side only."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

import httpx


class Db:
    def __init__(self, url: str, secret_key: str) -> None:
        headers = {"apikey": secret_key, "Content-Type": "application/json"}
        if secret_key.startswith("eyJ"):  # legacy service_role JWT
            headers["Authorization"] = f"Bearer {secret_key}"
        self._client = httpx.Client(base_url=f"{url}/rest/v1", headers=headers, timeout=60)

    def close(self) -> None:
        self._client.close()

    def _check(self, resp: httpx.Response) -> httpx.Response:
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Supabase {resp.request.method} {resp.request.url.path} -> {resp.status_code}: {resp.text[:500]}"
            )
        return resp

    def upsert(self, table: str, rows: Sequence[dict[str, Any]], on_conflict: str, chunk: int = 1000) -> int:
        n = 0
        for i in range(0, len(rows), chunk):
            part = list(rows[i : i + chunk])
            self._check(
                self._client.post(
                    f"/{table}",
                    params={"on_conflict": on_conflict},
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=part,
                )
            )
            n += len(part)
        return n

    def insert(self, table: str, row: dict[str, Any], returning: bool = True) -> dict[str, Any] | None:
        resp = self._check(
            self._client.post(
                f"/{table}",
                headers={"Prefer": "return=representation" if returning else "return=minimal"},
                json=row,
            )
        )
        if returning:
            data: list[dict[str, Any]] = resp.json()
            return data[0] if data else None
        return None

    def update(self, table: str, match: dict[str, Any], values: dict[str, Any]) -> None:
        params = {k: f"eq.{v}" for k, v in match.items()}
        self._check(self._client.patch(f"/{table}", params=params, json=values, headers={"Prefer": "return=minimal"}))

    def delete(self, table: str, match: dict[str, Any]) -> None:
        params = {k: f"eq.{v}" for k, v in match.items()}
        self._check(self._client.delete(f"/{table}", params=params))

    def delete_where(self, table: str, params: dict[str, str]) -> None:
        """Delete with raw PostgREST filters, e.g. {"report_date": "lt.2026-01-01"}."""
        self._check(self._client.delete(f"/{table}", params=params))

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        data: list[dict[str, Any]] = self._check(self._client.get(f"/{table}", params=params)).json()
        return data

    def rpc(self, fn: str, args: dict[str, Any]) -> Any:
        return self._check(self._client.post(f"/rpc/{fn}", json=args)).json()

    def replace_rows(self, table: str, match: dict[str, Any], rows: Iterable[dict[str, Any]], on_conflict: str) -> int:
        """Delete existing rows for `match`, then insert fresh ones (used for re-normalized metrics)."""
        self.delete(table, match)
        return self.upsert(table, list(rows), on_conflict)
