#!/usr/bin/env python3
"""Load auction dump files (every auction of a full AH scan, with its seller; e.g. captured from TSM's
Full Scan records in game) into scans/auctions/items and compute item_stats.

  ingest.py <file.tsv> [...]

File format: one "# realm_faction=<Key> scan_time=<unix> mode=full|partial total=<n> unread=<n>" line,
for partial scans a "# covered=<itemId>,<itemId>,..." line (the items that scan looked at), then one line
per auction: itemId suffixId count quality level minBid bid buyout timeLeft seller name icon (tab separated).
Files already loaded (same realm + scan_time) are skipped.

Each scan also updates current_auctions (for all items on a full scan, for the covered items on a partial
one) and records auction_events: listings that are new, and listings that disappeared, as "expired" when
they had run out of time since they were last seen and as "sold" otherwise (cancelled ones look sold).

Unknown sellers: the client gives no seller name until it has looked that player up, so a fast scan reads
some auctions with seller "?". fill_owners() names them when exactly one known seller has an auction with the
same item, suffix, stack size, min bid and buyout, in this scan or on the AH before it (current_auctions);
the names this scan does know also fill earlier scans' "?" auctions of the same key.
  ingest.py --backfill   do that for the scans already loaded
"""
import os
import sys
from collections import Counter

import db

# upper bound of each GetAuctionItemTimeLeft bucket, seconds: short, medium, long, very long
TIME_LEFT_MAX = {1: 30 * 60, 2: 2 * 3600, 3: 12 * 3600, 4: 48 * 3600}


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
        mode = meta.get("mode", "full")
        if con.execute("SELECT 1 FROM scans WHERE realm=? AND scan_time=?", (realm, scan_time)).fetchone():
            return None
        covered = None
        auctions, items = [], {}
        for line in f:
            if line.startswith("# covered="):
                covered = {int(x) for x in line.split("=", 1)[1].split(",") if x.strip()}
                continue
            p = line.rstrip("\n").split("\t")
            if len(p) < 11:
                continue
            item, suffix, count, quality, level, min_bid, bid, buyout, tl = (int(x or 0) for x in p[:9])
            auctions.append((None, item, suffix, count, min_bid, bid, buyout, tl, p[9] or None))
            icon = p[11].lower() if len(p) > 11 and p[11] else None
            if p[10] or icon:
                items[item] = (item, p[10] or None, quality if quality >= 0 else None, level or None, icon)
    if mode == "partial" and covered is None:
        mode = "full"  # no covered list: treat as a whole-AH snapshot
    cur = con.execute("INSERT INTO scans (realm, scan_time, source, total, unread, mode, covered) VALUES (?,?,?,?,?,?,?)",
                      (realm, scan_time, os.path.basename(path), int(meta["total"]), int(meta.get("unread", 0)),
                       mode, ",".join(map(str, sorted(covered))) if covered else None))
    scan_id = cur.lastrowid
    auctions = fill_owners(con, realm, scan_id, [(scan_id,) + a[1:] for a in auctions])
    update_current(con, realm, scan_time, mode, covered, auctions)
    con.executemany("INSERT INTO auctions VALUES (?,?,?,?,?,?,?,?,?)", auctions)
    con.executemany("""INSERT INTO items VALUES (?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET
                       name=COALESCE(excluded.name, name), quality=COALESCE(excluded.quality, quality),
                       level=COALESCE(excluded.level, level), icon=COALESCE(excluded.icon, icon)""", items.values())
    stats(con, scan_id)
    con.commit()
    return scan_id, len(auctions)


UNKNOWN = "?"


def owner_key(a):
    """(item, suffix, count, min_bid, buyout) of an auctions-table tuple."""
    return a[1], a[2], a[3], a[4], a[6]


def fill_owners(con, realm, scan_id, auctions):
    """Name the "?" sellers of `auctions` (see the module doc); returns the new list."""
    names = {}
    def see(k, owner):
        if owner and owner != UNKNOWN:
            names.setdefault(k, set()).add(owner)
    for a in auctions:
        see(owner_key(a), a[8])
    known_here = {k: set(v) for k, v in names.items()}
    for row in con.execute("SELECT item_id, suffix_id, count, min_bid, buyout, owner FROM current_auctions "
                           "WHERE realm=?", (realm,)):
        see(row[:5], row[5])
    filled = 0
    out = []
    for a in auctions:
        if a[8] in (None, UNKNOWN):
            n = names.get(owner_key(a))
            if n and len(n) == 1:
                a = a[:8] + (next(iter(n)),)
                filled += 1
        out.append(a)
    # this scan's names for earlier scans' unknown auctions of the realm
    back = 0
    for k, n in known_here.items():
        if len(n) == 1:
            back += con.execute(
                "UPDATE auctions SET owner=? WHERE owner=? AND scan_id<>? AND item_id=? AND suffix_id=? AND count=? "
                "AND min_bid=? AND buyout=? AND scan_id IN (SELECT scan_id FROM scans WHERE realm=?)",
                (next(iter(n)), UNKNOWN, scan_id) + k + (realm,)).rowcount
            # and in current_auctions, so update_current doesn't see "?" -> name as sold + new
            con.execute("UPDATE current_auctions SET owner=? WHERE realm=? AND owner=? AND item_id=? AND suffix_id=? "
                        "AND count=? AND min_bid=? AND buyout=?", (next(iter(n)), realm, UNKNOWN) + k)
    unknown = sum(1 for a in out if a[8] in (None, UNKNOWN))
    if filled or back or unknown:
        print(f"sellers: {filled} unknown named from matching auctions, {back} in earlier scans; {unknown} still unknown")
    return out


