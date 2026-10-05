#!/usr/bin/env python3
"""Load auction dump files (every auction of a full AH scan, with its seller; e.g. captured from TSM's
Full Scan records in game) into scans/auctions/items and compute item_stats.

  ingest.py <file.tsv> [...]

File format: one "# realm_faction=<Key> scan_time=<unix> total=<n> unread=<n>" line, then one line per
auction: itemId suffixId count quality level minBid bid buyout timeLeft seller name icon (tab separated).
Files already loaded (same realm + scan_time) are skipped.
"""
import os
import sys

import db


def market_value(units):
    """TSM-like market value: from the cheapest units (sorted, one price per unit), take the first
    15 % and keep adding up to 30 % while the next price is < 1.2x the previous; drop prices more
    than 1.5 standard deviations from that set's mean; return the mean of the rest."""
    n = len(units)
    if n == 0:
        return None
    lo = max(1, int(n * 0.15))
    hi = max(lo, int(n * 0.30))
    take = units[:lo]
    for i in range(lo, hi):
        if units[i] >= 1.2 * units[i - 1]:
            break
        take.append(units[i])
    mean = sum(take) / len(take)
    sd = (sum((u - mean) ** 2 for u in take) / len(take)) ** 0.5
    kept = [u for u in take if abs(u - mean) <= 1.5 * sd] or take
    return int(sum(kept) / len(kept))


def load_file(con, path):
    with open(path, encoding="utf-8", errors="replace") as f:
        meta = dict(kv.split("=", 1) for kv in f.readline().lstrip("# ").split())
        realm, scan_time = db.realm_key(meta["realm_faction"]), int(meta["scan_time"])
        if con.execute("SELECT 1 FROM scans WHERE realm=? AND scan_time=?", (realm, scan_time)).fetchone():
            return None
        cur = con.execute("INSERT INTO scans (realm, scan_time, source, total, unread) VALUES (?,?,?,?,?)",
                          (realm, scan_time, os.path.basename(path), int(meta["total"]), int(meta.get("unread", 0))))
        scan_id = cur.lastrowid
        auctions, items = [], {}
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 11:
                continue
            item, suffix, count, quality, level, min_bid, bid, buyout, tl = (int(x or 0) for x in p[:9])
            auctions.append((scan_id, item, suffix, count, min_bid, bid, buyout, tl, p[9] or None))
            icon = p[11].lower() if len(p) > 11 and p[11] else None
            if p[10] or icon:
                items[item] = (item, p[10] or None, quality if quality >= 0 else None, level or None, icon)
    con.executemany("INSERT INTO auctions VALUES (?,?,?,?,?,?,?,?,?)", auctions)
    con.executemany("""INSERT INTO items VALUES (?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET
                       name=COALESCE(excluded.name, name), quality=COALESCE(excluded.quality, quality),
                       level=COALESCE(excluded.level, level), icon=COALESCE(excluded.icon, icon)""", items.values())
    stats(con, scan_id)
    con.commit()
    return scan_id, len(auctions)


def stats(con, scan_id):
    by_item = {}
    for item, count, buyout in con.execute(
            "SELECT item_id, count, buyout FROM auctions WHERE scan_id=?", (scan_id,)):
        e = by_item.setdefault(item, [0, 0, []])
        e[0] += 1
        e[1] += count
        if buyout > 0:
            e[2].extend([buyout // count] * min(count, 1000))
    rows = []
    for item, (n, qty, units) in by_item.items():
        units.sort()
        def pick(q):
            return units[min(len(units) - 1, int(len(units) * q))] if units else None
        rows.append((scan_id, item, n, qty, units[0] if units else None, pick(0.25), pick(0.5), market_value(units)))
    con.executemany("INSERT OR REPLACE INTO item_stats VALUES (?,?,?,?,?,?,?,?)", rows)


if __name__ == "__main__":
    con = db.connect()
    for path in sys.argv[1:]:
        r = load_file(con, path)
        print(f"{os.path.basename(path)}: " + (f"scan {r[0]}, {r[1]} auctions" if r else "already loaded"))
