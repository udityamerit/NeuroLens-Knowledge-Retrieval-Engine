"""Multi-tenancy, roles, invites, provider keys, audit log."""
from fastapi.testclient import TestClient

from app.db import session_scope
from app.main import app
from app.models import ProviderKey
from conftest import STRONG_PW, auth, register


def _invite(owner, email, role="member"):
    r = owner["client"].post(f"/api/orgs/{owner['org_id']}/invites", headers=owner["headers"], json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    return r.json()


def _accept(user, token):
    return user["client"].post("/api/invites/accept", headers=user["headers"], json={"token": token})


def test_cross_org_access_is_404_not_403(make_user):
    a, b = make_user("a@example.com"), make_user("b@example.com")
    for path in ("", "/members", "/invites", "/audit", "/documents", "/documents/stats"):
        r = b["client"].get(f"/api/orgs/{a['org_id']}{path}", headers=b["headers"])
        assert r.status_code == 404, (path, r.status_code)
    assert b["client"].patch(f"/api/orgs/{a['org_id']}", headers=b["headers"], json={"name": "pwned"}).status_code == 404
    assert b["client"].delete(f"/api/orgs/{a['org_id']}", headers=b["headers"]).status_code == 404
    assert b["client"].post(f"/api/orgs/{a['org_id']}/chat", headers=b["headers"], json={"query": "hi"}).status_code == 404


def test_unauthenticated_requests_rejected(client, make_user):
    a = make_user("a@example.com")
    for method, path in (("get", f"/api/orgs/{a['org_id']}"), ("get", "/api/orgs"), ("get", f"/api/orgs/{a['org_id']}/documents"), ("post", f"/api/orgs/{a['org_id']}/chat")):
        assert getattr(client, method)(path).status_code == 401, path


def test_create_org_and_list(make_user):
    a = make_user("a@example.com", team=False)
    r = a["client"].post("/api/orgs", headers=a["headers"], json={"name": "Acme Corp"})
    assert r.status_code == 201 and r.json()["role"] == "owner" and r.json()["slug"].startswith("acme")
    assert len(a["client"].get("/api/orgs", headers=a["headers"]).json()) == 2


def test_invite_flow_and_roles(make_user):
    owner, bob = make_user("owner@example.com"), make_user("bob@example.com")
    inv = _invite(owner, "bob@example.com", "member")
    assert inv["token"] and inv["role"] == "member"
    listed = owner["client"].get(f"/api/orgs/{owner['org_id']}/invites", headers=owner["headers"]).json()
    assert listed and all(i["token"] is None for i in listed)  # token only shown once
    r = _accept(bob, inv["token"])
    assert r.status_code == 200 and r.json()["id"] == owner["org_id"] and r.json()["role"] == "member"
    # token is single-use
    assert _accept(bob, inv["token"]).status_code in (400, 404, 409, 410)
    # member can read org but not admin things
    assert bob["client"].get(f"/api/orgs/{owner['org_id']}", headers=bob["headers"]).status_code == 200
    assert bob["client"].patch(f"/api/orgs/{owner['org_id']}", headers=bob["headers"], json={"name": "Hacked"}).status_code == 403
    assert bob["client"].post(f"/api/orgs/{owner['org_id']}/invites", headers=bob["headers"], json={"email": "x@example.com"}).status_code == 403
    assert bob["client"].get(f"/api/orgs/{owner['org_id']}/audit", headers=bob["headers"]).status_code == 403
    assert bob["client"].delete(f"/api/orgs/{owner['org_id']}", headers=bob["headers"]).status_code == 403


def test_invite_only_works_for_matching_email(make_user):
    owner, mallory = make_user("owner@example.com"), make_user("mallory@example.com", team=False)
    inv = _invite(owner, "bob@example.com")
    r = _accept(mallory, inv["token"])
    assert r.status_code in (400, 403, 404)
    assert len(mallory["client"].get("/api/orgs", headers=mallory["headers"]).json()) == 1


def test_invite_garbage_token(make_user):
    a = make_user("a@example.com")
    assert _accept(a, "x" * 40).status_code in (400, 404)


def test_cannot_invite_as_owner_via_privilege_escalation(make_user):
    owner = make_user("owner@example.com")
    admin = make_user("admin@example.com")
    _accept(admin, _invite(owner, "admin@example.com", "admin")["token"])
    # admin must not be able to mint an owner
    r = admin["client"].post(f"/api/orgs/{owner['org_id']}/invites", headers=admin["headers"], json={"email": "z@example.com", "role": "owner"})
    assert r.status_code in (400, 403, 422)


def test_role_management_rules(make_user):
    owner, admin, member = make_user("owner@example.com"), make_user("admin@example.com"), make_user("member@example.com")
    _accept(admin, _invite(owner, "admin@example.com", "admin")["token"])
    _accept(member, _invite(owner, "member@example.com", "member")["token"])
    base = f"/api/orgs/{owner['org_id']}/members"
    uid = lambda u: u["data"]["user"]["id"]  # noqa: E731
    # admin cannot demote/remove the owner or promote self to owner
    assert admin["client"].patch(f"{base}/{uid(owner)}", headers=admin["headers"], json={"role": "viewer"}).status_code == 403
    assert admin["client"].delete(f"{base}/{uid(owner)}", headers=admin["headers"]).status_code == 403
    assert admin["client"].patch(f"{base}/{uid(admin)}", headers=admin["headers"], json={"role": "owner"}).status_code == 403
    # member cannot change anyone
    assert member["client"].patch(f"{base}/{uid(member)}", headers=member["headers"], json={"role": "admin"}).status_code == 403
    # admin can demote a member
    assert admin["client"].patch(f"{base}/{uid(member)}", headers=admin["headers"], json={"role": "viewer"}).status_code == 200


def test_last_owner_cannot_leave_or_be_demoted(make_user):
    owner = make_user("owner@example.com")
    base = f"/api/orgs/{owner['org_id']}/members/{owner['data']['user']['id']}"
    assert owner["client"].patch(base, headers=owner["headers"], json={"role": "member"}).status_code in (400, 409)
    assert owner["client"].delete(base, headers=owner["headers"]).status_code in (400, 409)


def test_member_can_leave_and_loses_access(make_user):
    owner, bob = make_user("owner@example.com"), make_user("bob@example.com")
    _accept(bob, _invite(owner, "bob@example.com")["token"])
    assert bob["client"].delete(f"/api/orgs/{owner['org_id']}/members/{bob['data']['user']['id']}", headers=bob["headers"]).status_code == 204
    assert bob["client"].get(f"/api/orgs/{owner['org_id']}", headers=bob["headers"]).status_code == 404


def test_viewer_is_read_only(make_user):
    owner, v = make_user("owner@example.com"), make_user("v@example.com")
    _accept(v, _invite(owner, "v@example.com", "viewer")["token"])
    files = {"files": ("a.txt", b"hello world " * 20, "text/plain")}
    assert v["client"].post(f"/api/orgs/{owner['org_id']}/documents", headers=v["headers"], files=files).status_code == 403
    assert v["client"].get(f"/api/orgs/{owner['org_id']}/documents", headers=v["headers"]).status_code == 200


def test_provider_key_is_encrypted_and_never_returned(make_user):
    owner = make_user("owner@example.com")
    secret = "gsk_" + "Q" * 36
    r = owner["client"].put(f"/api/orgs/{owner['org_id']}/provider-keys/groq", headers=owner["headers"], json={"api_key": secret})
    assert r.status_code == 204
    settings = owner["client"].get(f"/api/orgs/{owner['org_id']}", headers=owner["headers"])
    assert secret not in settings.text
    assert settings.json()["configured_providers"]["groq"] == {"source": "org", "last4": secret[-4:]}
    with session_scope() as db:
        row = db.query(ProviderKey).one()
        raw = row.encrypted_key if hasattr(row, "encrypted_key") else str(row.__dict__)
        assert secret not in str(raw)
    assert owner["client"].delete(f"/api/orgs/{owner['org_id']}/provider-keys/groq", headers=owner["headers"]).status_code == 204
    assert owner["client"].put(f"/api/orgs/{owner['org_id']}/provider-keys/evil", headers=owner["headers"], json={"api_key": secret}).status_code in (404, 422)


def test_member_cannot_set_provider_keys(make_user):
    owner, m = make_user("owner@example.com"), make_user("m@example.com")
    _accept(m, _invite(owner, "m@example.com")["token"])
    r = m["client"].put(f"/api/orgs/{owner['org_id']}/provider-keys/groq", headers=m["headers"], json={"api_key": "gsk_" + "A" * 30})
    assert r.status_code == 403


def test_audit_log_records_events_and_is_org_scoped(make_user):
    owner, other = make_user("owner@example.com"), make_user("other@example.com")
    _invite(owner, "x@example.com")
    ev = owner["client"].get(f"/api/orgs/{owner['org_id']}/audit", headers=owner["headers"]).json()
    assert any(e["action"].startswith("invite") for e in ev)
    ev2 = other["client"].get(f"/api/orgs/{other['org_id']}/audit", headers=other["headers"]).json()
    assert not any(e["action"].startswith("invite") for e in ev2)


def test_org_settings_validation(make_user):
    o = make_user("o@example.com")
    url = f"/api/orgs/{o['org_id']}"
    assert o["client"].patch(url, headers=o["headers"], json={"retrieval_k": 99}).status_code == 422
    assert o["client"].patch(url, headers=o["headers"], json={"llm_provider": "evil"}).status_code == 422
    assert o["client"].patch(url, headers=o["headers"], json={"llm_model": "bad model; rm -rf"}).status_code == 422
    assert o["client"].patch(url, headers=o["headers"], json={"sso_domain": "not a domain"}).status_code == 422
    ok = o["client"].patch(url, headers=o["headers"], json={"redact_pii": True, "retrieval_k": 3, "sso_domain": "@Example.COM"})
    assert ok.status_code == 200 and ok.json()["redact_pii"] is True and ok.json()["sso_domain"] == "example.com"


def test_delete_account_removes_sole_owned_orgs(make_user):
    a = make_user("a@example.com", team=False)
    r = a["client"].request("DELETE", "/api/auth/me", headers=a["headers"], json={"password": STRONG_PW})
    assert r.status_code in (200, 204), r.text
    assert TestClient(app).post("/api/auth/login", json={"email": "a@example.com", "password": STRONG_PW}).status_code == 401


def test_delete_account_requires_password(make_user):
    a = make_user("a@example.com", team=False)
    assert a["client"].request("DELETE", "/api/auth/me", headers=a["headers"], json={"password": "wrong-password"}).status_code == 403
    assert a["client"].delete("/api/auth/me", headers=a["headers"]).status_code == 403
    assert a["client"].get("/api/auth/me", headers=a["headers"]).status_code == 200
