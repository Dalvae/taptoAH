#!/usr/bin/env python3
"""Export the public dataset as Parquet + meta.json (what the web page reads).

  export.py [out_dir]   (default ~/.local/share/wow-ah/public)

  items.parquet     item_id, name, quality, class, subclass, item_level, required_level,
                    inventory_type, sell_price, stackable, icon   (only items ever seen on the AH)
                    icon = file name in icons/ (<icon>.jpg), NULL if unknown
  history.parquet   realm, item_id, day, market_value, min_buyout, quantity, scans, source
                    one row per item and day; source 'scan' (our scans) wins over 'tsm'
  latest.parquet    realm, item_id, seen, market_value, min_buyout, quantity, auctions,
                    mv_3d, mv_14d (averages of daily market value), source,
                    sellers_7d (distinct known sellers in our scans of the last 7 days), seen_share_7d
                    (share of those scans that listed it): a market, or one or two people asking anything
  auctions.parquet  realm, item_id, suffix_id, count, bid, buyout, unit_buyout, time_left, owner, seen
                    what is on the AH now: for each item, the auctions of the newest scan that covered it
                    (owner = seller, published on purpose)
  events.parquet    realm, item_id, time, kind (new | sold | expired), suffix_id, count, buyout, owner
                    listings that appeared or disappeared between scans, last 90 days
  meta.json         generated_at, per realm: last scan time, auctions, items
All money in copper, times unix seconds UTC, day = unix // 86400.
"""
import json
import os
import sys
import time

import pyarrow as pa
import pyarrow.parquet as pq

import db

HISTORY = """
WITH scan_days AS (
  SELECT s.realm, st.item_id, s.scan_time / 86400 AS day,
         CAST(AVG(st.market_value) AS INTEGER) AS market_value,
         MIN(st.min_buyout) AS min_buyout,
         CAST(AVG(st.quantity) AS INTEGER) AS quantity,
         COUNT(*) AS scans
  FROM item_stats st JOIN scans s USING (scan_id)
  WHERE st.market_value IS NOT NULL
  GROUP BY s.realm, st.item_id, day
)
SELECT realm, item_id, day, market_value, min_buyout, quantity, scans, 'scan' AS source FROM scan_days
UNION ALL
SELECT t.realm, t.item_id, t.day, t.market_value, NULL, NULL, t.scans, 'tsm' FROM tsm_daily t
WHERE NOT EXISTS (SELECT 1 FROM scan_days d WHERE d.realm = t.realm AND d.item_id = t.item_id AND d.day = t.day)
"""

COLUMNS = {
    "history": [("realm", pa.string()), ("item_id", pa.int32()), ("day", pa.int32()),
                ("market_value", pa.int64()), ("min_buyout", pa.int64()), ("quantity", pa.int32()),
                ("scans", pa.int16()), ("source", pa.string())],
    "items": [("item_id", pa.int32()), ("name", pa.string()), ("quality", pa.int8()), ("class", pa.int8()),
              ("subclass", pa.int8()), ("item_level", pa.int16()), ("required_level", pa.int8()),
              ("inventory_type", pa.int8()), ("sell_price", pa.int64()), ("stackable", pa.int32()),
              ("icon", pa.string())],
    "latest": [("realm", pa.string()), ("item_id", pa.int32()), ("seen", pa.int64()),
               ("market_value", pa.int64()), ("min_buyout", pa.int64()), ("quantity", pa.int32()),
               ("auctions", pa.int32()), ("mv_3d", pa.int64()), ("mv_14d", pa.int64()), ("source", pa.string()),
               ("sellers_7d", pa.int16()), ("seen_share_7d", pa.float32())],
    "auctions": [("realm", pa.string()), ("item_id", pa.int32()), ("suffix_id", pa.int32()), ("count", pa.int16()),
                 ("bid", pa.int64()), ("buyout", pa.int64()), ("unit_buyout", pa.int64()),
                 ("time_left", pa.int8()), ("owner", pa.string()), ("seen", pa.int64())],
    "events": [("realm", pa.string()), ("item_id", pa.int32()), ("time", pa.int64()), ("kind", pa.string()),
               ("suffix_id", pa.int32()), ("count", pa.int16()), ("buyout", pa.int64()), ("owner", pa.string())],
}


def write(con, out, name, sql, sort):
    cols = COLUMNS[name]
    rows = con.execute(sql).fetchall()
    table = pa.table({c: pa.array([r[i] for r in rows], t) for i, (c, t) in enumerate(cols)})
    pq.write_table(table.sort_by(sort), os.path.join(out, name + ".parquet.tmp"), compression="zstd")
    os.replace(os.path.join(out, name + ".parquet.tmp"), os.path.join(out, name + ".parquet"))
    print(f"{name}.parquet: {len(rows)} rows")
    return len(rows)


