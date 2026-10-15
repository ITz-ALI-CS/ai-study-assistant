import io
import re

from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph

PAGE_CHARS = 2800


def _split_long(block, limit):
    if len(block) <= limit:
        return [block]
    parts, current = [], ""
    for line in block.split("\n"):
        while len(line) > limit:
            cut = line.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            if current:
                parts.append(current)
                current = ""
            parts.append(line[:cut].strip())
            line = line[cut:].strip()
        if current and len(current) + len(line) + 1 > limit:
            parts.append(current)
            current = ""
        current = f"{current}\n{line}" if current else line
    if current:
        parts.append(current)
    return [p for p in parts if p]


def paginate(blocks, page_chars=PAGE_CHARS):
    flat = []
    for block in blocks:
        flat.extend(_split_long(block, page_chars))
    pages, current, size = [], [], 0
    for block in flat:
        if current and size + len(block) > page_chars:
            pages.append("\n\n".join(current))
            current, size = [], 0
        current.append(block)
        size += len(block) + 2
    if current:
        pages.append("\n\n".join(current))
    return [(i + 1, text) for i, text in enumerate(pages)]


def text_to_pages(text):
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text.replace("\r", "")) if b.strip()]
    return paginate(blocks)


def _docx_blocks(doc):
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = Paragraph(child, doc).text.strip()
            if text:
                yield text
        elif tag == "tbl":
            table = Table(child, doc)
            for row in table.rows:
                cells = []
                for cell in row.cells:
                    value = cell.text.strip().replace("\n", " ")
                    if value and (not cells or cells[-1] != value):
                        cells.append(value)
                if cells:
                    yield " | ".join(cells)


def docx_to_pages(data):
    doc = DocxDocument(io.BytesIO(data))
    return paginate(list(_docx_blocks(doc)))