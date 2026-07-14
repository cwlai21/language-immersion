#!/usr/bin/env python3
"""One-time helper: obtain a Spotify refresh token via the authorization-code
flow. Requires the Spotify app to list http://127.0.0.1:8888/callback as a
redirect URI.

Usage: python3 get_refresh_token.py <client_id> <client_secret>
"""

import base64
import http.server
import json
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser

REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPES = "user-read-currently-playing user-read-playback-state"

client_id, client_secret = sys.argv[1], sys.argv[2]
state = secrets.token_urlsafe(16)
code_holder = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if query.get("state", [""])[0] != state:
            self.send_error(400, "state mismatch")
            return
        code_holder["code"] = query.get("code", [""])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h2>Done - you can close this tab.</h2>")

    def log_message(self, *args):
        pass


auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
    "client_id": client_id,
    "response_type": "code",
    "redirect_uri": REDIRECT_URI,
    "scope": SCOPES,
    "state": state,
})
print("Opening browser for Spotify authorization…")
webbrowser.open(auth_url)

server = http.server.HTTPServer(("127.0.0.1", 8888), Handler)
while "code" not in code_holder:
    server.handle_request()

req = urllib.request.Request(
    "https://accounts.spotify.com/api/token",
    data=urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code_holder["code"],
        "redirect_uri": REDIRECT_URI,
    }).encode(),
    headers={
        "Authorization": "Basic "
        + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode(),
        "Content-Type": "application/x-www-form-urlencoded",
    },
)
body = json.loads(urllib.request.urlopen(req, timeout=15).read())
print("\nRefresh token (save this):\n")
print(body["refresh_token"])
