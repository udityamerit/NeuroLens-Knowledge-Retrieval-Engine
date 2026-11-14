<div align="center">

<img src="banner.png" alt="NeuroLens banner" width="100%" />

# NeuroLens — Knowledge Retrieval Engine

**A multi-organisation, secure RAG platform: upload your documents, ask questions, get answers with cited sources.**

[![CI](https://github.com/udityamerit/NeuroLens-Knowledge-Retrieval-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/udityamerit/NeuroLens-Knowledge-Retrieval-Engine/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React_19-Vite-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## Contents

1. [What is NeuroLens?](#1-what-is-neurolens)
2. [Feature overview](#2-feature-overview)
3. [System architecture](#3-system-architecture)
4. [How a question is answered (chat flow)](#4-how-a-question-is-answered-chat-flow)
5. [How a document is ingested](#5-how-a-document-is-ingested)
6. [Retrieval in detail (hybrid search and the relevance gate)](#6-retrieval-in-detail)
7. [Authentication and sessions](#7-authentication-and-sessions)
8. [Organisations, roles and data isolation](#8-organisations-roles-and-data-isolation)
9. [Security and guardrails](#9-security-and-guardrails)
10. [Supported file types](#10-supported-file-types)
11. [Project structure](#11-project-structure)
12. [Quick start](#12-quick-start)
13. [Configuration](#13-configuration)
14. [API reference](#14-api-reference)
15. [Deployment](#15-deployment)
16. [Testing and CI](#16-testing-and-ci)
17. [Known limitations](#17-known-limitations)
18. [License](#18-license)

---

## 1. What is NeuroLens?

NeuroLens lets a team build a private knowledge base and chat with it. Each **organisation** has its own library of
PDFs, Word and PowerPoint files, text files, images and web pages. When someone asks a question, NeuroLens finds the
passages that are actually relevant, gives them to a large language model (LLM) as *data*, and returns an answer that
**cites the documents it used**.

The idea in one picture:

```mermaid
flowchart LR
    U([User]) -->|1. uploads files / URLs| L[(Organisation library)]
    U -->|2. asks a question| Q[NeuroLens]
    L -->|3. relevant passages only| Q
    Q -->|4. question + passages| M{{LLM provider}}
    M -->|5. grounded answer| Q
    Q -->|6. answer + cited sources| U
```

**Design principles**

| Principle | What it means in practice |
|---|---|
| Server is the source of truth | Users, organisations, documents, vectors and API keys live on the backend. The browser holds no secrets. |
| Answers must be grounded | Only passages that pass a relevance check reach the model, and only documents the answer really cites are shown as sources. |
| The model knows its context | Every prompt states who the assistant is, which documents exist right now, and which were recently removed, so it does not answer from deleted files or invent content. |
| Tenants never mix | Every route is scoped to an organisation; documents, vector indexes and chats are separate per organisation. |
| Untrusted content stays data | Uploaded text is fenced and screened so it cannot give instructions to the model. |

---

## 2. Feature overview

| Area | What is implemented |
|---|---|
| **Accounts** | Email + password (argon2id, strength policy, lockout after 5 failed attempts), Google / GitHub / Microsoft single sign-on, show/hide password toggle |
| **Sessions** | 15-minute access token kept in memory, rotating refresh token in an HttpOnly cookie with reuse detection, CSRF header, password change signs out other devices |
| **Organisations** | Personal workspace per user, extra organisations, roles (owner / admin / member / viewer), email invitations, SSO-domain auto-join, last-owner protection |
| **Library** | Upload PDF, DOCX, PPTX, TXT, MD, CSV, PNG/JPG/WEBP or add a web page; live upload progress; deleted documents disappear instantly; collapsible library panel |
| **Retrieval** | Hybrid search (FAISS vectors + BM25 keywords) fused with Reciprocal Rank Fusion, fair share across documents, relevance gate |
| **Answers** | Cited sources (only those actually used), identity-aware, library-aware, removed-document aware, optional image question (vision) |
| **File intelligence** | Automatic reader per file type; scanned PDFs and images are read by a vision model (OCR) |
| **Keys** | Platform keys from the server environment, or per-organisation keys encrypted at rest |
| **Guardrails** | Prompt-injection screening, document text fenced as data, secret and PII redaction, system-prompt-leak canary, output length cap |
| **Abuse limits** | Per-IP and per-user rate limits, per-organisation storage and daily question quotas, upload size / zip-bomb / page limits |
| **Web fetching** | SSRF-safe: destination IPs validated at connect time, redirects re-validated, size and content-type limits |
| **Audit** | Security-relevant events recorded per organisation and visible to admins |
| **Ops** | `/health` and `/ready` endpoints, Docker images, docker-compose (SQLite or Postgres), CI with tests, lint, build and dependency audit |

---

## 3. System architecture

### 3.1 Big picture

```mermaid
flowchart TB
    subgraph Browser["Browser (React 19 + Vite)"]
        UI["Auth page · Library sidebar · Chat panel · Org settings"]
        API["api.js client<br/>access token in memory"]
        UI --> API
    end

    subgraph Edge["Edge (production)"]
        NGINX["nginx<br/>serves UI, proxies /api"]
    end

    subgraph Backend["FastAPI backend (system of record)"]
        direction TB
        MW["Middleware<br/>security headers · CORS · trusted hosts · rate limits"]
        R["Routers<br/>auth · sso · orgs · documents · chat"]
        SEC["security.py<br/>JWT · argon2 · roles · org access"]
        RAG["RAG engine<br/>loaders · chunking · embeddings · store · pipeline"]
        GR["guardrails.py<br/>input screen · redaction · output checks"]
        AUD["audit.py"]
        MW --> R
        R --> SEC
        R --> RAG
        RAG --> GR
        R --> AUD
    end

    subgraph Data["Storage"]
        DB[("SQL database<br/>SQLite or PostgreSQL<br/>users · orgs · documents · chunks · audit")]
        IDX[["In-memory per-org index<br/>FAISS + BM25 (rebuilt from DB)"]]
    end

    subgraph External["External services"]
        LLM{{"LLM providers<br/>Groq · OpenAI · OpenRouter"}}
        SSO{{"SSO providers<br/>Google · GitHub · Microsoft"}}
        WEB{{"Public web pages"}}
        TTS{{"ElevenLabs (text-to-speech)"}}
    end

    API -->|HTTPS /api| NGINX --> MW
    R --> DB
    RAG --> DB
    RAG <--> IDX
    RAG -->|chat · vision| LLM
    R -->|OAuth| SSO
    R -->|SSRF-safe fetch| WEB
    R --> TTS
```

### 3.2 Backend layers

```mermaid
flowchart LR
    subgraph HTTP["HTTP layer"]
        main["main.py<br/>app factory, middleware, health"]
        auth["routers/auth.py"]
        sso["routers/sso.py"]
        orgs["routers/orgs.py"]
        docs["routers/documents.py"]
        chat["routers/chat.py"]
    end
    subgraph Core["Core services"]
        security["security.py"]
        services["services.py"]
        ratelimit["ratelimit.py"]
        audit["audit.py"]
        ssrf["ssrf.py"]
        guard["guardrails.py"]
        config["config.py"]
    end
    subgraph Engine["RAG engine (app/rag)"]
        loaders["loaders.py<br/>read + chunk files"]
        emb["embeddings.py<br/>MiniLM / hash fallback"]
        store["store.py<br/>FAISS + BM25 + search"]
        pipe["pipeline.py<br/>prompt + answer"]
        llm["llm.py<br/>provider calls"]
    end
    subgraph Persist["Persistence"]
        models["models.py (SQLAlchemy)"]
        db["db.py (engine, sessions)"]
    end

    auth & sso & orgs & docs & chat --> security
    docs --> loaders --> store
    docs --> ssrf
    chat --> pipe
    pipe --> store --> emb
    pipe --> guard
    pipe --> llm
    HTTP --> ratelimit
    HTTP --> audit
    security & store & audit --> models --> db
    Core --> config
```

### 3.3 Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, plain CSS (glass-style theme), KaTeX math rendering |
| Backend | Python 3.12, FastAPI, Starlette, Pydantic v2, SQLAlchemy 2 |
| Database | SQLite (default, zero setup) or PostgreSQL |
| Vector search | FAISS `IndexFlatIP` (cosine on normalised vectors) |
| Keyword search | BM25 |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (384-d), deterministic hash fallback when the model cannot load |
| Document readers | pypdf, pypdfium2 (page rendering for OCR), python-docx, python-pptx, Pillow |
| LLM access | Groq, OpenAI, OpenRouter (OpenAI-compatible chat API); platform keys or per-organisation keys |
| Auth | argon2id password hashing, JWT access tokens, rotating refresh tokens, OAuth 2.0 for SSO |
| Packaging | Docker, docker-compose, nginx, GitHub Actions |

---

## 4. How a question is answered (chat flow)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as FastAPI /chat
    participant G as Guardrails
    participant S as Store (FAISS + BM25)
    participant L as LLM provider

    User->>UI: Type a question
    UI->>API: POST /api/orgs/{org}/chat (Bearer token)
    API->>API: Check role, rate limit, daily quota
    API->>G: Screen input (injection, length)
    G-->>API: Allowed, with secrets / PII redacted
    API->>API: Load library catalogue + recently removed documents
    alt Question about the assistant or the library
        API->>API: Skip retrieval, answer from catalogue and identity
    else Document question
        API->>L: (optional) rewrite follow-up into a standalone query
        API->>S: search(query, k)
        S-->>API: Only relevant passages (or none)
    end
    API->>API: Build system prompt: identity, catalogue, removed list, fenced passages, canary
    API->>L: Chat completion (system + history + question)
    L-->>API: Raw answer
    API->>G: Check output (canary leak, length)
    API->>API: Keep only sources the answer cites
    API-->>UI: answer + sources + flags
    UI-->>User: Answer with cited sources
```

What goes into the prompt:

```mermaid
flowchart TB
    P["System prompt"]
    P --> I["Identity: NeuroLens, built by Uditya Narayan Tiwari<br/>never claims to be another model"]
    P --> C["Library catalogue: exactly which documents exist right now<br/>(name, type, pages)"]
    P --> RM["Recently removed documents<br/>(must not be answered from memory)"]
    P --> RULES["Rules: answer only from passages, cite sources,<br/>say so when documents do not cover the question"]
    P --> CTX["Retrieved passages<br/>fenced as data, or: none were relevant"]
    P --> CAN["Canary token to detect prompt leaks"]
```

---

## 5. How a document is ingested

```mermaid
flowchart TD
    A([User chooses files or a URL]) --> B{Permission:<br/>member or higher?}
    B -- no --> X1[403]
    B -- yes --> C[Validate: size, count, quota,<br/>extension and magic bytes]
    C -- invalid --> X2[422 with a clear reason]
    C --> D{File type}

    D -- PDF --> E[pypdf text extraction]
    E --> E2{Pages without text?}
    E2 -- yes --> E3[Render pages to JPEG<br/>OCR with vision model<br/>max 15 pages]
    E2 -- no --> F
    E3 --> F
    D -- DOCX --> F1[Paragraphs + tables]
    D -- PPTX --> F2[Per slide: text, tables, groups, notes]
    D -- TXT / MD / CSV --> F3[Decode text]
    D -- Image --> F4[Vision model describes / transcribes]
    D -- URL --> F5[SSRF-safe fetch, extract page text]
    D -- ".doc / .ppt / .xls / .rtf" --> X3["Rejected: Save As the modern format"]

    F1 & F2 & F3 & F4 & F5 & F --> G[Clean text and split into chunks<br/>800 chars, 150 overlap, split on paragraph / sentence]
    G --> H[Flag suspicious instruction-like chunks]
    H --> I[Embed chunks in batches<br/>MiniLM 384-d]
    I --> J[(Save document + chunks in DB)]
    J --> K[Invalidate the organisation's index cache]
    K --> L([Library list refreshes, document is searchable])
```

**Why uploads feel fast:** files are sent one at a time with real progress bars, each appears in the library as soon as it
is ready, and embedding runs in batches while the model is pre-loaded at start-up.

**Deleting** a document removes its row and chunks in one transaction, invalidates the index cache, and the UI removes
it from the list immediately (no page refresh). The deletion is also written to the audit log, which is how NeuroLens
knows which documents were *recently removed*.

---

## 6. Retrieval in detail

NeuroLens never hands the model "the top-k chunks, whatever they are". Ranking alone always returns *something*, even
for unrelated questions, so a **relevance gate** sits after ranking.

```mermaid
flowchart TD
    Q[Standalone query] --> D["Dense search<br/>FAISS cosine similarity"]
    Q --> B["Keyword search<br/>BM25 on content words"]
    D --> F["Reciprocal Rank Fusion<br/>combine both rankings"]
    B --> F
    F --> GATE{"Relevance gate per chunk"}
    GATE -->|"cosine ≥ 0.28<br/>OR matches ≥ 50% of the question's content words"| KEEP[Keep chunk]
    GATE -->|neither| DROP[Drop chunk]
    KEEP --> FS["Fair share<br/>round-robin across documents,<br/>so one big file cannot crowd out others"]
    FS --> OUT[Top-k passages]
    DROP --> NONE{Anything left?}
    NONE -- no --> EMPTY["No passages, no sources<br/>(model is told nothing was relevant)"]
```

| Step | Purpose |
|---|---|
| Query rewrite | Turns a follow-up such as "and its price?" into a standalone search query using the chat history |
| Dense + BM25 | Dense finds meaning, BM25 finds exact terms and names; together they cover each other's blind spots |
| RRF fusion | Combines the two rankings without needing comparable scores |
| Relevance gate | Removes passages that are not actually about the question (`RETRIEVAL_MIN_SCORE`, default `0.28`) |
| Question stop-words | Words such as "who", "you", "build" do not count as content, so identity questions cannot match random text |
| Cited-only sources | Sources shown to the user are limited to documents named in the answer; if the answer says the documents do not cover the question, no sources are shown |

---

## 7. Authentication and sessions

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as FastAPI /api/auth

    User->>UI: Email + password
    UI->>API: POST /login
    API->>API: Verify argon2 hash, check lockout and rate limit
    API-->>UI: Access token (JWT, 15 min) in the response body
    API-->>UI: Refresh token in an HttpOnly cookie
    Note over UI: Access token lives in memory only
    UI->>API: Requests with Authorization: Bearer token
    API-->>UI: 401 when the token expires
    UI->>API: POST /refresh (cookie + CSRF header)
    API->>API: Rotate refresh token, detect reuse
    API-->>UI: New access token and new cookie
    Note over API: A reused (stolen) refresh token revokes the whole token family
```

Single sign-on follows the standard OAuth authorisation-code flow:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as FastAPI /api/auth/sso
    participant P as Provider (Google / GitHub / Microsoft)

    User->>UI: Click "Continue with Google"
    UI->>API: GET /sso/google/login
    API-->>User: Redirect to provider (state + PKCE)
    User->>P: Sign in and consent
    P-->>API: Redirect to /sso/google/callback?code=...
    API->>P: Exchange code for the user's verified identity
    API->>API: Link or create the user, auto-join org by SSO domain
    API-->>UI: Redirect to the app with a session cookie
```

---

## 8. Organisations, roles and data isolation

```mermaid
erDiagram
    USER ||--o{ MEMBERSHIP : has
    ORGANIZATION ||--o{ MEMBERSHIP : has
    ORGANIZATION ||--o{ DOCUMENT : owns
    DOCUMENT ||--o{ CHUNK : "split into"
    ORGANIZATION ||--o{ INVITE : issues
    ORGANIZATION ||--o{ PROVIDER_KEY : "stores (encrypted)"
    ORGANIZATION ||--o{ AUDIT_LOG : records
    ORGANIZATION ||--o{ USAGE_COUNTER : meters
    USER ||--o{ REFRESH_TOKEN : holds
    USER ||--o{ OAUTH_IDENTITY : "signs in with"

    USER {
        string id
        string email
        string name
        string password_hash
    }
    ORGANIZATION {
        string id
        string name
        string slug
        bool is_personal
        string sso_domain
        int retrieval_k
    }
    MEMBERSHIP {
        string role
    }
    DOCUMENT {
        string id
        string name
        string kind
        int pages
        int chunk_count
    }
    CHUNK {
        int page
        string content
        bytes embedding
    }
```

**Roles**

| Capability | Viewer | Member | Admin | Owner |
|---|:-:|:-:|:-:|:-:|
| Ask questions, preview documents | ✅ | ✅ | ✅ | ✅ |
| Upload / delete documents, add web pages | | ✅ | ✅ | ✅ |
| Invite and manage members, API keys, settings, audit log, clear the whole library | | | ✅ | ✅ |
| Delete the organisation, manage owners | | | | ✅ |

**Isolation rules**

- Every organisation route runs through one access check; a non-member receives **404**, so the existence of other organisations is not revealed.
- Each organisation has its own FAISS + BM25 index, built from its own rows only.
- The last owner of an organisation cannot be removed or demoted.
- Per-organisation API keys are encrypted with a Fernet key and only the last four characters are ever returned.

---

## 9. Security and guardrails

```mermaid
flowchart LR
    IN([Request]) --> L1["Transport and edge<br/>security headers · CORS · trusted hosts · rate limits"]
    L1 --> L2["Identity<br/>JWT · refresh rotation · CSRF · lockout"]
    L2 --> L3["Authorisation<br/>org membership · role checks · quotas"]
    L3 --> L4["Input guardrails<br/>injection screen · secret and PII redaction"]
    L4 --> L5["Data handling<br/>magic-byte checks · zip-bomb limits · SSRF-safe fetch<br/>documents fenced as data"]
    L5 --> L6["Output guardrails<br/>canary leak check · length cap"]
    L6 --> OUT([Response + audit entry])
```

| Threat | Defence |
|---|---|
| Stolen or guessed passwords | argon2id, password policy with common-password rejection, lockout, per-IP auth rate limit |
| Token theft | Short access token in memory only, rotating refresh token, reuse detection, HttpOnly cookie, CSRF header |
| Cross-tenant access | Mandatory org check on every route, per-org indexes, 404 for non-members |
| Prompt injection (user) | Input screening with normalisation, block / flag / off modes (`GUARDRAIL_MODE`) |
| Prompt injection (documents) | Chunks are fenced as data, delimiter characters neutralised, instruction-like chunks flagged |
| System-prompt leakage | Canary token in the prompt; responses containing it are replaced |
| Data leakage | Secrets always redacted; PII redaction optional per organisation |
| SSRF via "add a web page" | Destination IP validated at connect time, redirects re-validated, private ranges blocked, size and type limits |
| Malicious uploads | Extension and magic-byte validation, decompression-ratio limits for DOCX / PPTX, page limits, in-memory processing |
| Abuse and cost | Per-IP / per-user rate limits, daily question quota, storage quota |
| Hallucination | Relevance gate, grounded prompt, cited-only sources, library and removed-document awareness |

---

## 10. Supported file types

The correct reader is chosen automatically from the file; you never pick a model or a mode yourself.

| Type | Extensions | How it is read |
|---|---|---|
| PDF (text) | `.pdf` | Text layer extracted per page; page numbers kept for citations |
| PDF (scanned) | `.pdf` | Pages without text are rendered to images and transcribed by a vision model (up to `MAX_OCR_PAGES`, default 15) |
| Word | `.docx` | Paragraphs and tables |
| PowerPoint | `.pptx` | One segment per slide: titles, text boxes, tables, grouped shapes, speaker notes |
| Plain text | `.txt` `.md` `.markdown` `.csv` | Decoded as text |
| Images | `.png` `.jpg` `.jpeg` `.webp` | Transcribed and described by a vision model |
| Web page | URL | Fetched safely and reduced to readable text |
| Old Office formats | `.doc` `.ppt` `.xls` `.rtf` | Rejected with a hint to *Save As* DOCX / PPTX / CSV |

Pictures embedded *inside* Word or PowerPoint files are not read; only their text is.

---

## 11. Project structure

```text
NeuroLens-Knowledge-Retrieval-Engine/
├── backend/
│   ├── app/
│   │   ├── main.py            # app factory, middleware, health/ready
│   │   ├── config.py          # all settings (environment variables)
│   │   ├── models.py          # SQLAlchemy tables
│   │   ├── db.py              # engine and session handling
│   │   ├── security.py        # JWT, password hashing, role / org access
│   │   ├── services.py        # org + session helpers
│   │   ├── guardrails.py      # input / output safety, identity detection
│   │   ├── ratelimit.py       # per-IP / per-user limits
│   │   ├── ssrf.py            # safe outbound fetching
│   │   ├── audit.py           # audit trail
│   │   ├── schemas.py         # request / response models
│   │   ├── routers/           # auth · sso · orgs · documents · chat
│   │   └── rag/
│   │       ├── loaders.py     # file readers + chunking
│   │       ├── embeddings.py  # embedding model (+ hash fallback)
│   │       ├── store.py       # FAISS + BM25 index, search, relevance gate
│   │       ├── pipeline.py    # prompt building and answer assembly
│   │       └── llm.py         # provider selection and API calls
│   ├── tests/                 # 178 automated tests
│   ├── Dockerfile
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # shell: session, org switching, library state
│   │   ├── api.js             # API client (token handling, refresh)
│   │   ├── pages/AuthPage.jsx
│   │   └── components/        # Sidebar · ChatPanel · IngestProgress · OrgSettings · ...
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .github/workflows/         # ci.yml · deploy.yml
└── run.bat                    # one-click Windows dev launcher
```

---

## 12. Quick start

**Requirements:** Python 3.12 and Node.js 20+.

**Windows (one click)**

```bash
copy .env.example .env
run.bat
```

`run.bat` creates the virtual environment, installs dependencies and starts both servers.

**Manual**

```bash
cp .env.example .env            # optional in development
```

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Frontend (second terminal):

```bash
cd frontend
npm ci
npm run dev
```

| URL | What |
|---|---|
| http://localhost:5173 | Web UI (proxies `/api` to the backend) |
| http://localhost:8000/docs | Interactive API documentation |

Then:

1. Register an account (a personal organisation is created for you).
2. Add an LLM key: either `GROQ_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` in `.env`, or an organisation key under **Settings → API keys**.
3. Upload documents and start asking questions.

Without any key, uploads and search work, and chat explains clearly that no API key is configured.

---

## 13. Configuration

Everything is an environment variable; see [`.env.example`](.env.example). The important ones:

| Variable | Default | Purpose |
|---|---|---|
| `NEUROLENS_ENV` | `development` | `production` enforces a strong `SECRET_KEY`, Secure cookies and a non-wildcard CORS list |
| `SECRET_KEY` | dev value | Signs tokens (≥ 32 characters in production) |
| `ENCRYPTION_KEY` | — | Fernet key for organisation API keys. **Losing it makes stored keys unreadable** |
| `DATABASE_URL` | SQLite in `DATA_DIR` | e.g. `postgresql+psycopg://user:pass@host/db` |
| `FRONTEND_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`, `TRUSTED_HOSTS` | localhost | Set to your real URLs in production |
| `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | — | Platform-wide LLM keys (optional; organisations can bring their own) |
| `ALLOW_PLATFORM_KEYS` | `true` | Let organisations without their own key use the platform keys |
| `EMBEDDING_BACKEND` / `EMBEDDING_MODEL` | `sentence-transformers` / MiniLM | `hash` selects the lightweight fallback (tests, serverless without a key); `remote` calls a hosted embeddings API |
| `EMBEDDING_API_KEY` / `EMBEDDING_API_URL` | — / Google Gemini (OpenAI-compatible) | With `EMBEDDING_BACKEND=remote`. Any OpenAI-compatible `/embeddings` endpoint works (Gemini, Jina, Mistral, OpenAI). Falls back to `hash` if no key is set. Changing the embedder re-embeds existing documents automatically on the next search |
| `EMBEDDING_DIMENSIONS` | `768` for Gemini | Vector size requested from the remote service (smaller = less database storage) |
| `RETRIEVAL_MIN_SCORE_REMOTE` / `RETRIEVAL_SCORE_MARGIN_REMOTE` | `0.5` / `0.15` | Relevance floor and allowed gap below the best passage for remote embeddings (their score scale differs from MiniLM) |
| `RETRIEVAL_MIN_SCORE` | `0.28` | Relevance threshold; raise for stricter answers, lower if too few passages are found |
| `MAX_OCR_PAGES` | `15` | Scanned-PDF pages read per document |
| `GUARDRAIL_MODE` | `block` | `block`, `flag` or `off` for input screening |
| `ORG_DAILY_QUERY_QUOTA`, `ORG_STORAGE_MB`, `MAX_UPLOAD_MB` | `500`, `500`, `25` | Per-organisation limits |
| `RATE_LIMIT_PER_MINUTE`, `CHAT_RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE` | `60`, `20`, `10` | Rate limits |
| `TRUST_PROXY_HEADERS` | `false` | `true` only behind a reverse proxy you control |

### Single sign-on

Create an OAuth application with each provider and register this redirect URI:

```text
<PUBLIC_BASE_URL>/api/auth/sso/<google|github|microsoft>/callback
```

Set that provider's `*_CLIENT_ID` and `*_CLIENT_SECRET`. A provider without credentials is hidden from the login page.
Organisation owners can set an **SSO domain** (Settings → General) so verified users from that domain join automatically.

---

## 14. API reference

Interactive documentation is served at `/docs`. Summary:

| Group | Method and path | Purpose |
|---|---|---|
| **Auth** | `POST /api/auth/register` · `/login` · `/logout` · `/refresh` | Create account, sign in and out, rotate tokens |
| | `GET /api/auth/me` · `POST /api/auth/change-password` · `DELETE /api/auth/me` | Profile, password, delete account |
| **SSO** | `GET /api/auth/sso/providers` · `/{provider}/login` · `/{provider}/callback` | Single sign-on |
| **Organisations** | `GET/POST /api/orgs` · `GET/PATCH/DELETE /api/orgs/{org}` | List, create, configure, delete |
| | `…/members`, `…/invites`, `POST /api/invites/accept` | Membership and invitations |
| | `PUT/DELETE …/provider-keys/{provider}` · `GET …/audit` | Organisation API keys, audit log |
| **Documents** | `GET /api/orgs/{org}/documents` | List the library |
| | `POST …/documents` (multipart) · `POST …/documents/url` | Upload files / add a web page |
| | `GET …/documents/{id}/chunks` · `DELETE …/documents/{id}` · `GET …/documents/stats` | Preview, delete, usage |
| **Chat** | `POST /api/orgs/{org}/chat` | Ask a question (optional `document_ids`, history, image) |
| | `POST /api/orgs/{org}/tts` | Text-to-speech |
| **Ops** | `GET /health` · `GET /ready` | Liveness and readiness |

Example chat request:

```json
POST /api/orgs/{org_id}/chat
{
  "query": "What is the pilot budget?",
  "history": [],
  "document_ids": null
}
```

```json
{
  "answer": "The pilot budget is forty thousand euros. [plan.pptx]",
  "sources": [{ "id": 1, "document": "plan.pptx", "page": 1, "snippet": "…", "score": 0.61 }],
  "flags": [],
  "model": "…",
  "provider": "groq"
}
```

---

## 15. Deployment

```mermaid
flowchart LR
    Internet((Internet)) --> TLS["TLS reverse proxy<br/>(your load balancer / Caddy / Traefik)"]
    TLS --> WEB["web container<br/>nginx :8080<br/>serves UI, proxies /api"]
    WEB --> API["api container<br/>FastAPI :8000"]
    API --> VOL[("neurolens-data volume<br/>SQLite file + models cache")]
    API -. optional .-> PG[("db container<br/>PostgreSQL 17")]
    API --> EXT{{"LLM / SSO providers"}}
```

```bash
cp .env.example .env     # set NEUROLENS_ENV=production, SECRET_KEY, ENCRYPTION_KEY, URLs and keys
docker compose up --build                       # SQLite, UI on http://localhost:8080
docker compose --profile postgres up --build    # also starts PostgreSQL (set DATABASE_URL + POSTGRES_PASSWORD)
```

### GitHub Pages UI + hosted API

GitHub Pages serves only static files, so the UI can be published there but the FastAPI backend must run elsewhere. The repo ships both halves:

1. **API** – on [Render](https://render.com): *New → Blueprint →* select this repo (uses [`render.yaml`](render.yaml)). Enter `PUBLIC_BASE_URL` (the service URL) and your `OPENROUTER_API_KEY` when asked. Cross-site login uses a `SameSite=None; Secure` refresh cookie and a CORS allow-list that contains only the Pages origin.
2. **UI** – in the GitHub repo set *Settings → Secrets and variables → Actions → Variables →* `API_URL` = the API's https URL, and *Settings → Pages → Source:* **GitHub Actions**. [`pages.yml`](.github/workflows/pages.yml) then builds and publishes on every push to `main` that touches `frontend/`. It refuses to run (leaving the current site untouched) until `API_URL` is set, and embeds no secrets.

Browsers that block third-party cookies (Safari, Chrome with the setting on) cannot keep the refresh cookie across the two sites, so users there must sign in again after reloading. Putting UI and API behind one domain (the Docker setup above) avoids this.

Production checklist:

- [ ] Terminate TLS in front and set `TRUST_PROXY_HEADERS=true`.
- [ ] Set `FRONTEND_URL`, `PUBLIC_BASE_URL`, `CORS_ORIGINS` and `TRUSTED_HOSTS` to your real https values.
- [ ] Generate and back up `SECRET_KEY` and `ENCRYPTION_KEY`.
- [ ] Never put API keys in variables starting with `VITE_`; Vite embeds those into the public browser bundle.
- [ ] Run a single API process (see [limitations](#17-known-limitations)).

---

## 16. Testing and CI

```bash
cd backend && .venv/Scripts/python -m pytest -q     # 178 tests, no network or API keys needed
cd frontend && npm run lint && npm run build
```

The suite covers authentication, token tampering / expiry / reuse, cross-organisation isolation, roles, invitations,
SSRF, upload validation, every supported file type (including scanned-PDF OCR with a mocked vision model), retrieval and
the relevance gate, identity and removed-document behaviour, guardrails, and quota / rate limiting. LLM calls are mocked.

```mermaid
flowchart LR
    PUSH([Push / PR]) --> B["Backend<br/>pytest + dependency audit"]
    PUSH --> F["Frontend<br/>lint · build · bundle secret scan · npm audit"]
    B & F --> D["Docker images build"]
    D --> DEP["deploy.yml"]
```

---

## 17. Known limitations

- **Not verified against live services in CI:** real LLM responses (default model ids may need adjusting to what your provider serves), real SSO consent flows and PostgreSQL need your credentials and infrastructure.
- **Single worker:** the retrieval index cache and the rate limiter are in-process. Run one API process, or move them to shared storage (e.g. Redis, pgvector) before scaling out.
- **No email delivery:** invitations produce a link the admin shares; there is no password-reset email or email verification yet.
- **No migration tool:** tables are created on start. Adopt Alembic before changing the schema of a deployed system.
- **Encryption at rest** covers organisation API keys only. Documents and vectors are stored unencrypted in the database; use disk or database encryption if that matters for your data.
- **Scanned PDFs:** OCR is capped per document (`MAX_OCR_PAGES`) and needs a vision-capable model key.
- **Whether the model obeys the identity and grounding instructions** ultimately depends on the LLM you choose; stronger instruction-following models behave better.

---

## 18. License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Uditya Narayan Tiwari.
