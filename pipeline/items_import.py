#!/usr/bin/env python3
"""Load WotLK item metadata into item_info from AzerothCore's item_template.sql (MySQL dump).

  items_import.py [item_template.sql]
  (default ~/.local/share/wow-ah/item_template.sql, from
   github.com/azerothcore/azerothcore-wotlk/raw/master/data/sql/base/db_world/item_template.sql)
"""
import os
import re
import sys

import db

KEEP = ["entry", "class", "subclass", "name", "displayid", "Quality", "SellPrice", "InventoryType",
        "ItemLevel", "RequiredLevel", "stackable"]



def tuples(values):
    """Yield the field lists of "(a,'b',c),(...)" with MySQL string escapes."""
    i, n = 0, len(values)
    while i < n:
        if values[i] != "(":
            i += 1
            continue
        i += 1
        row, cur, in_str = [], [], False
        while i < n:
            c = values[i]
            if in_str:
                if c == "\\":
                    cur.append(values[i + 1])
                    i += 2
                    continue
                if c == "'":
                    in_str = False
                else:
                    cur.append(c)
            elif c == "'":
                in_str = True
            elif c == ",":
                row.append("".join(cur))
                cur = []
            elif c == ")":
                row.append("".join(cur))
                break
            else:
                cur.append(c)
            i += 1
        yield row
        i += 1


def main(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    create = re.search(r"CREATE TABLE `item_template` \((.*?)\n\)", text, re.S).group(1)
    cols = re.findall(r"^\s*`(\w+)`", create, re.M)
    idx = [cols.index(c) for c in KEEP]
    con = db.connect()
    rows = []
    for m in re.finditer(r"INSERT INTO `item_template` VALUES\s*(.*?);\n", text, re.S):
        for t in tuples(m.group(1)):
            if len(t) != len(cols):
                continue
            rows.append([t[i] if c == "name" else int(float(t[i] or 0)) for c, i in zip(KEEP, idx)])
    con.executemany("INSERT OR REPLACE INTO item_info VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    print(f"{len(rows)} items")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.local/share/wow-ah/item_template.sql"))
