from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from app.core.config import build_settings
from app.services.pdf_service import PDFService


pytest.importorskip("fitz")


def test_pdf_rendering(tmp_path: Path) -> None:
    page_one = Image.new("RGB", (320, 240), "white")
    page_two = Image.new("RGB", (320, 240), "white")
    ImageDraw.Draw(page_one).text((20, 20), "Page 1", fill="black")
    ImageDraw.Draw(page_two).text((20, 20), "Page 2", fill="black")

    pdf_path = tmp_path / "sample.pdf"
    page_one.save(pdf_path, save_all=True, append_images=[page_two])

    pages = PDFService(build_settings()).render_document(pdf_path)

    assert len(pages) == 2
    assert pages[0].page_index == 1
    assert pages[1].page_index == 2
