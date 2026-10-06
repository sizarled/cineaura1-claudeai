#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urljoin
import ipaddress
import os
import socket
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

ROUTES = {
    "/": "index.html",
    "/watch": "watch.html",
    "/watch.html": "watch.html",
    "/Cast.html": "Cast.html",
    "/cast.html": "Cast.html",
    "/cast": "Cast.html",
    "/register": "register.html",
    "/signup": "register.html",
    "/SignUp": "register.html",
    "/login": "login.html",
    "/Rest": "Rest.html",
    "/rest": "Rest.html",
    "/Rest.html": "Rest.html",
    "/dashboard": "dashboard.html",
    "/Profile": "Profile.html",
    "/Profile.html": "Profile.html",
    "/Playlist.html": "Playlist.html",
    "/activate": "activate.html",
    "/Listchannels.html": "Listchannels.html",
    "/Listchannels": "Listchannels.html",
    "/Playlist": "Playlist.html",
    "/Panel": "Panel.html",
}


def resolve_clean_url(path):
    """Serve /name (no extension) from name.html, case-insensitive.

    Shared links are written by hand as often as they are generated, so a
    differently cased page name (/profile.html for Profile.html) resolves too —
    file names are case-sensitive on Linux.
    """
    name = path.strip("/")
    if not name or "/" in name:
        return None
    if "." in name:
        if os.path.exists(os.path.join(ROOT, name)) or not name.lower().endswith(".html"):
            return None
        for f in os.listdir(ROOT):
            if f.lower() == name.lower():
                return f
        return None
    for f in os.listdir(ROOT):
        if f.lower() == name.lower() + ".html":
            return f
    return None


MAX_M3U_BYTES = 40 * 1024 * 1024


def is_public_http_url(url):
    """Allow only http(s) URLs that resolve to public addresses (SSRF guard)."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return False
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80))
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_m3u(url):
    opener = urllib.request.build_opener(_NoRedirect)
    for _ in range(4):
        if not is_public_http_url(url):
            raise ValueError("blocked")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 CineAura-M3U"})
        try:
            with opener.open(req, timeout=25) as resp:
                data = resp.read(MAX_M3U_BYTES + 1)
                if len(data) > MAX_M3U_BYTES:
                    raise ValueError("too large")
                return data
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308) and err.headers.get("Location"):
                url = urljoin(url, err.headers["Location"])
                continue
            raise
    raise ValueError("too many redirects")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".sql": "text/plain; charset=utf-8",
    }

    def proxy_m3u(self, parsed):
        url = (parse_qs(parsed.query).get("url") or [""])[0]
        try:
            body = fetch_m3u(url)
        except Exception:
            self.send_error(502, "Could not fetch playlist")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/m3u":
            return self.proxy_m3u(parsed)
        mapped = ROUTES.get(parsed.path) or resolve_clean_url(parsed.path)
        if mapped:
            self.path = "/" + mapped
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"CineAura serving on http://0.0.0.0:{port}", flush=True)
    httpd.serve_forever()
