from ei.events import summarize_8k

HTML = """<html><body>
<p>Item 5.02 Departure of Directors or Certain Officers; Election of Directors.</p>
<p>On October 3, 2026, Jane Doe notified the Board that she will retire as Chief Financial Officer effective December 31, 2026. Ms. Doe will remain an advisor.</p>
<p>Item 9.01 Financial Statements and Exhibits.</p>
<p>Exhibit 99.1 Press release.</p>
<p>Item 2.02 Results of Operations and Financial Condition.</p>
<p>The information in this Item 2.02 is furnished and shall not be deemed filed.</p>
</body></html>"""


def test_summary_from_most_important_item() -> None:
    s = summarize_8k(HTML, ["2.02", "5.02"])
    assert (
        s
        == "On October 3, 2026, Jane Doe notified the Board that she will retire as Chief Financial Officer effective December 31, 2026."
    )


def test_boilerplate_only_gives_none() -> None:
    assert summarize_8k(HTML, ["2.02"]) is None
