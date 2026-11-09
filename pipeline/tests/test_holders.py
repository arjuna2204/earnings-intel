import io
import zipfile

from ei.holders import dataset_links, names_match, read_quarter, summarize


def test_names_match_sec_abbreviations():
    assert names_match("INTERNATIONAL BUSINESS MACHS", "INTERNATIONAL BUSINESS MACHINES CORP")
    assert names_match("TAIWAN SEMICONDUCTOR MFG LTD", "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD")
    assert names_match("BANK AMERICA CORP", "BANK OF AMERICA CORP /DE/")
    assert names_match("WELLS FARGO CO NEW", "WELLS FARGO & COMPANY/MN")
    assert names_match("EXXON MOBIL CORP", "ExxonMobil Holdings Corp")
    assert names_match("CAPITAL ONE FINL CORP", "CAPITAL ONE FINANCIAL CORP")
    assert names_match("US BANCORP DEL", "US BANCORP \\DE\\")
    assert names_match("APPLE INC", "Apple Inc.")
    assert not names_match("APPLIED MATLS INC", "Apple Inc.")
    assert not names_match("H & R BLOCK INC", "Block, Inc.")
    assert not names_match("ORACLE FINL SVCS", "ORACLE CORP")
    assert not names_match("M & T BK CORP", "MICRON TECHNOLOGY INC")


def test_dataset_links_sorted_newest_first():
    html = (
        '<a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">x</a>'
        '<a href="/files/structureddata/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip">y</a>'
    )
    links = dataset_links(html)
    assert links[0][1].endswith("01jun2026-31aug2026_form13f.zip") and links[0][1].startswith("https://www.sec.gov/")


def _zip(sub, cover, info):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, rows in (("SUBMISSION.tsv", sub), ("COVERPAGE.tsv", cover), ("INFOTABLE.tsv", info)):
            z.writestr(name, "\n".join("\t".join(r) for r in rows))
    buf.seek(0)
    return buf


def test_read_quarter_share_classes_and_latest_filing(tmp_path):
    sub = [
        ["ACCESSION_NUMBER", "FILING_DATE", "SUBMISSIONTYPE", "CIK", "PERIODOFREPORT"],
        ["a1", "14-AUG-2026", "13F-HR", "10", "30-JUN-2026"],
        ["a2", "20-AUG-2026", "13F-HR", "10", "30-JUN-2026"],  # refiled: newest wins
        ["b1", "14-AUG-2026", "13F-HR", "20", "30-JUN-2026"],
    ]
    cover = [["ACCESSION_NUMBER", "FILINGMANAGER_NAME"], ["a1", "Fund A"], ["a2", "Fund A"], ["b1", "Fund B"]]
    head = ["ACCESSION_NUMBER", "NAMEOFISSUER", "CUSIP", "VALUE", "SSHPRNAMT", "SSHPRNAMTTYPE", "PUTCALL"]
    info = [
        head,
        ["a1", "ALPHABET INC", "02079K305", "999", "999", "SH", ""],
        ["a2", "ALPHABET INC", "02079K305", "100", "10", "SH", ""],
        ["a2", "ALPHABET INC CL C", "02079K107", "50", "5", "SH", ""],  # other class, different name: still counted
        ["a2", "ALPHABET INC", "02079K305", "500", "50", "SH", "Call"],  # options excluded
        ["b1", "ALPHABET INC", "02079K305", "300", "30", "SH", ""],
        ["b1", "ALPHABET INC", "02079K305", "300", "3000", "SH", ""],  # typo: implied price 0.1 vs ~10, dropped
    ]
    p = tmp_path / "q.zip"
    p.write_bytes(_zip(sub, cover, info).read())
    q = read_quarter(str(p), [{"cik": 1652044, "name": "Alphabet Inc.", "valuation": {"market_cap": 1000}}])
    f = q["by_company"][1652044]["filers"]
    assert f["10"]["shares"] == 15 and f["20"]["shares"] == 30
    assert q["by_company"][1652044]["cusip6"] == "02079K"
    assert q["by_company"][1652044]["dropped_rows"] == 1


def test_summarize_changes():
    cur = {"1": {"name": "A", "shares": 100.0, "value": 1.0}, "2": {"name": "B", "shares": 50.0, "value": 1.0}}
    prior = {"1": {"name": "A", "shares": 80.0, "value": 1.0}, "3": {"name": "C", "shares": 40.0, "value": 1.0}}
    s = summarize(cur, prior, shares_out=1000)
    assert s["holders"] == 2 and s["new"] == 1 and s["added"] == 1 and s["sold_out"] == 1
    assert abs(s["shares_change_pct"] - (100 / 80 - 1)) < 1e-9  # only fund A filed both quarters
    assert s["buyers"][0]["name"] == "B" and s["sellers"][0]["name"] == "C"
    assert s["pct_out"] == 0.15
