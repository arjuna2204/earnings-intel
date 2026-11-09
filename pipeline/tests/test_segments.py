from __future__ import annotations

from ei.segments import build_rows, humanize, parse_instance, parse_labels, subtotal_members

INSTANCE = b"""<?xml version="1.0"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
  xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:srt="http://fasb.org/srt/2025" xmlns:acme="http://acme.com/2025">
  <xbrli:context id="fy_phone"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:PhoneMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="fy_us_phone"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:PhoneMember</xbrldi:explicitMember>
    <xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="q1_phone"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:PhoneMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="q2_phone"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:PhoneMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="q3_phone"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier><xbrli:segment>
    <xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">acme:PhoneMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2025-06-30</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="fy_total"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="fy_phone" unitRef="usd" decimals="-6">1000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="fy_us_phone" unitRef="usd" decimals="-6">400</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="q1_phone" unitRef="usd" decimals="-6">300</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="q2_phone" unitRef="usd" decimals="-6">200</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="q3_phone" unitRef="usd" decimals="-6">250</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="fy_total" unitRef="usd" decimals="-6">5000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
</xbrli:xbrl>"""

LABELS = b"""<?xml version="1.0"?>
<link:linkbase xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink">
 <link:labelLink xlink:type="extended">
  <link:loc xlink:type="locator" xlink:href="acme-20250930.xsd#acme_PhoneMember" xlink:label="loc_phone"/>
  <link:label xlink:type="resource" xlink:label="lab_phone" xlink:role="http://www.xbrl.org/2003/role/label">aPhone [Member]</link:label>
  <link:labelArc xlink:type="arc" xlink:from="loc_phone" xlink:to="lab_phone"/>
 </link:labelLink>
</link:linkbase>"""


def test_only_single_axis_facts_kept() -> None:
    facts = parse_instance(INSTANCE)
    assert {(f.axis, f.member) for f in facts} == {("product", "PhoneMember")}
    assert sorted(f.value for f in facts) == [200, 250, 300, 1000]  # no cross-tab, no company total


def test_labels_and_q4() -> None:
    labels = parse_labels(LABELS)
    assert labels["PhoneMember"] == "aPhone"
    rows = build_rows(1, [("acc", parse_instance(INSTANCE))], labels, "0930")
    by = {r["fiscal_period"]: r for r in rows}
    assert by["FY"]["fiscal_year"] == 2025 and by["FY"]["label"] == "aPhone"
    assert by["Q4"]["value"] == 1000 - 300 - 200 - 250 and by["Q4"]["source"] == "derived"


def test_humanize_fallback() -> None:
    assert humanize("DataCenterSegmentMember") == "Data Center"
    assert humanize("AmericasMember") == "Americas"


def test_subtotal_lines_dropped() -> None:
    apple = {"Product": 355.5, "iPhone": 254.1, "Service": 123.3, "Mac": 37.9, "Wearables": 35.6, "iPad": 27.9}
    assert subtotal_members(apple, 478.8) == ({"Product"}, True)
    amazon = {
        "Service": 420.7,
        "Product": 296.3,
        "Online": 269.3,
        "3P": 172.2,
        "AWS": 128.7,
        "Ads": 68.6,
        "Subs": 49.6,
        "Stores": 22.6,
        "Other": 5.9,
    }
    assert subtotal_members(amazon, 716.9) == ({"Service", "Product"}, True)
    nvidia = {
        "DataCenter": 193.7,
        "Compute": 162.4,
        "Networking": 31.4,
        "Gaming": 16.0,
        "ProViz": 3.2,
        "Auto": 2.3,
        "OEM": 0.6,
    }
    assert subtotal_members(nvidia, 215.9) == ({"DataCenter"}, True)
    partial = {"US": 100.0, "China": 30.0}  # rest of world not broken out
    assert subtotal_members(partial, 200.0) == (set(), False)
