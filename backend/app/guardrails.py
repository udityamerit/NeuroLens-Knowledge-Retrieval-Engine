"""Guardrails for the RAG pipeline.

Layers:
1. Input validation        - size limits, control-character stripping
2. Injection screening     - heuristics for jailbreak / system-prompt-extraction attempts
3. Data protection         - secret and (optionally) PII redaction before text reaches an LLM or a log
4. Untrusted-context hardening - retrieved passages are fenced, delimiter-escaped and flagged
5. Output validation       - canary-token leak detection, secret scrubbing, length cap

None of this is a substitute for model-side safety, but it blocks the common, cheap attacks and
gives operators an audit trail for the rest.
"""
from __future__ import annotations

import re
import secrets
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional

# ------------------------------------------------------------------ helpers
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_INVISIBLE = re.compile(r"[​-‏‪-‮⁠-⁤﻿]")


def clean_text(text: str) -> str:
    """Remove control characters (keeps \\n, \\r, \\t)."""
    return _CONTROL.sub("", text or "")


def _normalise_for_detection(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "")
    t = _INVISIBLE.sub("", t)
    t = re.sub(r"\s+", " ", t).lower()
    # collapse letter-spaced evasions such as "i g n o r e"
    return re.sub(r"\b(?:[a-z] ){3,}[a-z]\b", lambda m: m.group(0).replace(" ", ""), t)


# ------------------------------------------------------- injection screening
# (name, pattern, severity)  severity: "high" blocks in block-mode, "medium" is flagged only
_INJECTION_RULES: list[tuple[str, re.Pattern, str]] = [
    ("override_instructions", re.compile(r"\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|system|safety)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|guardrails?|restrictions?|polic(?:y|ies))\b"), "high"),
    ("reveal_system_prompt", re.compile(r"\b(reveal|show|print|repeat|output|display|leak|dump|tell me)\b[^.\n]{0,40}\b(system|hidden|initial|original|secret|developer)\b[^.\n]{0,20}\b(prompt|instructions?|message)\b"), "high"),
    ("jailbreak_persona", re.compile(r"\b(dan mode|developer mode|jailbreak(?:ed)?|do anything now|no restrictions mode|unfiltered mode)\b"), "high"),
    ("role_hijack", re.compile(r"\byou are (now|no longer)\b[^.\n]{0,60}\b(unrestricted|unfiltered|free|dan|evil|not an? (ai|assistant))\b"), "high"),
    ("exfiltrate_secrets", re.compile(r"\b(api[ _-]?keys?|secret|password|token|credentials?)\b[^.\n]{0,30}\b(of|from|in) (the )?(server|system|environment|backend|database|env)\b"), "medium"),
    ("fake_role_marker", re.compile(r"(^|\n)\s*(system|assistant)\s*:\s", re.I), "medium"),
    ("chat_template_tokens", re.compile(r"<\|?(im_start|im_end|system|endoftext)\|?>|\[/?inst\]|<<sys>>"), "high"),
]


@dataclass
class InputVerdict:
    allowed: bool
    text: str
    flags: list[str] = field(default_factory=list)
    reason: Optional[str] = None


def screen_user_input(text: str, *, max_chars: int, mode: str = "block") -> InputVerdict:
    text = clean_text(text).strip()
    if not text:
        return InputVerdict(False, text, reason="Query cannot be empty.")
    if len(text) > max_chars:
        return InputVerdict(False, text[:max_chars], reason=f"Query is too long (max {max_chars} characters).")
    flags: list[str] = []
    blocking: list[str] = []
    norm = _normalise_for_detection(text)
    for name, pat, sev in _INJECTION_RULES:
        if pat.search(norm if name != "fake_role_marker" else text.lower()):
            flags.append(name)
            if sev == "high":
                blocking.append(name)
    if blocking and mode == "block":
        return InputVerdict(
            False,
            text,
            flags,
            reason="Your message looks like an attempt to override the assistant's instructions, so it was blocked. Rephrase your question about the documents.",
        )
    return InputVerdict(True, text, flags)


