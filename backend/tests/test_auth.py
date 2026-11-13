import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.config import get_settings
from app.db import session_scope
from app.models import RefreshToken, User
from conftest import STRONG_PW, auth, register

CSRF = {"X-Requested-With": "neurolens"}


def test_register_creates_personal_org_and_session(client):
    data = register(client, "bob@example.com")
    assert data["user"]["email"] == "bob@example.com"
    assert len(data["orgs"]) == 1 and data["orgs"][0]["role"] == "owner" and data["orgs"][0]["is_personal"]
    assert "nl_refresh" in client.cookies
    r = client.get("/api/auth/me", headers=auth(data["access_token"]))
    assert r.status_code == 200 and r.json()["user"]["email"] == "bob@example.com"


def test_register_email_is_case_insensitive_and_unique(client):
    register(client, "Case@Example.com")
    r = client.post("/api/auth/register", json={"email": "case@example.com", "password": STRONG_PW})
    assert r.status_code == 409


@pytest.mark.parametrize("pw", ["short1A!", "alllowercaseletters", "aaaaaaaaaaaaaaaa", "password123"])
def test_weak_passwords_rejected(client, pw):
    r = client.post("/api/auth/register", json={"email": "w@example.com", "password": pw})
    assert r.status_code in (400, 422), r.text


def test_login_ok_and_generic_failure(client):
    register(client, "carol@example.com")
    ok = client.post("/api/auth/login", json={"email": "carol@example.com", "password": STRONG_PW})
    assert ok.status_code == 200
    bad_pw = client.post("/api/auth/login", json={"email": "carol@example.com", "password": "Wrong-Password-1"})
    no_user = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "Wrong-Password-1"})
    assert bad_pw.status_code == no_user.status_code == 401
    assert bad_pw.json() == no_user.json()  # no user enumeration


def test_lockout_after_repeated_failures(client, settings):
    register(client, "dave@example.com")
    for _ in range(settings.max_failed_logins):
        assert client.post("/api/auth/login", json={"email": "dave@example.com", "password": "Wrong-Password-1"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "dave@example.com", "password": STRONG_PW})
    assert r.status_code == 429  # even the right password is refused while locked


def test_access_token_required_and_tampering_rejected(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    tok = register(client, "erin@example.com")["access_token"]
    bad = tok[:-3] + ("A" if tok[-3] != "A" else "B") + tok[-2:]
    assert client.get("/api/auth/me", headers=auth(bad)).status_code == 401


def test_alg_none_and_wrong_key_rejected(client):
    data = register(client, "frank@example.com")
    now = int(time.time())
    claims = {"iss": "neurolens", "sub": data["user"]["id"], "ver": 0, "iat": now, "exp": now + 600, "typ": "access"}
    none_tok = jwt.encode(claims, key=None, algorithm="none")
    assert client.get("/api/auth/me", headers=auth(none_tok)).status_code == 401
    forged = jwt.encode(claims, "some-other-secret-key-that-is-long-enough-xx", algorithm="HS256")
    assert client.get("/api/auth/me", headers=auth(forged)).status_code == 401


def test_expired_token_rejected(client):
    data = register(client, "gina@example.com")
    now = int(time.time())
    claims = {"iss": "neurolens", "sub": data["user"]["id"], "ver": 0, "iat": now - 1000, "exp": now - 10, "typ": "access"}
    tok = jwt.encode(claims, get_settings().secret_key, algorithm="HS256")
    assert client.get("/api/auth/me", headers=auth(tok)).status_code == 401


def test_refresh_requires_csrf_header_and_rotates(client):
    register(client, "hank@example.com")
    assert client.post("/api/auth/refresh").status_code == 403
    old_cookie = client.cookies.get("nl_refresh")
    r = client.post("/api/auth/refresh", headers=CSRF)
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.cookies.get("nl_refresh") != old_cookie


def test_refresh_token_reuse_revokes_family(client):
    register(client, "iris@example.com")
    stolen = client.cookies.get("nl_refresh")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 200
    with session_scope() as db:
        for t in db.query(RefreshToken).filter(RefreshToken.revoked_at.is_not(None)):
            t.revoked_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.commit()
    client.cookies.clear()
    client.cookies.set("nl_refresh", stolen, path="/api/auth")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 401
    with session_scope() as db:
        assert db.query(RefreshToken).filter(RefreshToken.revoked_at.is_(None)).count() == 0


def test_parallel_refresh_within_grace_window_is_tolerated(client):
    register(client, "jack@example.com")
    first = client.cookies.get("nl_refresh")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 200
    client.cookies.clear()
    client.cookies.set("nl_refresh", first, path="/api/auth")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 200


def test_logout_kills_refresh_token(client):
    register(client, "kate@example.com")
    assert client.post("/api/auth/logout", headers=CSRF).status_code in (200, 204)
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 401


def test_change_password_invalidates_old_tokens(client):
    data = register(client, "liam@example.com")
    old = data["access_token"]
    new_pw = "An0ther-Strong-Pass!"
    r = client.post("/api/auth/change-password", headers=auth(old), json={"current_password": STRONG_PW, "new_password": new_pw})
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers=auth(old)).status_code == 401
    assert client.post("/api/auth/login", json={"email": "liam@example.com", "password": new_pw}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "liam@example.com", "password": STRONG_PW}).status_code == 401


def test_change_password_wrong_current(client):
    data = register(client, "mia@example.com")
    r = client.post("/api/auth/change-password", headers=auth(data["access_token"]), json={"current_password": "nope", "new_password": "Zzz-Strong-Pass-1"})
    assert r.status_code in (400, 403)


def test_disabled_user_cannot_use_existing_token(client):
    data = register(client, "ned@example.com")
    with session_scope() as db:
        db.query(User).filter(User.email == "ned@example.com").one().is_active = False
        db.commit()
    assert client.get("/api/auth/me", headers=auth(data["access_token"])).status_code == 401


def test_registration_can_be_disabled(client, monkeypatch, settings):
    monkeypatch.setattr(settings, "allow_registration", False)
    r = client.post("/api/auth/register", json={"email": "x@example.com", "password": STRONG_PW})
    assert r.status_code == 403


def test_auth_endpoint_ip_rate_limit(client, monkeypatch, settings):
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 3)
    codes = [client.post("/api/auth/login", json={"email": "z@example.com", "password": "x"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]


def test_validation_errors_do_not_echo_password(client):
    r = client.post("/api/auth/register", json={"email": "not-an-email", "password": "SuperSecret-Value-123"})
    assert r.status_code == 422
    assert "SuperSecret-Value-123" not in r.text


def test_security_headers_present(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "x-request-id" in r.headers
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"


def test_cors_only_allows_configured_origins(client):
    origin = get_settings().cors_origins[0]
    ok = client.options("/api/auth/login", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == origin
    assert ok.headers.get("access-control-allow-credentials") == "true"
    bad = client.options("/api/auth/login", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
