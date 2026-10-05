#!/usr/bin/env python3
"""Print a valid Cloudflare access token from a `wrangler login` session, refreshing it if needed.

Wrangler refuses its own OAuth session when it runs non-interactively (systemd, CI) and asks for
CLOUDFLARE_API_TOKEN instead. This reads the session wrangler saved (oauth_token, refresh_token,
expiration_time), refreshes it with Cloudflare's OAuth endpoint when it expires within 5 minutes,
writes the new tokens back (the refresh token rotates) and prints the access token:

  export CLOUDFLARE_API_TOKEN=$(pipeline/cf_token.py)
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

CLIENT_ID = "54d11594-84e4-41aa-b438-e81b8fa78ee7"  # wrangler's public OAuth client
TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"
CANDIDATES = ["~/.config/.wrangler/config/default.toml", "~/Library/Preferences/.wrangler/config/default.toml",
              "~/.wrangler/config/default.toml"]


def field(text, name):
    m = re.search(rf'^{name} = "([^"]*)"', text, re.M)
    return m.group(1) if m else None


def main():
    path = next((os.path.expanduser(p) for p in CANDIDATES if os.path.exists(os.path.expanduser(p))), None)
    if not path:
        sys.exit("no wrangler login found (run `npx wrangler login`)")
    text = open(path).read()
    exp = dt.datetime.fromisoformat(field(text, "expiration_time").replace("Z", "+00:00"))
    if exp - dt.datetime.now(dt.timezone.utc) > dt.timedelta(minutes=5):
        print(field(text, "oauth_token"))
        return
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": field(text, "refresh_token"),
                                   "client_id": CLIENT_ID}).encode()
    req = urllib.request.Request(TOKEN_URL, data=body, headers={
        "User-Agent": "wrangler", "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded"})  # the default Python UA gets a 403
    with urllib.request.urlopen(req, timeout=30) as r:
        tok = json.load(r)
    new_exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(tok["expires_in"]))
    text = re.sub(r'^oauth_token = ".*"', f'oauth_token = "{tok["access_token"]}"', text, flags=re.M)
    text = re.sub(r'^refresh_token = ".*"', f'refresh_token = "{tok.get("refresh_token") or field(text, "refresh_token")}"',
                  text, flags=re.M)
    text = re.sub(r'^expiration_time = ".*"', f'expiration_time = "{new_exp.isoformat(timespec="milliseconds").replace("+00:00", "Z")}"',
                  text, flags=re.M)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    print(tok["access_token"])


if __name__ == "__main__":
    main()
