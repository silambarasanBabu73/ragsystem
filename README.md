# 🤖 RAGbot — Local Document Intelligence

> Ask questions about your documents. Powered by local LLM + vector search.
> **No API keys. No internet. 100% private.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        RAGbot System                         │
│                                                             │
│  ┌──────────┐    ┌────────────────────────────────────┐    │
│  │  React   │───▶│         FastAPI Backend             │    │
│  │  UI      │    │                                    │    │
│  │ :3000    │◀───│  ┌──────────────────────────────┐  │    │
│  └──────────┘    │  │      RAG Pipeline            │  │    │
│                  │  │                              │  │    │
│                  │  │  1. Upload → Extract text    │  │    │
│                  │  │  2. Chunk (500 words, 80 overlap)│  │    │
│                  │  │  3. Embed (sentence-transformers)│  │    │
│                  │  │  4. Store → ChromaDB         │  │    │
│                  │  │                              │  │    │
│                  │  │  On Query:                   │  │    │
│                  │  │  5. Embed question           │  │    │
│                  │  │  6. Vector search → top 5    │  │    │
│                  │  │  7. Build prompt + context   │  │    │
│                  │  │  8. Ollama LLM → answer      │  │    │
│                  │  └──────────────────────────────┘  │    │
│                  │                                    │    │
│                  │  ┌──────────┐  ┌───────────────┐  │    │
│                  │  │ ChromaDB │  │  Ollama LLM   │  │    │
│                  │  │ (local)  │  │  (local)      │  │    │
│                  │  └──────────┘  └───────────────┘  │    │
│                  └────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

| Tool | Install |
|------|---------|
| Python 3.10+ | https://python.org |
| Node.js 18+ | https://nodejs.org |
| Ollama | https://ollama.ai |

### 1. Install Ollama & pull a model
```bash
# Install Ollama from https://ollama.ai
ollama pull llama3          # recommended (~4GB)
# or lighter options:
ollama pull mistral         # ~4GB
ollama pull phi3            # ~2GB — fast on low RAM
```

### 2. Run setup
```bash
chmod +x setup.sh
./setup.sh
```

### 3. Start backend
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

### 4. Start frontend
```bash
cd frontend
npm run dev
```

### 5. Open the app
Visit **http://localhost:3000**

---

## How It Works

### Document Upload Flow
1. User uploads PDF, DOCX, or TXT
2. Text extracted (`pdfplumber` / `python-docx`)
3. Text split into overlapping 500-word chunks
4. Each chunk embedded with `all-MiniLM-L6-v2` (runs locally)
5. Embeddings stored in ChromaDB with the document's ID

### Query Flow
1. User types a question
2. Question is embedded with same model
3. ChromaDB cosine similarity search → top 5 most relevant chunks
4. Chunks injected into a strict prompt
5. Ollama LLM generates an answer **only from those chunks**
6. Answer + source excerpts returned to UI

### Multi-document / Latest-only Rule
- Every document gets its own ChromaDB collection tagged with a timestamp
- On every query, **only the most recently uploaded document** is searched
- Older documents are visible in the sidebar but grayed out

---

## File Structure

```
ragbot/
├── backend/
│   ├── main.py              # FastAPI routes
│   ├── document_processor.py # PDF/DOCX/TXT extraction + chunking
│   ├── vector_store.py       # ChromaDB wrapper
│   ├── rag_engine.py         # Retrieval + Ollama call
│   ├── requirements.txt
│   ├── uploads/              # Uploaded files (auto-created)
│   ├── chroma_db/            # Vector DB (auto-created)
│   └── doc_meta.json         # Document metadata (auto-created)
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Full React UI
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── setup.sh
└── README.md
```

---

## Configuration

Edit `backend/rag_engine.py` to change:
- `OLLAMA_BASE` — if Ollama runs on a different port
- `temperature` — lower = more factual (default: 0.1)
- `num_predict` — max answer tokens (default: 512)

Edit `backend/document_processor.py` to change:
- `CHUNK_SIZE` — words per chunk (default: 500)
- `CHUNK_OVERLAP` — overlap between chunks (default: 80)

---

## Security Notes

- All processing is local — nothing sent to the internet
- ChromaDB persists to `./chroma_db/` on disk
- Uploaded files saved to `./uploads/`
- Delete a document via the UI to remove it from both disk and vector DB


# Terminal 1 — Backend
cd ragbot_uploaded/backend
python -m venv venv
source venv/bin/activate        ← Mac/Linux
venv\Scripts\activate           ← Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend (new window)
cd ragbot_uploaded/frontend
npm install
npm run dev

# Then open: http://localhost:3000