# Patterns that indicate a *document* is trying to instruct the model.
_DOC_INJECTION_RULES = [
    re.compile(r"\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|any|system)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?)\b"),
    re.compile(r"\b(you must|you will|you should)\b[^.\n]{0,40}\b(now|instead|always)\b[^.\n]{0,60}\b(respond|reply|say|output|answer|call|send|visit)\b"),
    re.compile(r"<\|?(im_start|im_end|system|endoftext)\|?>|\[/?inst\]|<<sys>>"),
    re.compile(r"\b(send|post|forward|exfiltrate|upload)\b[^.\n]{0,60}\b(conversation|chat|history|api[ _-]?key|password|secret)s?\b[^.\n]{0,40}\bhttps?://"),
    re.compile(r"\bassistant\s*:\s*(sure|ok|okay|i will)\b"),
]


def looks_like_prompt_injection(text: str) -> bool:
    norm = _normalise_for_detection(text)
    return any(p.search(norm) for p in _DOC_INJECTION_RULES)


# -------------------------------------------------------------- redaction
_SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("openrouter_key", re.compile(r"\bsk-or-v1-[A-Za-z0-9]{16,}\b")),
    ("openai_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b")),
    ("groq_key", re.compile(r"\bgsk_[A-Za-z0-9]{20,}\b")),
    ("github_token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")),
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9_\-\.=]{20,}")),
]


def redact_secrets(text: str) -> tuple[str, list[str]]:
    found: list[str] = []
    for name, pat in _SECRET_PATTERNS:
        if pat.search(text):
            found.append(name)
            text = pat.sub(f"[REDACTED_{name.upper()}]", text)
    return text, found


