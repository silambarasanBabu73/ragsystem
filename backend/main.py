import os
import uuid
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from document_processor import DocumentProcessor
from vector_store import VectorStore
from rag_engine import RAGEngine

app = FastAPI(title="Local RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

META_FILE = Path("./doc_meta.json")

processor = DocumentProcessor()
vector_store = VectorStore()
rag = RAGEngine(vector_store)


# ── Document metadata helpers ──────────────────
def load_meta():
    if META_FILE.exists():
        return json.loads(META_FILE.read_text())
    return []

def save_meta(meta):
    META_FILE.write_text(json.dumps(meta, default=str))

def get_latest_doc(meta):
    if not meta:
        return None
    return max(meta, key=lambda d: d["uploaded_at"])


# ── Routes ─────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "ollama": rag.check_ollama(), "models": rag.list_models()}


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in [".pdf", ".docx", ".txt"]:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    doc_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{doc_id}{ext}"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Extract & chunk
    try:
        chunks = processor.process(str(save_path), file.filename)
    except Exception as e:
        save_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to process document: {str(e)}")

    # Store in vector DB under this doc_id
    vector_store.add_document(doc_id, chunks)

    # Save metadata
    meta = load_meta()
    meta.append({
        "id": doc_id,
        "name": file.filename,
        "ext": ext.lstrip("."),
        "chunk_count": len(chunks),
        "uploaded_at": datetime.now().isoformat(),
        "path": str(save_path),
    })
    save_meta(meta)

    return {"id": doc_id, "name": file.filename, "chunks": len(chunks), "status": "indexed"}


@app.get("/documents")
def list_documents():
    meta = load_meta()
    latest = get_latest_doc(meta)
    result = []
    for d in sorted(meta, key=lambda x: x["uploaded_at"], reverse=True):
        result.append({**d, "is_active": d["id"] == (latest["id"] if latest else None)})
    return result


@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    meta = load_meta()
    doc = next((d for d in meta if d["id"] == doc_id), None)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Remove from vector store
    vector_store.delete_document(doc_id)

    # Remove file
    Path(doc["path"]).unlink(missing_ok=True)

    # Update meta
    meta = [d for d in meta if d["id"] != doc_id]
    save_meta(meta)

    return {"status": "deleted"}


class QueryRequest(BaseModel):
    question: str
    model: str = "llama3"


@app.post("/query")
async def query(req: QueryRequest):
    meta = load_meta()
    latest = get_latest_doc(meta)

    if not latest:
        raise HTTPException(400, "No documents uploaded. Please upload a document first.")

    try:
        result = rag.query(
            question=req.question,
            doc_id=latest["id"],
            doc_name=latest["name"],
            model=req.model,
        )
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/models")
def get_models():
    return {"models": rag.list_models()}