def main(out):
    os.makedirs(out, exist_ok=True)
    con = db.connect()
    con.execute("CREATE TEMP TABLE history AS " + HISTORY)
    write(con, out, "history", "SELECT * FROM history", [("realm", "ascending"), ("item_id", "ascending"), ("day", "ascending")])

    today = int(time.time()) // 86400
    latest_sql = f"""
    WITH newest AS (SELECT realm, MAX(scan_id) AS scan_id FROM scans WHERE mode IN ('full', 'capped') GROUP BY realm),
    own AS (
      SELECT n.realm, st.item_id, s.scan_time AS seen, st.market_value, st.min_buyout, st.quantity, st.auctions
      FROM newest n JOIN scans s USING (scan_id) JOIN item_stats st USING (scan_id)),
    tsm AS (
      SELECT t.realm, t.item_id, t.last_scan AS seen, t.market_value, t.min_buyout, t.quantity, NULL AS auctions
      FROM tsm_latest t WHERE NOT EXISTS (SELECT 1 FROM own o WHERE o.realm = t.realm AND o.item_id = t.item_id)),
    cur AS (SELECT *, 'scan' AS source FROM own UNION ALL SELECT *, 'tsm' FROM tsm)
    SELECT c.realm, c.item_id, c.seen, c.market_value, c.min_buyout, c.quantity, c.auctions,
      (SELECT CAST(AVG(h.market_value) AS INTEGER) FROM history h
        WHERE h.realm = c.realm AND h.item_id = c.item_id AND h.day > {today} - 3),
      (SELECT CAST(AVG(h.market_value) AS INTEGER) FROM history h
        WHERE h.realm = c.realm AND h.item_id = c.item_id AND h.day > {today} - 14),
      c.source, m.sellers, m.share
    FROM cur c LEFT JOIN market m ON m.realm = c.realm AND m.item_id = c.item_id"""
    con.execute("CREATE INDEX temp.h_item ON history (realm, item_id, day)")
    con.execute(f"""CREATE TEMP TABLE market AS
      WITH recent AS (SELECT scan_id, realm FROM scans WHERE mode IN ('full', 'capped') AND scan_time > {int(time.time()) - 7 * 86400}),
      n AS (SELECT realm, COUNT(*) AS scans FROM recent GROUP BY realm)
      SELECT r.realm, a.item_id, COUNT(DISTINCT CASE WHEN a.owner IS NOT NULL AND a.owner <> '?' THEN a.owner END) AS sellers,
             CAST(COUNT(DISTINCT a.scan_id) AS REAL) / n.scans AS share
      FROM recent r JOIN auctions a USING (scan_id) JOIN n USING (realm) GROUP BY r.realm, a.item_id""")
    write(con, out, "latest", latest_sql, [("realm", "ascending"), ("item_id", "ascending")])

    write(con, out, "auctions", """
      SELECT realm, item_id, suffix_id, count, bid, buyout,
             CASE WHEN buyout > 0 THEN buyout / count END, time_left, owner, seen
      FROM current_auctions""",
          [("realm", "ascending"), ("item_id", "ascending"), ("unit_buyout", "ascending")])
    write(con, out, "events", f"""
      SELECT realm, item_id, time, kind, suffix_id, count, buyout, owner FROM auction_events
      WHERE time > {int(time.time()) - 90 * 86400}""",
          [("realm", "ascending"), ("item_id", "ascending"), ("time", "ascending")])

    write(con, out, "items", """
      WITH seen AS (SELECT item_id FROM history UNION SELECT item_id FROM latest_ids)
      SELECT s.item_id, COALESCE(i.name, it.name), COALESCE(i.quality, it.quality), i.class, i.subclass,
             COALESCE(i.item_level, it.level), i.required_level, i.inventory_type, i.sell_price, i.stackable,
             CASE WHEN ci.icon IS NOT NULL THEN 'local:' || ci.icon ELSE NULLIF(COALESCE(NULLIF(it.icon, 'inv_misc_questionmark'), NULLIF(ic.icon, ''), it.icon), '') END
      FROM seen s LEFT JOIN item_info i USING (item_id) LEFT JOIN items it USING (item_id)
      LEFT JOIN item_icons ic USING (item_id)
      LEFT JOIN client_icons ci ON ci.icon = COALESCE(NULLIF(it.icon, 'inv_misc_questionmark'), NULLIF(ic.icon, ''), it.icon)"""
          .replace("latest_ids", "(SELECT item_id FROM tsm_latest UNION SELECT item_id FROM item_stats)"),
          [("item_id", "ascending")])

    realms = {}
    for realm, last, n in con.execute("SELECT realm, MAX(scan_time), COUNT(*) FROM scans GROUP BY realm"):
        realms[realm] = {"last_scan": last, "scans": n}
    for realm, last, n in con.execute("SELECT realm, MAX(last_scan), COUNT(*) FROM tsm_latest GROUP BY realm"):
        realms.setdefault(realm, {}).update({"tsm_last_scan": last, "tsm_items": n})
    meta = {"generated_at": int(time.time()), "realms": realms}
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.local/share/wow-ah/public"))
