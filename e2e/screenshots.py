"""Full-page screenshots of the redesign at 1440, 1024, 768 and 390 px, light and dark.

    python e2e/screenshots.py http://localhost:3000 AAPL out/

Motion is settled first (reduced motion) so nothing is caught mid-animation. The watchlist is seeded so
My stocks has rows.
"""

import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
T = sys.argv[2]
OUT = Path(sys.argv[3])
CHROME = sys.argv[4] if len(sys.argv) > 4 else None
OUT.mkdir(parents=True, exist_ok=True)

PAGES = {
    "1-landing": "/",
    "2-overview": f"/c/{T}",
    "3-earnings": f"/c/{T}?tab=earnings",
    "4-valuation": f"/c/{T}?tab=valuation",
    "5-my-stocks": "/my-stocks",
}
WIDTHS = [1440, 1024, 768, 390]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}))
    for theme in ("light", "dark"):
        for w in WIDTHS:
            ctx = browser.new_context(viewport={"width": w, "height": 900}, device_scale_factor=2 if w == 390 else 1, reduced_motion="reduce")
            ctx.add_init_script(
                f"try{{localStorage.setItem('theme','{theme}');"
                f"localStorage.setItem('ei.watchlist',JSON.stringify(['{T}','MSFT','NVDA','JPM']))}}catch(e){{}}"
            )
            page = ctx.new_page()
            for name, path in PAGES.items():
                page.goto(BASE + path, wait_until="networkidle", timeout=120000)
                page.wait_for_timeout(1500)
                page.screenshot(path=str(OUT / f"{name}-{w}-{theme}.png"), full_page=True)
                print("saved", name, w, theme)
            ctx.close()
    browser.close()
