"""Probe SEC endpoints used for peer discovery; writes ops/sec-peer-probe.json."""

import json
import os
import re

import httpx

UA = os.environ["SEC_USER_AGENT"]
out = {}
with httpx.Client(headers={"User-Agent": UA}, timeout=30, follow_redirects=True) as c:
    r = c.get(
        "https://www.sec.gov/cgi-bin/browse-edgar",
        params={
            "action": "getcompany",
            "SIC": "7372",
            "owner": "include",
            "count": "100",
            "output": "atom",
            "start": "0",
        },
    )
    out["sic_status"] = r.status_code
    out["sic_ctype"] = r.headers.get("content-type")
    out["sic_head"] = r.text[:1500]
    out["sic_ciks"] = re.findall(r"<cik>(\d+)</cik>", r.text)[:20]
    out["sic_entries"] = r.text.count("<entry>")
    r2 = c.get("https://data.sec.gov/api/xbrl/frames/us-gaap/Revenues/USD/CY2025.json")
    out["frames_status"] = r2.status_code
    if r2.status_code == 200:
        d = r2.json()
        out["frames_keys"] = list(d.keys())
        out["frames_n"] = len(d.get("data", []))
        out["frames_sample"] = d.get("data", [])[:3]
    r3 = c.get(
        "https://data.sec.gov/api/xbrl/frames/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2025Q2.json"
    )
    out["frames_q_status"] = r3.status_code
    out["frames_q_n"] = len(r3.json().get("data", [])) if r3.status_code == 200 else None
os.makedirs("ops", exist_ok=True)
with open("ops/sec-peer-probe.json", "w") as fh:
    json.dump(out, fh, indent=1)
print(json.dumps(out, indent=1)[:3000])
