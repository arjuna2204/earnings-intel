from ei.supply import pick_paragraphs, verify

PARAS = [
    "Sales to Customer A accounted for 12% of total revenue in fiscal 2026, and sales to Customer B accounted for 11%.",
    "We rely on Taiwan Semiconductor Manufacturing Company Limited to manufacture our wafers.",
]


def test_pick() -> None:
    assert (
        len(
            pick_paragraphs([*PARAS, "Our headquarters are in California and we have many employees around the world."])
        )
        == 2
    )


def test_verify_drops_unquoted_and_wrong_percent() -> None:
    raw = {
        "customers": [
            {
                "name": "Customer A",
                "share_pct": 12,
                "basis": "revenue",
                "period": "fiscal 2026",
                "quote": "Sales to Customer A accounted for 12% of total revenue",
                "para": 0,
            },
            {
                "name": "Customer B",
                "share_pct": 15,
                "basis": "revenue",
                "period": "fiscal 2026",
                "quote": "sales to Customer B accounted for 11%",
                "para": 0,
            },
            {
                "name": "Walmart",
                "share_pct": 20,
                "basis": "revenue",
                "period": "",
                "quote": "Walmart accounted for 20% of revenue",
                "para": 0,
            },
        ],
        "suppliers": [
            {
                "name": "Taiwan Semiconductor Manufacturing Company Limited",
                "role": "manufactures wafers",
                "quote": "We rely on Taiwan Semiconductor Manufacturing Company Limited to manufacture our wafers",
                "para": 1,
            }
        ],
        "sole_source": True,
    }
    v = verify(raw, PARAS)
    assert [c["name"] for c in v["customers"]] == ["Customer A"]  # B's % is wrong, Walmart isn't in the text
    assert len(v["suppliers"]) == 1 and v["sole_source"] is True


def test_unnamed_customers_matched_by_percent() -> None:
    paras = [
        "Sales to direct Customers A, B and C represented 12%, 11% and 11% of total revenue, respectively, for fiscal year 2026."
    ]
    raw = {
        "customers": [
            {
                "name": "Customer A",
                "share_pct": 12,
                "basis": "revenue",
                "period": "fiscal 2026",
                "quote": "Sales to direct Customers A, B and C represented 12%, 11% and 11% of total revenue",
                "para": 0,
            }
        ],
        "suppliers": [],
        "sole_source": False,
    }
    assert [c["name"] for c in verify(raw, paras)["customers"]] == ["Customer A"]