def backfill(con):
    """fill_owners() for every scan already loaded, oldest first (current_auctions is not rewound)."""
    for scan_id, realm in con.execute("SELECT scan_id, realm FROM scans ORDER BY scan_time").fetchall():
        rows = con.execute("SELECT rowid, * FROM auctions WHERE scan_id=?", (scan_id,)).fetchall()
        new = fill_owners(con, realm, scan_id, [r[1:] for r in rows])
        con.executemany("UPDATE auctions SET owner=? WHERE rowid=?",
                        [(a[8], r[0]) for r, a in zip(rows, new) if a[8] != r[9]])
    # current_auctions is a copy of the newest scans: take the names from them
    con.execute("""UPDATE current_auctions SET owner = (
                     SELECT MAX(a.owner) FROM auctions a JOIN scans s USING (scan_id)
                     WHERE s.realm = current_auctions.realm AND s.scan_time = current_auctions.seen
                       AND a.item_id = current_auctions.item_id AND a.suffix_id = current_auctions.suffix_id
                       AND a.count = current_auctions.count AND a.min_bid = current_auctions.min_bid
                       AND a.buyout = current_auctions.buyout AND a.owner <> ?
                     HAVING COUNT(DISTINCT a.owner) = 1)
                   WHERE owner = ? AND EXISTS (
                     SELECT 1 FROM auctions a JOIN scans s USING (scan_id)
                     WHERE s.realm = current_auctions.realm AND s.scan_time = current_auctions.seen
                       AND a.item_id = current_auctions.item_id AND a.suffix_id = current_auctions.suffix_id
                       AND a.count = current_auctions.count AND a.min_bid = current_auctions.min_bid
                       AND a.buyout = current_auctions.buyout AND a.owner <> ?
                     GROUP BY a.item_id HAVING COUNT(DISTINCT a.owner) = 1)""", (UNKNOWN, UNKNOWN, UNKNOWN))
    con.commit()


def update_current(con, realm, scan_time, mode, covered, auctions):
    """Diff the scan against current_auctions (for the items it covered), record events, replace them.
    A partial scan searches by name, so it can also return other items: only covered items count."""
    if mode == "partial":
        auctions = [a for a in auctions if a[1] in covered]
    if mode == "full":
        old = con.execute("SELECT item_id, suffix_id, count, buyout, owner, time_left, seen FROM current_auctions "
                          "WHERE realm=?", (realm,)).fetchall()
        con.execute("DELETE FROM current_auctions WHERE realm=?", (realm,))
    else:
        old = []
        for item in covered:
            old += con.execute("SELECT item_id, suffix_id, count, buyout, owner, time_left, seen FROM current_auctions "
                               "WHERE realm=? AND item_id=?", (realm, item)).fetchall()
            con.execute("DELETE FROM current_auctions WHERE realm=? AND item_id=?", (realm, item))
    baseline = mode == "full" and not old  # first scan of a realm: nothing to compare with
    if not baseline:
        key = lambda item, suffix, count, buyout, owner: (item, suffix, count, buyout, owner or "")
        before = Counter(key(*o[:5]) for o in old)
        now = Counter(key(a[1], a[2], a[3], a[6], a[8]) for a in auctions)
        info = {key(*o[:5]): o for o in old}
        events = []
        for k, n in (now - before).items():
            events += [(realm, k[0], scan_time, "new", k[1], k[2], k[3], k[4] or None)] * n
        for k, n in (before - now).items():
            tl, seen = info[k][5], info[k][6]
            kind = "expired" if scan_time - seen >= TIME_LEFT_MAX.get(tl, 0) else "sold"
            events += [(realm, k[0], scan_time, kind, k[1], k[2], k[3], k[4] or None)] * n
        con.executemany("INSERT INTO auction_events VALUES (?,?,?,?,?,?,?,?)", events)
    con.executemany("INSERT INTO current_auctions VALUES (?,?,?,?,?,?,?,?,?,?)",
                    [(realm, a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], scan_time) for a in auctions])


def write_targets(con, out_dir, limit=500):
    """Items for the next partial scan: listings about to expire (short/medium time left), then the
    items with the most listings, up to `limit` per realm. Written as targets_<realm>.txt."""
    for (realm,) in con.execute("SELECT DISTINCT realm FROM current_auctions").fetchall():
        ids = [r[0] for r in con.execute(
            "SELECT item_id FROM current_auctions WHERE realm=? GROUP BY item_id "
            "ORDER BY MIN(time_left) <= 2 DESC, COUNT(*) DESC, item_id LIMIT ?", (realm, limit))]
        path = os.path.join(out_dir, f"targets_{realm}.txt")
        with open(path + ".tmp", "w") as f:
            f.write("".join(f"{i}\n" for i in ids))
        os.replace(path + ".tmp", path)
        print(f"targets_{realm}.txt: {len(ids)} items")


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
    args = sys.argv[1:]
    if args == ["--backfill"]:
        backfill(db.connect())
        sys.exit(0)
    targets_dir = None
    if args[:1] == ["--targets"]:
        targets_dir, args = args[1], args[2:]
    con = db.connect()
    for path in args:
        r = load_file(con, path)
        print(f"{os.path.basename(path)}: " + (f"scan {r[0]}, {r[1]} auctions" if r else "already loaded"))
    if targets_dir:
        write_targets(con, targets_dir)
        con.commit()
