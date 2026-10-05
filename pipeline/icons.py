#!/usr/bin/env python3
"""Resolve each item's icon name once (stored in item_icons, exported in items.parquet).

  icons.py                       resolve names only (the site loads images from Wowhead's CDN)
  icons.py --mirror [out_dir]    also download the images, for a self-hosted copy if the CDN fails
                                 (default out_dir: <AH_DB dir>/public/icons)

Icon names come from our scans (items.icon); for items we never scanned, from Wowhead's tooltip
API (WotLK data), cached in item_icons. Each icon is downloaded once from Wowhead's CDN as
<out_dir>/<icon>.jpg (56x56) with --mirror. Items Wowhead doesn't know (server custom items) are stored with an
empty icon and retried only when our scanner reports a texture for them.
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.request

import db

TOOLTIP = "https://nether.wowhead.com/wotlk/tooltip/item/{}"
IMAGE = "https://wow.zamimg.com/images/wow/icons/large/{}.jpg"
UA = {"User-Agent": "wotlk-ah-icons/1.0 (price history site; one request per item, cached)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def main(out):
    con = db.connect()
    con.execute("INSERT OR REPLACE INTO item_icons SELECT item_id, icon FROM items WHERE icon IS NOT NULL")
    con.commit()
    todo = [r[0] for r in con.execute("""
        SELECT item_id FROM (SELECT item_id FROM tsm_latest UNION SELECT item_id FROM item_stats)
        WHERE item_id NOT IN (SELECT item_id FROM item_icons) ORDER BY item_id""")]
    print(f"{len(todo)} items to look up")

    def lookup(item):
        try:
            return item, (json.loads(get(TOOLTIP.format(item))).get("icon") or "").lower()
        except urllib.error.HTTPError as e:
            return item, "" if e.code == 404 else None
        except Exception:
            return item, None

    # a few requests at a time: fast enough, and gentle with Wowhead
    with ThreadPoolExecutor(max_workers=6) as pool:
        for n, (item, icon) in enumerate(pool.map(lookup, todo), 1):
            if icon is not None:
                con.execute("INSERT OR REPLACE INTO item_icons VALUES (?, ?)", (item, icon))
            if n % 200 == 0:
                con.commit()
                print(f"  {n}/{len(todo)}", flush=True)
    con.commit()
    if out is None:
        return

    names = [r[0] for r in con.execute("SELECT DISTINCT icon FROM item_icons WHERE icon != ''")]
    os.makedirs(out, exist_ok=True)
    fetched = 0
    for name in names:
        path = os.path.join(out, name + ".jpg")
        if os.path.exists(path):
            continue
        try:
            data = get(IMAGE.format(name))
        except Exception as e:
            print(f"  {name}: {e}")
            continue
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
        fetched += 1
        time.sleep(0.05)
    print(f"{len(names)} icons, {fetched} downloaded now")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--mirror"]:
        main(args[1] if len(args) > 1 else os.path.join(os.path.dirname(db.DEFAULT_PATH), "public", "icons"))
    else:
        main(None)
