"""Safe document loading and chunking. Everything works on in-memory bytes (nothing untrusted is written
to disk), and every format has size / page / decompression limits."""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePath
from typing import Optional

from ..config import get_settings


class DocumentError(Exception):
    """A user-facing problem with an uploaded document."""


ALLOWED_EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".txt": "txt",
    ".csv": "txt",
    ".md": "md",
    ".markdown": "md",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
}
# Old binary Office formats cannot be parsed safely without LibreOffice; tell the user what to do instead of failing vaguely.
LEGACY_EXTENSIONS = {".doc": "DOCX", ".ppt": "PPTX", ".xls": "XLSX/CSV", ".rtf": "DOCX or TXT"}
MAX_DOCX_UNCOMPRESSED = 150 * 1024 * 1024
MAX_DOCX_RATIO = 200
MAX_TEXT_CHARS = 5_000_000


@dataclass
class Segment:
    page: Optional[int]
    text: str


def safe_filename(name: str) -> str:
    base = PurePath((name or "").replace("\\", "/")).name
    base = re.sub(r"[\x00-\x1f<>:\"|?*]", "", base).strip(" .")
    return base[:200]


def detect_kind(filename: str, data: bytes) -> str:
    ext = PurePath(filename).suffix.lower()
    kind = ALLOWED_EXTENSIONS.get(ext)
    if not kind:
        if ext in LEGACY_EXTENSIONS:
            raise DocumentError(
                f"'{ext}' is an old binary format. Open it and use Save As {LEGACY_EXTENSIONS[ext]}, then upload that file."
            )
        raise DocumentError(f"Unsupported file type '{ext or 'unknown'}'. Allowed: PDF, DOCX, PPTX, TXT, MD, CSV, PNG, JPG, WEBP.")
    head = data[:16]
    ok = True
    if kind == "pdf":
        ok = data[:1024].lstrip().startswith(b"%PDF-")
    elif kind in ("docx", "pptx"):
        ok = head.startswith(b"PK\x03\x04")
    elif kind == "image":
        ok = (
            head.startswith(b"\x89PNG\r\n\x1a\n")
            or head.startswith(b"\xff\xd8\xff")
            or (head.startswith(b"RIFF") and data[8:12] == b"WEBP")
        )
    else:
        ok = b"\x00" not in data[:8192]
    if not ok:
        raise DocumentError(f"'{filename}' does not look like a valid {kind.upper()} file.")
    return kind


def image_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    return "image/webp"


def _clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def load_pdf(data: bytes) -> tuple[list[Segment], int]:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    s = get_settings()
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise DocumentError("This PDF is password protected.")
            except DocumentError:
                raise
            except Exception:
                raise DocumentError("This PDF is password protected.")
        n = len(reader.pages)
        if n > s.max_pdf_pages:
            raise DocumentError(f"PDF has {n} pages; the limit is {s.max_pdf_pages}.")
        segs = []
        for i, page in enumerate(reader.pages, 1):
            try:
                t = _clean(page.extract_text() or "")
            except Exception:
                t = ""
            if t:
                segs.append(Segment(i, t))
        return segs, n
    except DocumentError:
        raise
    except (PyPdfError, ValueError, KeyError, OSError, RecursionError):
        raise DocumentError("Could not read this PDF (it may be corrupted).")


def load_docx(data: bytes) -> tuple[list[Segment], int]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            total = sum(i.file_size for i in infos)
            if total > MAX_DOCX_UNCOMPRESSED or (len(data) and total / len(data) > MAX_DOCX_RATIO):
                raise DocumentError("This DOCX is too large when decompressed.")
            if "word/document.xml" not in {i.filename for i in infos}:
                raise DocumentError("This does not look like a valid DOCX file.")
        import docx

        d = docx.Document(io.BytesIO(data))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for table in d.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    parts.append(" | ".join(cells))
        text = _clean("\n".join(parts))
        return ([Segment(None, text)] if text else []), 0
    except DocumentError:
        raise
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        raise DocumentError("Could not read this DOCX (it may be corrupted).")
    except Exception:
        raise DocumentError("Could not read this DOCX.")


def _shape_texts(shape, out: list[str]) -> None:
    """Collect text from a shape, descending into groups and tables."""
    if getattr(shape, "shapes", None) is not None and shape.shape_type == 6:  # MSO_SHAPE_TYPE.GROUP
        for sub in shape.shapes:
            _shape_texts(sub, out)
        return
    if getattr(shape, "has_table", False) and shape.has_table:
        for row in shape.table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                out.append(" | ".join(cells))
        return
    if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
        t = shape.text_frame.text.strip()
        if t:
            out.append(t)


