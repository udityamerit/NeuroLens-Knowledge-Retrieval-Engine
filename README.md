# NeuroLens — Knowledge Retrieval Engine

A multi-tenant RAG (retrieval-augmented generation) service. Teams sign in, upload documents or web pages to a private
organisation library, and ask questions that are answered from those documents with cited sources.

**Architecture:** FastAPI backend is the system of record (users, organisations, documents, vectors, audit log, LLM keys).
The React/Vite UI holds no secrets: it keeps a 15-minute access token in memory and an HttpOnly refresh cookie.

## Features

| Area | What is implemented |
|---|---|
| Accounts | Email + password (argon2id, strength policy, lockout after 5 failures), Google / GitHub / Microsoft SSO |
| Sessions | Short-lived JWT access token, rotating refresh tokens with reuse detection, CSRF header, password change signs out other devices |
| Organisations | Roles owner / admin / member / viewer, email invitations, SSO-domain auto-join, last-owner protection, personal workspace per user |
| Isolation | Every route is scoped to an organisation (non-members get 404); documents, vectors and chat are per-org |
| Keys | Platform keys from the server environment, or per-organisation keys encrypted at rest (only the last 4 characters are ever returned) |
| RAG | PDF, DOCX, TXT/MD/CSV, images (vision), web pages; hybrid vector (FAISS) + BM25 retrieval with rank fusion; cited sources |
| Guardrails | Prompt-injection screening, document content fenced as data, secret / PII redaction, canary-based system-prompt-leak check, output length cap |
| Abuse limits | Per-IP and per-user rate limits, per-org storage and daily question quotas, upload size / zip-bomb / page limits |
| Web fetching | SSRF-safe: destination IPs validated at connect time, redirects re-validated, size and content-type limits |
| Audit | Security-relevant events per organisation, visible to admins |
| Ops | `/health`, `/ready`, Docker images, docker-compose (SQLite or Postgres), CI with tests, lint, build and dependency audit |

## Quick start (development)

Requirements: Python 3.12, Node 20+.

```bash
cp .env.example .env          # optional in dev; add GROQ_API_KEY etc. to enable answers
run.bat                       # Windows: creates the venv, installs, starts both servers
```

Or manually:

```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm ci && npm run dev      # http://localhost:5173 (proxies /api to :8000)
```

Register an account in the UI. Without any LLM key, uploads and retrieval work but chat returns a clear
"no API key configured" message; add a platform key in `.env` or an organisation key under **Settings → API keys**.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example) for the full list. Essentials for production:

- `NEUROLENS_ENV=production` — enforces a `SECRET_KEY` (≥ 32 chars), Secure cookies and a non-wildcard CORS list.
- `ENCRYPTION_KEY` — Fernet key for organisation API keys. **If you lose it, stored organisation keys are unreadable.**
- `DATABASE_URL` — defaults to SQLite under `DATA_DIR`. For Postgres use `postgresql+psycopg://user:pass@host/db`.
- `FRONTEND_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`, `TRUSTED_HOSTS` — set to your real URLs.

### Single sign-on

Create an OAuth application with each provider and register this redirect URI:

```
<PUBLIC_BASE_URL>/api/auth/sso/<google|github|microsoft>/callback
```

Then set that provider's `*_CLIENT_ID` / `*_CLIENT_SECRET`. A provider with no credentials is hidden from the login page.
Organisation owners can set an **SSO domain** (Settings → General) so verified users from that domain join automatically.

## Deploy with Docker

```bash
cp .env.example .env     # set NEUROLENS_ENV=production, SECRET_KEY, ENCRYPTION_KEY, URLs, keys
docker compose up --build                       # SQLite, UI on http://localhost:8080
docker compose --profile postgres up --build    # also start Postgres (set DATABASE_URL + POSTGRES_PASSWORD)
```

Put a TLS-terminating reverse proxy in front (and set `TRUST_PROXY_HEADERS=true`, `TRUSTED_HOSTS`, `FRONTEND_URL`/`PUBLIC_BASE_URL` to the https URLs).
The nginx container serves the UI and proxies `/api`, so everything is one origin.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest      # ~140 tests, no network or API keys needed
cd frontend && npm run lint && npm run build
```

The suite covers authentication, token tampering/expiry/reuse, cross-organisation isolation, roles, invitations, SSRF,
upload validation, retrieval, guardrails and quota/rate limiting. LLM calls are mocked.

## Known limitations

- **Not verified against live services:** real LLM responses (default model ids may need adjusting to what your provider currently serves), real SSO consent flows, and PostgreSQL. These need your credentials/infrastructure.
- **Single worker:** the retrieval index cache and rate limiter are in-process. Run one API process, or move them to shared storage (e.g. Redis, pgvector) before scaling out.
- **No email delivery:** invitations produce a link the admin shares; there is no password-reset email or email verification flow yet.
- **No migrations tool:** tables are created on start. Adopt Alembic before changing the schema in a deployed system.
- **Encryption at rest** covers organisation API keys only; uploaded documents and vectors are stored unencrypted in the database. Use disk/database encryption if that matters for your data.

## Licence

See [LICENSE](LICENSE).
