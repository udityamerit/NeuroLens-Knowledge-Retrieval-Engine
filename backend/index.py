"""Vercel entrypoint: exposes the FastAPI instance as `app` (Vercel looks for index.py at the project root)."""
from app.main import app  # noqa: F401
