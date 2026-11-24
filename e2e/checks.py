"""Redesign checks (Playwright, Python). Run against a running site:

    python e2e/checks.py http://localhost:3000 AAPL

Exits non-zero if any check fails. Read-only: it only opens pages, hovers and scrolls.
"""

import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:3000"
T = sys.argv[2] if len(sys.argv) > 2 else "AAPL"
CHROME = sys.argv[3] if len(sys.argv) > 3 else None

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")


def broken(page) -> bool:
    return page.get_by_text("Couldn't load this page").count() > 0


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({"executable_path": CHROME} if CHROME else {}))
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # 1. Search reaches a company in one step: type the ticker in the landing search and press Enter
    page.goto(f"{BASE}/", wait_until="networkidle")
    box = page.get_by_role("combobox", name="Search any US-listed stock")
    box.fill(T)
    page.wait_for_timeout(600)
    box.press("Enter")
    page.wait_for_url(f"**/c/{T}", timeout=30000)
    check("search reaches a company in one step", page.url.rstrip("/").endswith(f"/c/{T}"), page.url)

    # 2. Every tab and old link opens, on the right tab
    tabs = {
        "overview": "Overview",
        "earnings": "Earnings",
        "valuation": "Valuation",
        "risk": "Risk",
        "financials": "Financials",
        "business": "Business",
    }
    links = {f"?tab={k}": v for k, v in tabs.items()}
    links.update(
        {
            # views inside tabs
            "?tab=earnings&view=call": "Earnings",
            "?tab=valuation&view=peers": "Valuation",
            "?tab=risk&view=riskfactors": "Risk",
            "?tab=risk&view=ownership": "Risk",
            "?tab=business&view=leaders": "Business",
            # old links
            "?tab=call": "Earnings",
            "?tab=brief": "Earnings",
            "?tab=filings": "Earnings",
            "?tab=street": "Valuation",
            "?tab=dcf": "Valuation",
            "?tab=peers": "Valuation",
            "?tab=stats": "Risk",
            "?tab=insiders": "Risk",
            "?tab=redline": "Risk",
            "?tab=historical": "Financials",
            "?tab=supply": "Business",
            "?tab=events": "Overview",
            "?tab=earnings&view=events": "Overview",
            "?tab=risk&view=options": "Risk",
            "?tab=options": "Risk",
            "?tab=earnings&view=search": "Overview",
            "?tab=sources": "Overview",
        }
    )
    for q, want in links.items():
        resp = page.goto(f"{BASE}/c/{T}{q}", wait_until="networkidle")
        try:
            page.wait_for_selector('nav[aria-label="Company sections"] a[aria-current="page"]', timeout=20000)
            current = page.locator('nav[aria-label="Company sections"] > div a[aria-current="page"]').first.inner_text().strip()
        except Exception:
            current = "(page failed to render)"
        ok = bool(resp and resp.ok) and current == want and not broken(page)
        check(f"opens {q}", ok, f"status {resp.status if resp else '?'}, tab {current!r}")
    resp = page.goto(f"{BASE}/portfolio", wait_until="domcontentloaded")
    check("old /portfolio opens My stocks", "/my-stocks" in page.url and bool(resp and resp.ok), page.url)
    page.goto(f"{BASE}/c/{T}?view=events", wait_until="networkidle")
    page.wait_for_timeout(1500)
    top = page.evaluate("document.getElementById('things-to-watch')?.getBoundingClientRect().top ?? 99999")
    check("old Company events link lands on Things to watch", top < 600, f"section top {top:.0f}px")

    # 3. Hovering the chart scrubs: the headline price, change and date follow the pointer
    page.goto(f"{BASE}/c/{T}", wait_until="networkidle")
    page.wait_for_timeout(1200)
    hero = page.get_by_test_id("hero-price")
    before = hero.inner_text()
    chart = page.locator('section[aria-label="Price chart"] [role="img"]').first
    bb = chart.bounding_box()
    label_before = page.locator("header p.tabular-nums").first.inner_text()
    page.mouse.move(bb["x"] + bb["width"] * 0.3, bb["y"] + bb["height"] * 0.5)
    page.wait_for_timeout(400)
    during = hero.inner_text()
    label_during = page.locator("header p.tabular-nums").first.inner_text()
    page.mouse.move(bb["x"] + bb["width"] * 0.6, bb["y"] + bb["height"] * 0.5)
    page.wait_for_timeout(400)
    during2 = hero.inner_text()
    check("hover scrub updates the price", during != before or during2 != during, f"{before} → {during} → {during2}")
    check("hover scrub updates the date", label_during != label_before, f"{label_before!r} → {label_during!r}")
    page.mouse.move(5, 5)
    page.wait_for_timeout(400)
    check("leaving the chart returns to the latest price", hero.inner_text() == before, hero.inner_text())

    # 4. The sticky bar appears once the header scrolls away
    bar = page.get_by_test_id("sticky-bar")
    hidden_first = bar.get_attribute("data-show") == "false"
    page.mouse.wheel(0, 1400)
    page.wait_for_timeout(700)
    check("sticky bar appears on scroll", hidden_first and bar.get_attribute("data-show") == "true", f"data-show={bar.get_attribute('data-show')}")
    page.mouse.wheel(0, -3000)
    page.wait_for_timeout(700)
    check("sticky bar hides back at the top", bar.get_attribute("data-show") == "false")

    # 5. Reduced motion turns motion off
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    p2 = ctx2.new_page()
    p2.goto(f"{BASE}/", wait_until="networkidle")
    armed = p2.evaluate("document.documentElement.classList.contains('reveal-armed')")
    dur = p2.evaluate("getComputedStyle(document.querySelector('.lift')).transitionDuration")
    hidden = p2.evaluate("[...document.querySelectorAll('.reveal')].filter(e => getComputedStyle(e).opacity !== '1').length")
    check("reduced motion: no scroll reveal", not armed and hidden == 0, f"armed={armed}, hidden sections={hidden}")
    check("reduced motion: no hover transitions", all(float(d.rstrip("s") or 0) < 0.01 for d in dur.split(",")), dur)
    p2.goto(f"{BASE}/c/{T}", wait_until="domcontentloaded")
    p2.wait_for_selector('[data-testid="hero-price"]')
    first = p2.get_by_test_id("hero-price").inner_text()
    p2.wait_for_timeout(900)
    check("reduced motion: price doesn't count up", first == p2.get_by_test_id("hero-price").inner_text(), first)
    ctx2.close()

    # and with motion allowed, the landing reveal is armed
    page.goto(f"{BASE}/", wait_until="networkidle")
    check("motion allowed: landing reveal armed", page.evaluate("document.documentElement.classList.contains('reveal-armed')"))
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