_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_PHONE = re.compile(r"(?<![\w.])(?:\+?\d{1,3}[\s\-.]?)?(?:\(\d{2,4}\)[\s\-.]?)?\d{3,4}[\s\-.]\d{3,4}(?:[\s\-.]\d{3,4})?(?![\w.])")
_CARD = re.compile(r"\b(?:\d[ \-]?){13,19}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_AADHAAR = re.compile(r"\b\d{4}\s\d{4}\s\d{4}\b")
_PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")


def _luhn(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total, alt = 0, False
    for d in reversed(digits):
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def redact_pii(text: str) -> tuple[str, list[str]]:
    found: list[str] = []

    def sub_card(m: re.Match) -> str:
        if _luhn(m.group(0)):
            found.append("credit_card")
            return "[REDACTED_CARD]"
        return m.group(0)

    text = _CARD.sub(sub_card, text)
    for name, pat, repl in (
        ("email", _EMAIL, "[REDACTED_EMAIL]"),
        ("ssn", _SSN, "[REDACTED_SSN]"),
        ("aadhaar", _AADHAAR, "[REDACTED_ID]"),
        ("pan", _PAN, "[REDACTED_ID]"),
        ("phone", _PHONE, "[REDACTED_PHONE]"),
    ):
        if pat.search(text):
            found.append(name)
            text = pat.sub(repl, text)
    return text, found


# -------------------------------------------- untrusted-context hardening
_FENCE_BREAK = re.compile(r"<\s*/?\s*(document|context|passage|system)[^>]*>", re.I)


def neutralise_delimiters(text: str) -> str:
    """Stop a document from closing/forging our context fence."""
    return _FENCE_BREAK.sub("[tag removed]", text)


def build_context_block(passages: Iterable[dict]) -> str:
    parts = []
    for i, p in enumerate(passages, 1):
        attrs = f'id="{i}" source="{_attr(p["source"])}"'
        if p.get("page"):
            attrs += f' page="{int(p["page"])}"'
        if p.get("suspicious"):
            attrs += ' flagged="possible-embedded-instructions"'
        body = neutralise_delimiters(clean_text(p["content"]))
        parts.append(f"<document {attrs}>\n{body}\n</document>")
    return "\n\n".join(parts)


def _attr(s: str) -> str:
    return re.sub(r'["<>\n\r]', "", s or "")[:200]


# ---------------------------------------------------------- output checks
def new_canary() -> str:
    return "NL-" + secrets.token_hex(8)


@dataclass
class OutputVerdict:
    text: str
    flags: list[str] = field(default_factory=list)


def check_output(text: str, *, canary: str, max_chars: int) -> OutputVerdict:
    flags: list[str] = []
    text = clean_text(text or "")
    if canary and canary in text:
        flags.append("system_prompt_leak")
        return OutputVerdict(
            "I can't share my internal instructions. Please ask a question about your documents.", flags
        )
    text, found = redact_secrets(text)
    if found:
        flags.append("secret_in_output")
    if len(text) > max_chars:
        text = text[:max_chars] + "\n\n…[response truncated]"
        flags.append("truncated")
    return OutputVerdict(text, flags)


# ------------------------------------------------------ creator questions
_CREATOR_RE = re.compile(
    r"(\bwho\b[^?.!]{0,30}\b(make|makes|made|build|builds|built|building|create|creates|created|develop|develops|developed|"
    r"program|programs|programmed|design|designs|designed|train|trains|trained|own|owns)\b[^?.!]{0,20}"
    r"\b(you|this (app|tool|project|system|engine|assistant|bot)|neurolens)\b)"
    r"|(\b(your|neurolens'?s?)\s+(creator|developer|author|builder|owner|programmer|maker)\b)"
    r"|(\bauthor study\b|\bstudy the (author|creator)\b|\b(author|creator)'s projects\b)"
)

# "Who/what are you?", "which model are you?", "are you ChatGPT?" - questions about the assistant itself. They are
# never answered from the user's documents, so retrieval is skipped for them.
_IDENTITY_RE = re.compile(
    r"(\bwho\s+(are|r)\s+(you|u)\b)"
    r"|(\bwhat\s+(are|r)\s+(you|u)\b)"
    r"|(\bwhat('?s| is)\s+your\s+(name|model|version|purpose|job|role)\b)"
    r"|(\b(which|what)\s+(ai\s+|llm\s+|language\s+|base\s+|underlying\s+)*(model|llm|ai|chatbot|bot)\b[^?.!]{0,20}\b(are|r|is)\s+(you|u|this|behind)\b)"
    r"|(\bare\s+(you|u)\s+(a\s+|an\s+)?(gpt|chatgpt|openai|claude|gemini|llama|qwen|mistral|deepseek|grok|bard|copilot|ai|bot|robot|human)\b)"
    r"|(\bwhat\s+(llm|model)\s+(do|does)\s+(you|this)\b)"
    r"|(\b(introduce|describe)\s+yourself\b|\btell\s+me\s+about\s+yourself\b)"
    r"|(\bwhich\s+company\b[^?.!]{0,20}\b(made|built|created|trained|owns?)\b[^?.!]{0,15}\b(you|u)\b)"
)

# Questions about what the library contains. Answered from the library catalogue, not from passages.
_LIBRARY_RE = re.compile(
    r"(\b(what|which|list|show)\b[^?.!]{0,40}\b(documents?|files?|sources?|pdfs?|books?)\b[^?.!]{0,40}"
    r"\b(do\s+(i|we|you)\s+have|have\s+(i|we)|are\s+(there|in|available)|(i|we)\s+(uploaded|added)|in\s+(my|the|our)\s+(library|knowledge|database|data))\b)"
    r"|(\b(my|the|our)\s+(library|knowledge\s*base)\b[^?.!]{0,25}\b(contain|contains|have|has|include|includes|holds?)\b)"
    r"|(\bwhat\s+(is|'?s)\s+(in|inside)\s+(my|the|our)\s+(library|knowledge\s*base|database|data)\b)"
    r"|(\b(deleted|removed)\s+(documents?|files?|sources?)\b)"
    r"|(\b(documents?|files?|sources?)\b[^?.!]{0,20}\b(deleted|removed)\b)"
)


def is_creator_question(text: str) -> bool:
    return bool(_CREATOR_RE.search(_normalise_for_detection(text)))


def is_identity_question(text: str) -> bool:
    n = _normalise_for_detection(text)
    return bool(_IDENTITY_RE.search(n) or _CREATOR_RE.search(n))


def is_library_question(text: str) -> bool:
    return bool(_LIBRARY_RE.search(_normalise_for_detection(text)))
