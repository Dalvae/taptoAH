#!/usr/bin/env python3
"""Import TSM AuctionDB (v2.3.x, WotLK) history into tsm_daily.

  tsm_import.py <path/to/TradeSkillMaster_AuctionDB.lua> [...]

scanData is "?<item>,<a>,<marketValue>,<lastScan>,<d>,<minBuyout>,<scans>,<quantity>" repeated,
numbers in base 64 (alphabet below), "~" = none. <scans> = "<day>:<v>" joined by "!", where <v> is a
market value, "<avg>@<count>" or the day's raw values joined by ";".
"""
import re
import sys

import db

ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_="
LOOKUP = {c: i for i, c in enumerate(ALPHA)}
ITEM_RE = re.compile(r"\?([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^?]+)")
REALM_RE = re.compile(r'\["(\w+) - ([^"]+)"\] = \{(.*?)\n\t\t\},', re.S)


def decode(s):
    if not s or "~" in s:
        return None
    n = 0
    for c in s:
        n = n * 64 + LOOKUP[c]
    return n


def day_values(rope):
    for part in rope.split("!"):
        day, _, val = part.partition(":")
        day = decode(day)
        if day is None or not val:
            continue
        if "@" in val:
            avg, cnt = val.split("@", 1)
            yield day, decode(avg), decode(cnt)
        elif ";" in val:
            vals = [v for v in (decode(x) for x in val.split(";")) if v]
            if vals:
                yield day, sum(vals) // len(vals), len(vals)
        else:
            yield day, decode(val), None


def import_file(con, path):
    text = open(path, encoding="utf-8", errors="replace").read()
    total = 0
    for faction, realm, body in REALM_RE.findall(text):
        m = re.search(r'\["scanData"\] = "([^"]*)"', body)
        if not m:
            continue
        key = f"{realm.replace(' ', '-')}_{faction}"
        rows, latest = [], []
        for k, _a, mv, last, _d, minb, rest in ITEM_RE.findall(m.group(1)):
            item = decode(k)
            scans, _, qty = rest.rpartition(",")  # "<scans>,<quantity>"
            latest.append((key, item, decode(last), decode(mv), decode(minb), decode(qty)))
            for day, value, count in day_values(scans):
                if value:
                    rows.append((key, item, day, value, count))
        con.executemany("INSERT OR REPLACE INTO tsm_daily VALUES (?,?,?,?,?)", rows)
        con.executemany("INSERT OR REPLACE INTO tsm_latest VALUES (?,?,?,?,?,?)", latest)
        print(f"{path}: {key}: {len(rows)} item-days")
        total += len(rows)
    con.commit()
    return total


if __name__ == "__main__":
    con = db.connect()
    for p in sys.argv[1:]:
        import_file(con, p)
