import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app import ssrf
from app.ssrf import FetchError, UnsafeURLError, safe_fetch, validate_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://foo.localhost/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://0.0.0.0/",
        "http://100.64.0.1/",
        "http://printer.internal/",
        "file:///etc/passwd",
        "ftp://example.com/",
        "gopher://example.com/",
        "http://user:pass@example.com/",
        "http://example.com:8080/",
        "http://example.com:22/",
    ],
)
def test_validate_url_blocks(url):
    with pytest.raises(UnsafeURLError):
        validate_url(url)


@pytest.mark.parametrize("url", ["https://example.com/page", "http://example.org/a?b=1"])
def test_validate_url_allows_public(url):
    assert validate_url(url) == url


def test_decimal_and_hex_ip_encodings_blocked(monkeypatch):
    # urlparse leaves these as "hostnames"; they must still die at resolve time.
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", ("127.0.0.1", port))])
    for url in ("http://2130706433/", "http://0x7f000001/", "http://017700000001/"):
        with pytest.raises(UnsafeURLError):
            safe_fetch(url, max_bytes=1000)


def test_dns_pointing_to_private_ip_is_blocked_at_connect_time(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", ("10.1.2.3", port))])
    with pytest.raises(UnsafeURLError):
        safe_fetch("http://totally-public-looking.example/", max_bytes=1000)


def test_mixed_public_and_private_answers_blocked(monkeypatch):
    monkeypatch.setattr(
        socket, "getaddrinfo",
        lambda host, port, **kw: [(2, 1, 6, "", ("93.184.216.34", port)), (2, 1, 6, "", ("127.0.0.1", port))],
    )
    with pytest.raises(UnsafeURLError):
        ssrf.resolve_public("rebind.example", 80)


def test_unresolvable_host(monkeypatch):
    def boom(*a, **k):
        raise socket.gaierror("nope")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(UnsafeURLError):
        safe_fetch("http://nonexistent.example/", max_bytes=1000)


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/ok":
            body = b"<html><head><title>Hello</title></head><body><p>" + b"Real content. " * 10 + b"</p></body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif self.path == "/redir-meta":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            body = b""
        elif self.path == "/redir-loop":
            self.send_response(302)
            self.send_header("Location", "/redir-loop")
            body = b""
        elif self.path == "/binary":
            body = b"\x00" * 100
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
        elif self.path == "/big":
            body = b"a" * 50_000
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
        else:
            body = b"no"
            self.send_response(404)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def local_server(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    # Pretend the loopback server is a public host so the fetch machinery itself can be exercised.
    monkeypatch.setattr(ssrf, "_ALLOWED_PORTS", {80, 443, None, port})
    monkeypatch.setattr(ssrf, "resolve_public", lambda host, p: ["127.0.0.1"])
    yield f"http://public.example:{port}"
    srv.shutdown()


def test_fetch_happy_path(local_server):
    final, ctype, text = safe_fetch(local_server + "/ok", max_bytes=100_000)
    assert ctype == "text/html" and "Real content" in text
    title, content = ssrf.extract_text(text, final)
    assert title == "Hello" and "Real content" in content


def test_redirect_to_metadata_ip_is_blocked(local_server):
    with pytest.raises(UnsafeURLError):
        safe_fetch(local_server + "/redir-meta", max_bytes=100_000)


def test_redirect_loop_terminates(local_server):
    with pytest.raises(FetchError):
        safe_fetch(local_server + "/redir-loop", max_bytes=100_000)


def test_binary_content_rejected(local_server):
    with pytest.raises(FetchError):
        safe_fetch(local_server + "/binary", max_bytes=100_000)


def test_oversize_rejected(local_server):
    with pytest.raises(FetchError):
        safe_fetch(local_server + "/big", max_bytes=1000)


def test_http_error_status(local_server):
    with pytest.raises(FetchError):
        safe_fetch(local_server + "/missing", max_bytes=1000)


def test_extract_text_strips_scripts_and_styles():
    html = "<html><head><title>T</title><style>.x{}</style></head><body><script>alert(1)</script><p>Visible text here</p></body></html>"
    title, text = ssrf.extract_text(html)
    assert "alert" not in text and ".x" not in text and "Visible text here" in text


def test_url_endpoint_blocks_internal_and_audits(make_user):
    u = make_user("a@example.com")
    r = u["client"].post(f"/api/orgs/{u['org_id']}/documents/url", headers=u["headers"], json={"url": "http://169.254.169.254/latest/meta-data/"})
    assert r.status_code == 400 and "not allowed" in r.json()["detail"]
    audit = u["client"].get(f"/api/orgs/{u['org_id']}/audit", headers=u["headers"]).json()
    assert any(e["action"] == "document.url_blocked" for e in audit)
