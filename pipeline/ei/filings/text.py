"""SEC filing HTML -> clean text blocks (paragraphs) with emphasis flags, then Item sections.

No AI. Paragraph boundaries come from block-level HTML elements; inline spans are joined without
adding spaces (filers split words across spans). Hidden inline-XBRL headers are dropped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import lxml.html
from lxml.etree import _Element

BLOCK_TAGS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "br", "ul", "ol", "center"}
CELL_TAGS = {"td", "th"}
SKIP_TAGS = {"script", "style", "head", "title"}


@dataclass
class Block:
    text: str
    bold: bool = False
    italic: bool = False
    table: bool = False
    lead_bold: str = ""  # run-in bold heading at the start of the paragraph, if any


@dataclass
class _Run:
    parts: list[tuple[str, bool, bool]] = field(default_factory=list)
    table: bool = False


def _style_flags(el: _Element, bold: bool, italic: bool) -> tuple[bool, bool, bool]:
    tag = el.tag.lower() if isinstance(el.tag, str) else ""
    style = (el.get("style") or "").lower().replace(" ", "")
    if "display:none" in style:
        return bold, italic, True
    if tag in {"b", "strong"} or re.search(r"font-weight:(bold|[6-9]00)", style):
        bold = True
    if re.search(r"font-weight:(normal|[1-4]00)", style):
        bold = False
    if tag in {"i", "em"} or "font-style:italic" in style:
        italic = True
    if "font-style:normal" in style:
        italic = False
    return bold, italic, False


def html_to_blocks(html: str) -> list[Block]:
    doc = lxml.html.fromstring(html.encode("utf-8") if isinstance(html, str) else html)
    blocks: list[Block] = []
    cur = _Run()

    def flush() -> None:
        nonlocal cur
        text = re.sub(r"\s+", " ", "".join(p[0] for p in cur.parts)).strip()
        if text:
            visible = [(t, b, i) for t, b, i in cur.parts if t.strip()]
            bold = all(b for _, b, _ in visible)
            italic = all(i for _, _, i in visible)
            lead = []
            for t, b, _ in cur.parts:
                if not t.strip():
                    lead.append(t)
                    continue
                if not b:
                    break
                lead.append(t)
            lead_text = re.sub(r"\s+", " ", "".join(lead)).strip()
            blocks.append(Block(text=text, bold=bold, italic=italic, table=cur.table, lead_bold=lead_text))
        cur = _Run()

    def walk(el: _Element, bold: bool, italic: bool, in_table: bool) -> None:
        tag = el.tag.lower() if isinstance(el.tag, str) else ""
        if not tag or tag in SKIP_TAGS or tag.startswith("ix:header") or tag == "header":
            if el.tail:
                cur.parts.append((el.tail, bold, italic))
            return
        b, i, hidden = _style_flags(el, bold, italic)
        if hidden:
            if el.tail:
                cur.parts.append((el.tail, bold, italic))
            return
        # Inside a table only rows break lines; paragraphs/divs inside cells stay on the row.
        is_block = tag in BLOCK_TAGS and (not in_table or tag in {"tr", "table"})
        if is_block:
            flush()
            cur.table = in_table or tag in {"tr", "table"}
        if el.text:
            cur.parts.append((el.text, b, i))
        for child in el:
            walk(child, b, i, in_table or tag in {"table", "tr"})
        if tag in CELL_TAGS:
            cur.parts.append((" | ", b, i))
        if is_block:
            flush()
            cur.table = in_table
        if el.tail:
            cur.parts.append((el.tail, bold, italic))

    body = doc.find(".//body")
    walk(body if body is not None else doc, False, False, False)
    flush()
    out: list[Block] = []
    pending_bullet = False
    for blk in blocks:
        t = re.sub(r"(\s*\|\s*)+$", "", blk.text).strip()
        t = re.sub(r"^(\|\s*)+", "", t).strip()
        t = re.sub(r"(\s*\|\s*){2,}", " | ", t)
        t = re.sub(r"\$\s*\|\s*", "$", t)  # "$ | 36,305" -> "$36,305"
        t = re.sub(r"\(\s*\|\s*", "(", t)
        t = re.sub(r"\s*\|\s*\)", ")", t)
        t = re.sub(r"\s*\|\s*%", "%", t)
        if t in {"•", "●", "◦", "▪", "-", "–", "·"}:
            pending_bullet = True
            continue
        if t and not _is_page_furniture(t):
            if pending_bullet:
                t = "• " + t
            out.append(Block(t, blk.bold, blk.italic, blk.table, blk.lead_bold))
        pending_bullet = False
    return out


_PAGE_NUM = re.compile(r"^(page\s+)?\d{1,3}$|^[ivx]{1,5}$|^table of contents$|^EX-\d+(\.\d+)?\s+\d+\s+\S+\s+EX-", re.I)
_RUNNING_HEAD = re.compile(r"^.{0,60}\|\s*\d{4} Form 10-[KQ]\s*\|\s*\d{1,3}$", re.I)


_RUNNING_ITEM = re.compile(r"^(part\s+[ivx]+)?\s*(\|\s*)?(item\s+\d{1,2}[a-d]?(\s*[,&]\s*\d{1,2}[a-d]?)*)?\.?$", re.I)


def _is_page_furniture(t: str) -> bool:
    return bool(_PAGE_NUM.match(t) or _RUNNING_HEAD.match(t))


# ---------------------------------------------------------------- sections

ITEM_RE = re.compile(r"^\s*item\s*(\d{1,2}\s*[a-d]?)\s*[\.:\-–—]?\s*(.*)$", re.I)


@dataclass
class Section:
    key: str  # e.g. "1A"
    title: str
    blocks: list[Block]

    @property
    def text(self) -> str:
        return "\n".join(b.text for b in self.blocks)


def _item_key(text: str) -> tuple[str, str] | None:
    m = ITEM_RE.match(text.replace(" ", " "))
    if not m:
        return None
    key = re.sub(r"\s+", "", m.group(1)).upper()
    rest = m.group(2)
    # Headings like "ITEM 1. B USINESS" (letter-spaced): rejoin a stray single capital.
    rest = re.sub(r"^([A-Z]) ([A-Z]{2,})", r"\1\2", rest)
    return key, rest


def split_items(blocks: list[Block]) -> dict[str, Section]:
    """Split a 10-K / 10-Q / 20-F into Items, skipping the table of contents and running page heads."""
    heads: list[tuple[int, str, str]] = []
    for idx, b in enumerate(blocks):
        if len(b.text) > 250:
            continue
        k = _item_key(b.text)
        if not k:
            continue
        key, title = k
        if title and not title[0].isalpha():
            continue  # running page heads such as "Item 1B, 1C"
        if not title:
            nxt = blocks[idx + 1] if idx + 1 < len(blocks) else None
            # "Item 1A." alone, title in the next (short, emphasized) block; bare running heads are skipped.
            if not (nxt and len(nxt.text) < 120 and (nxt.bold or nxt.text.isupper()) and not _item_key(nxt.text)):
                continue
            title = nxt.text
        heads.append((idx, key, title))
    # The table of contents lists every Item first. The body starts at the earliest heading that is
    # followed by a long stretch of text; take each Item's first heading from there on.
    anchor = 0
    for n, (idx, _key, _title) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(blocks)
        if sum(len(b.text) for b in blocks[idx + 1 : end]) > 3000:
            anchor = idx
            break
    first: dict[str, tuple[int, str]] = {}
    for idx, key, title in heads:
        if idx >= anchor and key not in first:
            first[key] = (idx, title)
    ordered = sorted((v[0], k, v[1]) for k, v in first.items())
    out: dict[str, Section] = {}
    for n, (idx, key, title) in enumerate(ordered):
        end = ordered[n + 1][0] if n + 1 < len(ordered) else len(blocks)
        title = re.split(r"\s*\|\s*", title)[0].strip(" .")
        if not title and idx + 1 < len(blocks):
            title = blocks[idx + 1].text[:120]
        body = [b for b in blocks[idx + 1 : end] if not _RUNNING_ITEM.match(b.text)]
        out[key] = Section(key=key, title=title, blocks=body)
    return out


# 20-F sub-items we use (risk factors are Item 3.D; operating review is Item 5).
SUBITEM_RE = re.compile(r"^\s*(?:item\s*)?(\d{1,2})\s*\.\s*([A-H])\s*[\.:\-–—]?\s+(.{3,})$", re.I)


def split_subitem(section: Section, letter: str) -> Section | None:
    start = None
    for n, b in enumerate(section.blocks):
        m = SUBITEM_RE.match(b.text) if len(b.text) < 200 else None
        if m and m.group(2).upper() == letter.upper():
            start = n
        elif m and start is not None and m.group(2).upper() > letter.upper():
            return Section(f"{section.key}.{letter}", m.group(3), section.blocks[start + 1 : n])
    if start is None:
        return None
    return Section(f"{section.key}.{letter}", section.blocks[start].text, section.blocks[start + 1 :])


_TOC_ROW = re.compile(r"^(.{3,180}?)\s*\|\s*(\d{1,3})$")


def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower().replace("’", "'")).strip()


def toc_section(blocks: list[Block], item_key: str) -> Section | None:
    """Fallback for filers (often banks) whose body has no "Item 2." heading: the table of contents
    lists the Item's sub-sections with page numbers ("Executive Overview | 5"). The section starts at
    the body heading of its first sub-section and ends at the heading of the next sub-section of a
    different Item in page order."""
    limit = min(len(blocks), 400)
    rows: list[tuple[str, str, int]] = []  # (item, title, page)
    cur_item = ""
    seen_items: list[str] = []  # 10-Q Part II re-uses item numbers: label repeats "2#2"
    toc_end = 0
    misses = 0
    for i in range(limit):
        t = blocks[i].text
        if rows and (len(t) > 250 or misses >= 3):
            break  # body text: the table of contents is over
        k = _item_key(t)
        if not k and not _TOC_ROW.match(t):
            misses += 1
            continue
        misses = 0
        if k:
            cur_item = k[0] if k[0] not in seen_items else f"{k[0]}#{seen_items.count(k[0]) + 1}"
            seen_items.append(k[0])
            m = _TOC_ROW.match(t)
            if m:
                rows.append(
                    (cur_item, re.sub(r"^item\s*\d+[a-d]?\.?\s*\|\s*", "", m.group(1), flags=re.I), int(m.group(2)))
                )
            toc_end = i
            continue
        m = _TOC_ROW.match(t)
        if m and cur_item:
            rows.append((cur_item, m.group(1), int(m.group(2))))
            toc_end = i
    mine = [r for r in rows if r[0] == item_key]
    if len(mine) < 2:
        return None
    first = min(mine, key=lambda r: r[2])
    last_page = max(r[2] for r in mine)
    after = [r for r in rows if r[0] != item_key and r[2] > last_page]
    nxt = min(after, key=lambda r: r[2]) if after else None

    def find(title: str, start: int) -> int | None:
        nt = _norm(title)
        for i in range(start, len(blocks)):
            b = blocks[i]
            if len(b.text) > 200:
                continue
            nb = _norm(b.text)
            if len(nb) >= min(25, len(nt)) and (nt.startswith(nb) or nb.startswith(nt)):
                return i
        return None

    start = find(first[1], toc_end + 1)
    if start is None:
        return None
    end = find(nxt[1], start + 1) if nxt else None
    body = [b for b in blocks[start : end or len(blocks)] if not _RUNNING_ITEM.match(b.text)]
    return Section(item_key, first[1], body) if len(body) > 20 else None


SECTION_PLAN = {
    "10-K": {"business": "1", "risk_factors": "1A", "mdna": "7"},
    "10-Q": {"mdna": "2", "risk_factors": "1A"},
    "20-F": {"business": "4", "risk_factors": "3.D", "mdna": "5"},
}


def extract_sections(form: str, html: str) -> dict[str, Section]:
    """Named sections we analyze, for a given form. Missing ones are simply absent."""
    blocks = html_to_blocks(html)
    items = split_items(blocks)
    plan = SECTION_PLAN.get(form.replace("/A", ""), {})
    out: dict[str, Section] = {}
    for name, key in plan.items():
        if "." in key:
            parent, letter = key.split(".")
            sec = items.get(parent)
            sub = split_subitem(sec, letter) if sec else None
            if sub:
                out[name] = sub
        elif key in items and (name != "mdna" or len(items[key].text) > 5000):
            out[name] = items[key]
        elif name == "mdna":
            sec = toc_section(blocks, key)
            if sec:
                out[name] = sec
    return out
