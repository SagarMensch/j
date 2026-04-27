# Teammate Run Guide

## Clone

```bash
git clone https://github.com/ubermensch22sagar-ui/k.git
cd k
```

## Prerequisites

- Node.js 20+
- Python 3.12+ or 3.13+
- Git

## Backend Setup

1. Create virtual environment in repo root:

```bash
python -m venv .venv
```

2. Activate it:

```bash
.venv\Scripts\activate
```

3. Install backend requirements:

```bash
pip install -r backend\requirements.txt
```

4. Create `backend\.env` from [backend/.env.example](C:/Users/sagar/Downloads/Ingreia/repo/backend/.env.example).
5. Fill the real Supabase, Neo4j, Groq, and Sarvam credentials from the secure handoff channel.

## Frontend Setup

1. Open a second terminal.
2. Install frontend packages:

```bash
cd frontend-nextjs
npm install
```

3. Create `.env.local` from [frontend-nextjs/.env.local.example](C:/Users/sagar/Downloads/Ingreia/repo/frontend-nextjs/.env.local.example).

## Run Demo

Use the one-click launcher:

```bash
start_demo.bat
```

This starts:

- Backend on `http://localhost:8000`
- Frontend on `http://localhost:3000`

## Important Demo Notes

- If `/api/notifications` shows `404`, an old backend process is still running.
- Close all old backend terminals, then rerun `start_demo.bat`.
- Main operator demo user is `Aarav Sharma`.
- Main admin demo user is `Admin User`.
- Demo source PDFs are packaged under `demo-assets/documents/`.

## Recommended Demo Flow

1. Open landing page.
2. Enter admin workspace.
3. Upload or review approved documents.
4. Open operator workspace.
5. Show notifications, training assignments, and assessments.
6. Ask a grounded SOP question in operator lookup.
7. Click the citation chip to open the linked source panel.

## Current Caveat

- Exact page-image jump and highlight works only when the uploaded revision has extracted page images.
- Current source proof always shows grounded chunk text.
- For older revisions without extracted pages, page-image highlight will fall back to text proof.
