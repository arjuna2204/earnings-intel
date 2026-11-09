from ei.insiders import form4_list, parse_form4

XML = """<?xml version="1.0"?>
<ownershipDocument>
  <aff10b5One>0</aff10b5One>
  <issuer><issuerCik>0000789019</issuerCik><issuerName>MICROSOFT CORP</issuerName></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>Smith Bradford L</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><officerTitle>President</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-03</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value><footnoteId id="F1"/></transactionShares>
        <transactionPricePerShare><value>500.25</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>50000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-01</value></transactionDate>
      <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>200</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>51000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes><footnote id="F1">Sold under a Rule 10b5-1 trading plan adopted May 1, 2026.</footnote></footnotes>
</ownershipDocument>"""


def test_parse_form4():
    p = parse_form4(XML)
    assert p["issuer_cik"] == 789019
    assert p["owners"] == [("Smith Bradford L", "President")]
    sale, award = p["rows"]
    assert sale["code"] == "S" and sale["acquired"] is False and sale["value"] == 500250.0
    assert sale["plan_10b5_1"] is True  # footnote on this line names a 10b5-1 plan
    assert award["plan_10b5_1"] is False and award["value"] is None  # $0 award has no dollar value
    assert sale["owned_after"] == 50000 and sale["direct"] is True


def test_form4_list_filters():
    sub = {
        "filings": {
            "recent": {
                "form": ["4", "10-Q", "4", "4/A"],
                "accessionNumber": ["a1", "a2", "a3", "a4"],
                "filingDate": ["2026-10-01", "2026-10-01", "2020-01-01", "2026-09-01"],
                "primaryDocument": ["xslF345X05/wk-form4_1.xml", "q.htm", "x.xml", "xslF345X05/f.xml"],
            }
        }
    }
    from datetime import date

    out = form4_list(sub, date(2025, 1, 1))
    assert [o["accession"] for o in out] == ["a1", "a4"]
    assert out[0]["doc"] == "wk-form4_1.xml" and out[0]["view"].startswith("xslF345X05/")
