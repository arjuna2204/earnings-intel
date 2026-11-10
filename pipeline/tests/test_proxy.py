from ei.proxy import parse_13, parse_pay

PAY = b"""<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ecd="http://xbrl.sec.gov/ecd/2024" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<xbrli:context id="fy25"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="fy24"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<ecd:PeoTotalCompAmt contextRef="fy25" unitRef="usd" decimals="0">25000000</ecd:PeoTotalCompAmt>
<ecd:PeoActuallyPaidCompAmt contextRef="fy25" unitRef="usd" decimals="0">40000000</ecd:PeoActuallyPaidCompAmt>
<ecd:TotalShareholderRtnAmt contextRef="fy25" unitRef="usd" decimals="2">180.5</ecd:TotalShareholderRtnAmt>
<ecd:TotalShareholderRtnAmt contextRef="fy24" unitRef="usd" decimals="2">150</ecd:TotalShareholderRtnAmt>
<ecd:PeoName contextRef="fy25">Jane Doe</ecd:PeoName>
<ecd:CoSelectedMeasureName contextRef="fy25">Operating income</ecd:CoSelectedMeasureName>
</xbrli:xbrl>"""

G13 = b"""<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g"><formData><coverPageHeaderReportingPersonDetails>
<reportingPersonName>Vanguard Group Inc</reportingPersonName><reportingPersonBeneficiallyOwnedAggregateNumberOfShares>1,234,567,890</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
<classPercent>9.3</classPercent></coverPageHeaderReportingPersonDetails></formData></edgarSubmission>"""


def test_parse_pay() -> None:
    p = parse_pay(PAY)
    assert [r["year_end"] for r in p["rows"]] == ["2024-12-31", "2025-12-31"]
    last = p["rows"][-1]
    assert last["ceo_reported"] == 25e6 and last["ceo_actually_paid"] == 40e6 and last["tsr"] == 180.5
    assert p["ceo_names"] == ["Jane Doe"] and p["measure_name"] == "Operating income"


def test_parse_13g() -> None:
    assert parse_13(G13) == {"holder": "Vanguard Group Inc", "pct": 9.3, "shares": 1234567890.0}
