"""Every supported file type is routed to the right reader automatically (text parsers, or the vision model for scans)."""
import io
import zipfile

import pytest

from app.rag import llm, loaders
from test_rag import _chat, _upload


def _pptx_bytes() -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = "Zephyr launch plan"
    s1.placeholders[1].text = "The Zephyr rollout starts in March with three regional pilots in Europe."
    s1.notes_slide.notes_text_frame.text = "Mention the pilot budget of 40 thousand euros."
    s2 = prs.slides.add_slide(prs.slide_layouts[5])
    s2.shapes.title.text = "Budget table"
    tbl = s2.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(5), Inches(1.5)).table
    tbl.cell(0, 0).text, tbl.cell(0, 1).text = "Region", "Budget"
    tbl.cell(1, 0).text, tbl.cell(1, 1).text = "Nordics", "125000"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _scanned_pdf(pages: int = 2) -> bytes:
    from PIL import Image

    imgs = [Image.new("RGB", (400, 500), (250, 250, 250 - i)) for i in range(pages)]
    buf = io.BytesIO()
    imgs[0].save(buf, "PDF", save_all=True, append_images=imgs[1:])
    return buf.getvalue()


def test_pptx_slides_notes_and_tables_are_extracted():
    segs, n = loaders.load_pptx(_pptx_bytes())
    assert n == 2 and [s.page for s in segs] == [1, 2]
    assert "Zephyr rollout" in segs[0].text and "pilot budget" in segs[0].text
    assert "Nordics | 125000" in segs[1].text


def test_pptx_upload_is_searchable_with_slide_numbers(make_user, llm_calls):
    u = make_user("a@example.com")
    r = _upload(u, "plan.pptx", _pptx_bytes())
    assert r.status_code == 201, r.text
    doc = r.json()["documents"][0]
    assert doc["kind"] == "pptx" and doc["pages"] == 2
    res = _chat(u, "Zephyr rollout pilots in Europe").json()
    assert res["sources"] and res["sources"][0]["document"] == "plan.pptx" and res["sources"][0]["page"] == 1


def test_pptx_bomb_and_garbage_rejected(make_user):
    u = make_user("a@example.com")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("ppt/presentation.xml", "A" * (300 * 1024 * 1024))
    assert _upload(u, "bomb.pptx", buf.getvalue()).status_code in (413, 422)
    assert _upload(u, "fake.pptx", b"not a zip file").status_code == 422


@pytest.mark.parametrize("name,fmt", [("old.doc", "DOCX"), ("deck.ppt", "PPTX"), ("sheet.xls", "XLSX/CSV")])
def test_legacy_office_formats_get_actionable_error(make_user, name, fmt):
    u = make_user("a@example.com")
    r = _upload(u, name, b"\xd0\xcf\x11\xe0" + b"\x00" * 100)
    assert r.status_code == 422 and fmt in r.text and "Save As" in r.text


def test_csv_is_indexed_as_text(make_user):
    u = make_user("a@example.com")
    r = _upload(u, "people.csv", b"name,city\nAda Lovelace,London\nAlan Turing,Wilmslow\n" * 3, "text/csv")
    assert r.status_code == 201, r.text


def test_scanned_pdf_is_read_by_the_vision_model(make_user, monkeypatch):
    u = make_user("a@example.com")
    seen = []

    def fake_describe(r, data_url):
        seen.append(data_url)
        return f"Scanned page {len(seen)}: the Orion contract is valid until December twenty ninth."

    monkeypatch.setattr(llm, "describe_image", fake_describe)
    r = _upload(u, "scan.pdf", _scanned_pdf(2), "application/pdf")
    assert r.status_code == 201, r.text
    doc = r.json()["documents"][0]
    assert doc["kind"] == "pdf" and doc["pages"] == 2 and doc["chunk_count"] >= 2
    assert len(seen) == 2 and all(s.startswith("data:image/jpeg;base64,") for s in seen)
    chunks = u["client"].get(f"/api/orgs/{u['org_id']}/documents/{doc['id']}/chunks", headers=u["headers"]).json()
    assert {c["page"] for c in chunks} == {1, 2}


def test_scanned_pdf_ocr_is_capped(make_user, monkeypatch, settings):
    monkeypatch.setattr(settings, "max_ocr_pages", 2)
    u = make_user("a@example.com")
    calls = []
    monkeypatch.setattr(llm, "describe_image", lambda r, url: calls.append(1) or "Orion contract text on this page, long enough to index.")
    assert _upload(u, "big-scan.pdf", _scanned_pdf(5), "application/pdf").status_code == 201
    assert len(calls) == 2


def test_scanned_pdf_without_vision_access_reports_clearly(make_user, monkeypatch):
    u = make_user("a@example.com")

    def boom(r, url):
        raise llm.LLMError("No API key is configured for the vision model.", 400)

    monkeypatch.setattr(llm, "describe_image", boom)
    r = _upload(u, "scan.pdf", _scanned_pdf(1), "application/pdf")
    assert r.status_code == 422 and "vision" in r.text.lower()
    assert u["client"].get(f"/api/orgs/{u['org_id']}/documents", headers=u["headers"]).json() == []
