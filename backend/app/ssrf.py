"""SSRF-safe URL fetching.

Protections:
* only http/https on ports 80/443 (or the default for the scheme)
* every resolved address must be globally routable (no loopback/private/link-local/metadata)
* validation happens at *connect time* inside the network backend, so DNS rebinding between a
  pre-check and the real connection is not possible
* redirects are followed manually (max 4) and each hop is re-validated
* response size and total time are capped; only text-like content types are accepted
"""
from __future__ import annotations

import ipaddress
import socket
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpcore
import httpx


class UnsafeURLError(ValueError):
    pass


class FetchError(RuntimeError):
    pass


_ALLOWED_PORTS = {80, 443, None}
_ALLOWED_TYPES = ("text/html", "text/plain", "application/xhtml+xml", "text/markdown")


def _is_public(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str.split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def resolve_public(host: str, port: int) -> list[str]:
    """Resolve `host` and return only if *all* addresses are public."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeURLError(f"Could not resolve host: {host}") from e
    addrs = [i[4][0] for i in infos]
    if not addrs:
        raise UnsafeURLError("Host did not resolve")
    bad = [a for a in addrs if not _is_public(a)]
    if bad:
        raise UnsafeURLError("Destination is not a public internet address")
    return addrs


def validate_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise UnsafeURLError("Only http and https URLs are allowed")
    if not p.hostname:
        raise UnsafeURLError("URL has no host")
    if p.username or p.password:
        raise UnsafeURLError("Credentials in URLs are not allowed")
    if p.port not in _ALLOWED_PORTS:
        raise UnsafeURLError("Only standard web ports (80/443) are allowed")
    # Literal IPs and obviously internal names are rejected up-front for clear errors.
    host = p.hostname.lower()
    if host in ("localhost",) or host.endswith((".localhost", ".local", ".internal")):
        raise UnsafeURLError("Destination is not a public internet address")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return url  # a hostname; checked again at connect time
    if not _is_public(str(ip)):
        raise UnsafeURLError("Destination is not a public internet address")
    return url


class _SafeBackend(httpcore.SyncBackend):
    """Network backend that validates the resolved address at connect time."""

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addrs = resolve_public(host, port)
        # connect to the vetted IP literal (TLS SNI / cert checks still use the original hostname)
        return super().connect_tcp(addrs[0], port, timeout=timeout, local_address=local_address, socket_options=socket_options)


def _safe_transport() -> httpx.HTTPTransport:
    transport = httpx.HTTPTransport(retries=0)
    # Replace the pool with one that uses our validating backend.
    transport._pool = httpcore.ConnectionPool(  # noqa: SLF001
        ssl_context=httpx.create_ssl_context(),
        max_connections=10,
        max_keepalive_connections=0,
        keepalive_expiry=0,
        http1=True,
        http2=False,
        network_backend=_SafeBackend(),
    )
    return transport


def safe_fetch(url: str, max_bytes: int, timeout: float = 15.0, user_agent: str = "NeuroLensBot/1.0") -> tuple[str, str, str]:
    """Fetch a URL safely. Returns (final_url, content_type, text)."""
    deadline = time.monotonic() + timeout
    current = validate_url(url.strip())
    with httpx.Client(transport=_safe_transport(), timeout=timeout, follow_redirects=False, headers={"User-Agent": user_agent, "Accept": "text/html,text/plain;q=0.9"}) as client:
        for _hop in range(5):
            try:
                with client.stream("GET", current) as resp:
                    if resp.is_redirect:
                        loc = resp.headers.get("location")
                        if not loc:
                            raise FetchError("Redirect without Location")
                        current = validate_url(urljoin(current, loc))
                        continue
                    if resp.status_code >= 400:
                        raise FetchError(f"Remote server returned HTTP {resp.status_code}")
                    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                    if ctype and not ctype.startswith(_ALLOWED_TYPES):
                        raise FetchError(f"Unsupported content type: {ctype or 'unknown'}")
                    declared = resp.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise FetchError("Page is too large")
                    buf = bytearray()
                    for part in resp.iter_bytes():
                        buf.extend(part)
                        if len(buf) > max_bytes:
                            raise FetchError("Page is too large")
                        if time.monotonic() > deadline:
                            raise FetchError("Fetching the page took too long")
                    enc = resp.encoding or "utf-8"
                    return current, ctype, bytes(buf).decode(enc, errors="replace")
            except UnsafeURLError:
                raise
            except httpx.TimeoutException as e:
                raise FetchError("The page took too long to respond") from e
            except (httpx.HTTPError, httpcore.NetworkError) as e:
                if isinstance(getattr(e, "__cause__", None), UnsafeURLError):
                    raise e.__cause__  # type: ignore[misc]
                raise FetchError("Could not connect to the URL") from e
        raise FetchError("Too many redirects")


def extract_text(html: str, fallback_title: str = "") -> tuple[str, str]:
    """Return (title, clean_text) from HTML/plain text."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string.strip() if soup.title and soup.title.string else "") or fallback_title
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe", "noscript", "svg", "img", "video", "audio", "template"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return title[:200], "\n".join(lines)
