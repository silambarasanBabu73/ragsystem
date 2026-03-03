import re
from pathlib import Path
from typing import List, Dict


class DocumentProcessor:
    """Extracts text from PDF, DOCX, TXT and splits into overlapping chunks."""

    CHUNK_SIZE = 200       # smaller chunks = more precise retrieval
    CHUNK_OVERLAP = 40     # overlap to avoid cutting answers in half

    def process(self, filepath: str, original_name: str) -> List[Dict]:
        ext = Path(filepath).suffix.lower()
        if ext == ".pdf":
            text = self._extract_pdf(filepath)
        elif ext == ".docx":
            text = self._extract_docx(filepath)
        else:
            text = Path(filepath).read_text(encoding="utf-8", errors="ignore")

        return self._chunk(text, original_name)

    def _extract_pdf(self, path: str) -> str:
        import pdfplumber
        pages = []
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages):
                t = page.extract_text() or ""
                pages.append(f"[Page {i+1}]\n{t}")
        return "\n\n".join(pages)

    def _extract_docx(self, path: str) -> str:
        from docx import Document
        doc = Document(path)
        paras = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paras)

    def _chunk(self, text: str, source: str) -> List[Dict]:
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]+", " ", text)

        words = text.split()
        if not words:
            return []

        chunks = []
        start = 0
        idx = 0

        while start < len(words):
            end = min(start + self.CHUNK_SIZE, len(words))
            chunk_text = " ".join(words[start:end]).strip()

            if len(chunk_text) > 30:
                ratio = start / max(len(words), 1)
                chunks.append({
                    "id": f"{idx}",
                    "text": chunk_text,
                    "source": source,
                    "chunk_index": idx,
                    "word_start": start,
                    "word_end": end,
                    "approx_page": f"~{int(ratio * 100)}% through doc",
                })
                idx += 1

            start += self.CHUNK_SIZE - self.CHUNK_OVERLAP

        return chunks
