from typing import List, Dict
import chromadb
from chromadb.utils import embedding_functions


class VectorStore:
    """
    Wraps ChromaDB.
    - One Chroma collection per document (isolated by doc_id).
    - Uses local sentence-transformers — no API keys.
    """

    EMBED_MODEL = "all-MiniLM-L6-v2"   # fast, accurate, ~80MB download once

    def __init__(self, persist_dir: str = "./chroma_db"):
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=self.EMBED_MODEL
        )

    # ── Write ──────────────────────────────────

    def add_document(self, doc_id: str, chunks: List[Dict]):
        """Create (or replace) a collection for this document and index all chunks."""
        col_name = self._col_name(doc_id)

        # Delete existing collection if re-uploading same doc
        try:
            self.client.delete_collection(col_name)
        except Exception:
            pass

        collection = self.client.create_collection(
            name=col_name,
            embedding_function=self.embed_fn,
            metadata={"hnsw:space": "cosine"},
        )

        if not chunks:
            return

        collection.add(
            ids=[c["id"] for c in chunks],
            documents=[c["text"] for c in chunks],
            metadatas=[{k: v for k, v in c.items() if k != "text"} for c in chunks],
        )

    def delete_document(self, doc_id: str):
        try:
            self.client.delete_collection(self._col_name(doc_id))
        except Exception:
            pass

    # ── Read ───────────────────────────────────

    def query(self, doc_id: str, question: str, top_k: int = 5) -> List[Dict]:
        """Return top_k most relevant chunks for a question."""
        col_name = self._col_name(doc_id)
        try:
            collection = self.client.get_collection(
                name=col_name,
                embedding_function=self.embed_fn,
            )
        except Exception:
            return []

        results = collection.query(
            query_texts=[question],
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )

        chunks = []
        docs = results["documents"][0]
        metas = results["metadatas"][0]
        dists = results["distances"][0]

        for text, meta, dist in zip(docs, metas, dists):
            similarity = round((1 - dist) * 100, 1)   # cosine distance → %
            chunks.append({
                "text": text,
                "source": meta.get("source", ""),
                "chunk_index": meta.get("chunk_index", 0),
                "approx_page": meta.get("approx_page", ""),
                "similarity": similarity,
            })

        return chunks

    # ── Helper ─────────────────────────────────

    @staticmethod
    def _col_name(doc_id: str) -> str:
        # Chroma collection names must be 3-63 chars, alphanumeric + hyphens
        return f"doc-{doc_id.replace('_', '-')[:55]}"
