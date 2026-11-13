"""Answers must be grounded: unrelated chunks are never retrieved or cited, the assistant knows who it is, and it knows
which documents are in the library and which were deleted."""
import pytest

from app import guardrails as g
from test_rag import DOC_A, DOC_B, _chat, _upload

# A document that says nothing about who built the assistant (like the user's real PDF).
DOC_RECIPES = (
    "Preheat the oven to 180 degrees and bake the sourdough loaf for forty minutes until golden brown. "
    "Knead the dough with flour, water and salt, then let it rest overnight in the fridge. " * 4
)


@pytest.mark.parametrize(
    "q",
    ["who builds you", "Who built you?", "who are you", "what model are you", "Which LLM are you?", "are you ChatGPT",
     "who trained you", "tell me about yourself", "what is your name"],
)
def test_identity_questions_detected(q):
    assert g.is_identity_question(q), q


@pytest.mark.parametrize("q", ["Who built the Eiffel Tower?", "what is the warranty period", "who are the board members listed"])
def test_identity_not_over_triggered(q):
    assert not g.is_identity_question(q), q


def test_who_builds_you_uses_no_documents(make_user, llm_calls):
    u = make_user("a@example.com")
    _upload(u, "recipes.txt", DOC_RECIPES.encode())
    r = _chat(u, "who builds you")
    assert r.status_code == 200
    assert r.json()["sources"] == []
    system = llm_calls[-1]["messages"][0]["content"]
    assert "<document id=" not in system  # no passages were put in front of the model
    assert "created by Uditya Narayan Tiwari" in system and "Never claim to be Qwen" in system


def test_unrelated_question_returns_no_sources(make_user, llm_calls):
    u = make_user("a@example.com")
    _upload(u, "recipes.txt", DOC_RECIPES.encode())
    r = _chat(u, "Explain quantum entanglement of photons")
    assert r.status_code == 200
    assert r.json()["sources"] == []
    assert "none were relevant" in llm_calls[-1]["messages"][0]["content"]


def test_related_question_still_finds_the_document(make_user, llm_calls):
    u = make_user("a@example.com")
    _upload(u, "recipes.txt", DOC_RECIPES.encode())
    _upload(u, "warranty.txt", DOC_A.encode())
    r = _chat(u, "How long do I bake the sourdough loaf?")
    assert [s["document"] for s in r.json()["sources"]][:1] == ["recipes.txt"]


def test_sources_limited_to_cited_documents(make_user, llm_calls, monkeypatch):
    u = make_user("a@example.com")
    _upload(u, "warranty.txt", DOC_A.encode())
    _upload(u, "finance.txt", DOC_B.encode())
    monkeypatch.setattr(llm, "chat", lambda *a, **k: "The warranty is 36 months [warranty.txt].")
    r = _chat(u, "warranty revenue")
    assert {s["document"] for s in r.json()["sources"]} == {"warranty.txt"}


def test_no_sources_when_model_says_documents_do_not_cover_it(make_user, llm_calls, monkeypatch):
    u = make_user("a@example.com")
    _upload(u, "warranty.txt", DOC_A.encode())
    monkeypatch.setattr(llm, "chat", lambda *a, **k: "The documents do not contain information about that.")
    r = _chat(u, "warranty period")
    assert r.json()["sources"] == []


def test_prompt_lists_library_and_removed_documents(make_user, llm_calls):
    u = make_user("a@example.com")
    gone = _upload(u, "old-policy.txt", DOC_A.encode()).json()["documents"][0]
    _upload(u, "finance.txt", DOC_B.encode())
    assert u["client"].delete(f"/api/orgs/{u['org_id']}/documents/{gone['id']}", headers=u["headers"]).status_code == 204

    _chat(u, "What was Helios Corp revenue in Q3?")
    system = llm_calls[-1]["messages"][0]["content"]
    assert "exactly 1 document(s): finance.txt" in system
    assert "old-policy.txt" in system and "GONE" in system  # listed only as removed
    assert "Retrieved passages:\n\n<document" in system
    assert "Aurora" not in system  # the deleted document's content is not retrievable


def test_removed_name_is_scrubbed_from_history(make_user, llm_calls):
    u = make_user("a@example.com")
    gone = _upload(u, "old-policy.txt", DOC_A.encode()).json()["documents"][0]
    _upload(u, "finance.txt", DOC_B.encode())
    u["client"].delete(f"/api/orgs/{u['org_id']}/documents/{gone['id']}", headers=u["headers"])
    hist = [{"role": "user", "content": "warranty?"}, {"role": "assistant", "content": "36 months [old-policy.txt]"}]
    _chat(u, "and the revenue?", history=hist)
    sent = [m["content"] for m in llm_calls[-1]["messages"][1:-1]]
    assert all("old-policy.txt" not in c for c in sent) and any("[removed document]" in c for c in sent)


def test_library_question_skips_retrieval_and_empty_library_is_stated(make_user, llm_calls):
    u = make_user("a@example.com")
    _chat(u, "what documents do I have?")
    assert "currently EMPTY" in llm_calls[-1]["messages"][0]["content"]
    _upload(u, "finance.txt", DOC_B.encode())
    r = _chat(u, "what documents do I have in my library?")
    assert r.json()["sources"] == []
    assert "finance.txt" in llm_calls[-1]["messages"][0]["content"]


def test_re_uploaded_name_is_not_reported_as_removed(make_user, llm_calls):
    u = make_user("a@example.com")
    d = _upload(u, "x.txt", DOC_A.encode()).json()["documents"][0]
    u["client"].delete(f"/api/orgs/{u['org_id']}/documents/{d['id']}", headers=u["headers"])
    _upload(u, "x.txt", DOC_B.encode())
    _chat(u, "revenue?")
    assert "GONE" not in llm_calls[-1]["messages"][0]["content"]


def test_every_db_dependency_commits_before_the_response():
    """FastAPI 0.118+ runs yield-dependency exit code after the response is sent unless scope='function';
    a later commit races the client's next request (e.g. a delete followed by a list shows stale data)."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parent.parent / "app"
    bad = [str(p) for p in root.rglob("*.py") if re.search(r"Depends\(get_db\)", p.read_text(encoding="utf-8"))]
    assert not bad, bad


from app.rag import llm  # noqa: E402  (kept at the bottom so monkeypatch targets the same module object the pipeline uses)
