# Meeting Agent Service (Python)

FastAPI backend for **meeting minutes** (PDF/DOCX) ingestion, Chroma + Ollama embedding indexing, and RAG chat via **Ollama** (local LLM).

## Prerequisites

- [Ollama](https://ollama.com/) running locally (default `http://127.0.0.1:11434`).
- Pull the chat and embedding models you configure, for example:
  - `ollama pull llama3.1:8b`
  - `ollama pull nomic-embed-text`

## Quick start

1. Copy `.env.example` to `.env` and adjust `MEETING_AGENT_JWT_*` / `MEETING_AGENT_OLLAMA_*` as needed.
2. Install dependencies:
   - `python -m venv .venv && source .venv/bin/activate`
   - `pip install -r requirements.txt`
3. Run API **from the `meeting_agent_service` directory** (so imports and resolved paths are correct):
   - `uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload`
4. Optional Celery worker (stub tasks only):
   - `celery -A app.worker:celery_app worker --loglevel=INFO`

## Endpoints

- `GET /health`
- `GET /ready`
- `POST /v1/meetings/{meeting_id}/minutes` — multipart upload (PDF or DOCX)
- `GET /v1/meetings/{meeting_id}/transcript` — extracted text from the latest minutes document
- `POST /v1/meetings/{meeting_id}/index` — chunk text, build per-meeting Chroma store (Ollama embeddings)
- `GET /v1/meetings/{meeting_id}/index/status`
- `POST /v1/chat/sessions`
- `POST /v1/chat/sessions/{session_id}/messages`
- `WS /v1/chat/stream` — placeholder stream

## Notes

- **Auth**: Bearer JWT (must match the main MAMS app secret) or `MEETING_AGENT_AUTH_MODE=dev_trust_bearer` for local dev.
- **Storage**: Uploaded files and Chroma data live under `MEETING_AGENT_STORAGE_DIR` (default `./storage`). Relative `MEETING_AGENT_DATABASE_URL` and `MEETING_AGENT_STORAGE_DIR` are resolved under this service folder (not the shell’s current working directory), so SQLite and Chroma can always write there.
- **Indexing failures**: If embeddings fail (Ollama down or wrong model name), the meeting’s `index_status` becomes `FAILED`; fix Ollama and call `POST .../index` again.
- **`attempt to write a readonly database`**: Usually SQLite (main DB or Chroma’s `chroma.sqlite3`) could not create/write files—often WAL/journal files next to the DB, or wrong ownership. The API uses `PRAGMA journal_mode=DELETE` on the main DB to reduce WAL issues. Ensure `meeting_agent_service/` and `storage/` are writable (`chmod -R u+rwX`). If Chroma still fails, set **`MEETING_AGENT_CHROMA_PERSIST_ROOT`** to a writable directory (e.g. `/tmp/mams_chroma`) in `.env`, restart the API, and run **Run indexing** again. Remove stale `storage/chroma/` if you switch roots.
