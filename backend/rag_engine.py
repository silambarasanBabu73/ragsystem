import requests
from typing import List, Dict
from vector_store import VectorStore


OLLAMA_BASE = "http://localhost:11434"


class RAGEngine:
    def __init__(self, vector_store: VectorStore):
        self.vs = vector_store

    def check_ollama(self) -> bool:
        try:
            r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=3)
            return r.status_code == 200
        except Exception:
            return False

    def list_models(self) -> List[str]:
        try:
            r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=3)
            if r.status_code == 200:
                models = r.json().get("models", [])
                return [m["name"] for m in models]
        except Exception:
            pass
        return []

    def query(self, question: str, doc_id: str, doc_name: str, model: str = "mistral:latest") -> Dict:
        # Step 1: Retrieve top 4 most relevant chunks
        chunks = self.vs.query(doc_id, question, top_k=4)

        if not chunks:
            return {
                "answer": "I don't have information about that in the current document.",
                "sources": [],
                "model": model,
                "doc_name": doc_name,
            }

        # Step 2: Build context — use full chunk text, no trimming
        context = ""
        for i, chunk in enumerate(chunks):
            context += f"\n\n[Excerpt {i+1} | Relevance: {chunk['similarity']}%]\n{chunk['text']}"

        # Step 3: Prompt — structured for accuracy
        prompt = f"""You are reading excerpts from a document called "{doc_name}".
Your task is to answer the user's question accurately using ONLY what is written in the excerpts below.

DOCUMENT EXCERPTS:
{context}

USER QUESTION: {question}

INSTRUCTIONS:
- Answer based strictly on the excerpts above
- Be accurate and detailed — include specific names, numbers, steps, or technical details from the document
- If the answer spans multiple excerpts, combine them into one clear answer
- If the information is not in the excerpts, say: "This information is not available in the document."
- Do NOT repeat these instructions. Just give the answer.

ANSWER:"""

        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "options": {
                "temperature": 0.0,   # 0 = fully deterministic, most accurate
                "num_predict": 400,
                "num_ctx": 4096,
            },
        }

        try:
            resp = requests.post(
                f"{OLLAMA_BASE}/api/chat",
                json=payload,
                timeout=300,
            )
            resp.raise_for_status()
            answer = resp.json()["message"]["content"].strip()

            # Remove any accidental instruction leakage
            if "INSTRUCTIONS:" in answer or "ANSWER:" in answer:
                answer = answer.split("ANSWER:")[-1].strip()
                answer = answer.split("INSTRUCTIONS:")[0].strip()

            if not answer:
                answer = "I don't have information about that in the current document."

        except requests.exceptions.ConnectionError:
            raise Exception("Cannot connect to Ollama. Make sure it is running: ollama serve")
        except requests.exceptions.Timeout:
            raise Exception(
                "Model took too long. Run this command and try again: ollama pull mistral"
            )
        except Exception as e:
            raise Exception(f"Ollama error: {str(e)}")

        return {
            "answer": answer,
            "sources": chunks,
            "model": model,
            "doc_name": doc_name,
        }
