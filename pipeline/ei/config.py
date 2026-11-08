"""Settings read from environment variables (GitHub Actions secrets in production)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _req(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


@dataclass(frozen=True)
class Settings:
    sec_user_agent: str
    supabase_url: str
    supabase_secret_key: str
    tiingo_api_key: str
    alpha_vantage_api_key: str
    anthropic_api_key: str

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            sec_user_agent=_req("SEC_USER_AGENT"),
            supabase_url=_req("SUPABASE_URL").rstrip("/"),
            supabase_secret_key=_req("SUPABASE_SECRET_KEY"),
            tiingo_api_key=os.environ.get("TIINGO_API_KEY", ""),
            alpha_vantage_api_key=os.environ.get("ALPHA_VANTAGE_API_KEY", ""),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        )


HISTORY_YEARS = 15
