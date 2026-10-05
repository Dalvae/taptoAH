"""Price database (SQLite). One file per box: AH_DB (default ~/.local/share/wow-ah/ah.db).

Tables
  scans       one row per full scan loaded from an auction dump file
  auctions    every auction seen in a scan (unit prices are buyout / count)
  item_stats  per scan and item: quantity, min and percentile unit buyouts, market value
  items       item names, quality and icon as seen in scans
  tsm_daily   daily market values imported from TSM AuctionDB saved variables
  tsm_latest  TSM's last value, min buyout and quantity per item
  item_info   WotLK item metadata (class, subclass, ilvl, ...); item_icons: icon per item
All money is in copper; times are unix seconds (UTC); day = unix // 86400 (TSM's day).
"""
import os
import sqlite3

DEFAULT_PATH = os.path.expanduser(os.environ.get("AH_DB", "~/.local/share/wow-ah/ah.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
  scan_id     INTEGER PRIMARY KEY,
  realm       TEXT NOT NULL,         -- 'Frostmourne' (cross-faction auction house)
  scan_time   INTEGER NOT NULL,
  source      TEXT NOT NULL,         -- file name it came from
  total       INTEGER NOT NULL,      -- auctions the server reported
  unread      INTEGER NOT NULL,      -- auctions the scanner could not read
  UNIQUE (realm, scan_time)
);
CREATE TABLE IF NOT EXISTS auctions (
  scan_id     INTEGER NOT NULL REFERENCES scans,
  item_id     INTEGER NOT NULL,
  suffix_id   INTEGER NOT NULL,
  count       INTEGER NOT NULL,
  min_bid     INTEGER NOT NULL,
  bid         INTEGER NOT NULL,
  buyout      INTEGER NOT NULL,      -- 0 = bid only
  time_left   INTEGER NOT NULL,      -- 1 short .. 4 very long
  owner       TEXT
);
CREATE INDEX IF NOT EXISTS auctions_item ON auctions (item_id, scan_id);
CREATE TABLE IF NOT EXISTS item_stats (
  scan_id     INTEGER NOT NULL REFERENCES scans,
  item_id     INTEGER NOT NULL,
  auctions    INTEGER NOT NULL,
  quantity    INTEGER NOT NULL,
  min_buyout  INTEGER,               -- cheapest unit buyout
  p25_buyout  INTEGER,               -- unit buyout at 25 % of the quantity
  median_buyout INTEGER,
  market_value INTEGER,              -- TSM-style: mean of the cheapest 15-30 % of units, outliers dropped
  PRIMARY KEY (scan_id, item_id)
);
CREATE TABLE IF NOT EXISTS items (
  item_id     INTEGER PRIMARY KEY,
  name        TEXT,
  quality     INTEGER,
  level       INTEGER,
  icon        TEXT                   -- texture file name, lower case: 'inv_ore_saronite_01'
);
CREATE TABLE IF NOT EXISTS tsm_daily (
  realm       TEXT NOT NULL,
  item_id     INTEGER NOT NULL,
  day         INTEGER NOT NULL,
  market_value INTEGER NOT NULL,
  scans       INTEGER,               -- how many scans TSM averaged that day (NULL = unknown)
  PRIMARY KEY (realm, item_id, day)
);
CREATE TABLE IF NOT EXISTS item_info (     -- WotLK item_template (AzerothCore), see items_import.py
  item_id INTEGER PRIMARY KEY, class INTEGER, subclass INTEGER, name TEXT, display_id INTEGER,
  quality INTEGER, sell_price INTEGER, inventory_type INTEGER, item_level INTEGER,
  required_level INTEGER, stackable INTEGER
);
CREATE TABLE IF NOT EXISTS item_icons (    -- icon file name per item, see icons.py ('' = none known)
  item_id INTEGER PRIMARY KEY, icon TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tsm_latest (
  realm       TEXT NOT NULL,
  item_id     INTEGER NOT NULL,
  last_scan   INTEGER,               -- unix time TSM last saw the item
  market_value INTEGER,
  min_buyout  INTEGER,
  quantity    INTEGER,
  PRIMARY KEY (realm, item_id)
);
"""


def realm_key(realm, faction=None):
    """Realm key used everywhere: 'Frostmourne'. Frostmourne's auction house is cross-faction, so the
    faction is not part of the key ('Frostmourne_Alliance' from older files maps to 'Frostmourne')."""
    realm = realm.replace(" ", "-")
    for f in ("_Alliance", "_Horde", "_Neutral"):
        if realm.endswith(f):
            realm = realm[: -len(f)]
    return realm


def connect(path=DEFAULT_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(SCHEMA)
    return con
