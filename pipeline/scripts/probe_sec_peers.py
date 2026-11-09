"""Probe the SEC SIC code list page; writes ops/sec-peer-probe.json."""

import json
import os
import re

import httpx

UA = os.environ["SEC_USER_AGENT"]
out = {}
with httpx.Client(headers={"User-Agent": UA}, timeout=30, follow_redirects=True) as c:
    r = c.get("https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list")
    out["status"] = r.status_code
    out["len"] = len(r.text)
    codes = re.findall(r"<td[^>]*>\s*(\d{3,4})\s*</td>", r.text)
    out["n_codes"] = len(set(codes))
    out["sample"] = sorted(set(codes))[:15]
    out["snippet"] = r.text[r.text.find("3571") - 300 : r.text.find("3571") + 300] if "3571" in r.text else r.text[:500]
    r2 = c.get("https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2024.json")
    out["frames_2024"] = r2.status_code
os.makedirs("ops", exist_ok=True)
with open("ops/sec-peer-probe.json", "w") as fh:
    json.dump(out, fh, indent=1)
print(json.dumps(out, indent=1)[:2000])