def load_pptx(data: bytes) -> tuple[list[Segment], int]:
    """One segment per slide (page = slide number): titles, text boxes, tables, grouped shapes and speaker notes."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            total = sum(i.file_size for i in infos)
            if total > MAX_DOCX_UNCOMPRESSED or (len(data) and total / len(data) > MAX_DOCX_RATIO):
                raise DocumentError("This PPTX is too large when decompressed.")
            if "ppt/presentation.xml" not in {i.filename for i in infos}:
                raise DocumentError("This does not look like a valid PPTX file.")
        from pptx import Presentation

        prs = Presentation(io.BytesIO(data))
        slides = list(prs.slides)
        if len(slides) > get_settings().max_pdf_pages:
            raise DocumentError(f"Presentation has {len(slides)} slides; the limit is {get_settings().max_pdf_pages}.")
        segs: list[Segment] = []
        for n, slide in enumerate(slides, 1):
            parts: list[str] = []
            for shape in slide.shapes:
                _shape_texts(shape, parts)
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
                notes = slide.notes_slide.notes_text_frame.text.strip()
                if notes:
                    parts.append("Speaker notes: " + notes)
            text = _clean("\n".join(parts))
            if text:
                segs.append(Segment(n, f"Slide {n}\n{text}"))
        return segs, len(slides)
    except DocumentError:
        raise
    except (zipfile.BadZipFile, KeyError, ValueError, OSError):
        raise DocumentError("Could not read this PPTX (it may be corrupted).")
    except Exception:
        raise DocumentError("Could not read this PPTX.")


def render_pdf_pages(data: bytes, pages: list[int], *, max_side: int = 1600) -> list[tuple[int, bytes]]:
    """Render 1-based PDF pages to JPEG so a vision model can read scanned pages."""
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
    except Exception:
        raise DocumentError("Could not open this PDF to read its scanned pages.")
    out: list[tuple[int, bytes]] = []
    try:
        for n in pages:
            if not 1 <= n <= len(pdf):
                continue
            page = pdf[n - 1]
            w, h = page.get_size()
            scale = min(2.0, max_side / max(w, h, 1))
            img = page.render(scale=scale).to_pil().convert("RGB")
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=80)
            out.append((n, buf.getvalue()))
    except DocumentError:
        raise
    except Exception:
        raise DocumentError("Could not render the scanned pages of this PDF.")
    finally:
        pdf.close()
    return out


def load_text(data: bytes) -> tuple[list[Segment], int]:
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    else:  # pragma: no cover - latin-1 never fails
        raise DocumentError("Could not decode text file.")
    text = _clean(text[:MAX_TEXT_CHARS])
    return ([Segment(None, text)] if text else []), 0


def load_document(filename: str, data: bytes) -> tuple[str, list[Segment], int]:
    """Return (kind, segments, pages). Images, and PDFs without a text layer, return no segments; the caller
    transcribes them with a vision model."""
    kind = detect_kind(filename, data)
    if kind == "pdf":
        segs, pages = load_pdf(data)
    elif kind == "docx":
        segs, pages = load_docx(data)
    elif kind == "pptx":
        segs, pages = load_pptx(data)
    elif kind in ("txt", "md"):
        segs, pages = load_text(data)
    else:
        return kind, [], 0
    if not segs and kind == "pdf":
        return kind, [], pages  # no text layer: the caller reads the pages with a vision model (OCR)
    if not segs:
        raise DocumentError("No extractable text found (is this a scanned document? Upload it as an image to use OCR).")
    return kind, segs, pages


# ----------------------------------------------------------------- chunking
_SPLIT_ORDER = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]


def _split(text: str, size: int, level: int = 0) -> list[str]:
    if len(text) <= size:
        return [text]
    if level >= len(_SPLIT_ORDER):
        return [text[i : i + size] for i in range(0, len(text), size)]
    sep = _SPLIT_ORDER[level]
    pieces = text.split(sep)
    out: list[str] = []
    cur = ""
    for i, p in enumerate(pieces):
        piece = p + (sep if i < len(pieces) - 1 else "")
        if len(piece) > size:
            if cur:
                out.append(cur)
                cur = ""
            out.extend(_split(piece, size, level + 1))
            continue
        if len(cur) + len(piece) <= size:
            cur += piece
        else:
            out.append(cur)
            cur = piece
    if cur:
        out.append(cur)
    return out


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    base = [c.strip() for c in _split(text, size) if c.strip()]
    if overlap <= 0 or len(base) <= 1:
        return base
    out = [base[0]]
    for prev, cur in zip(base, base[1:]):
        tail = prev[-overlap:]
        # start the overlap on a word boundary
        sp = tail.find(" ")
        tail = tail[sp + 1 :] if 0 <= sp < len(tail) - 1 else tail
        out.append((tail + " " + cur).strip())
    return out


def chunk_segments(segments: list[Segment]) -> list[tuple[Optional[int], str]]:
    s = get_settings()
    out: list[tuple[Optional[int], str]] = []
    for seg in segments:
        for c in chunk_text(seg.text, s.chunk_size, s.chunk_overlap):
            if len(c) >= 20 or len(segments) == 1:
                out.append((seg.page, c))
    return out
