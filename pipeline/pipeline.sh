#!/usr/bin/env bash
# taptoAH data pipeline: collect TSM AuctionDB saved variables (price history) and auction dump files
# (every auction with its seller, see ingest.py), archive them, import them into the price DB, export
# Parquet and upload it to R2. Game folders are only READ; dump files are moved out of their folder.
# Meant to run from a systemd path unit / timer (or by hand).
#
#   ah/pipeline.sh               collect + import + export + upload (upload only with a token)
#   ah/pipeline.sh --force       export + upload even when there is no new TSM data
#
#   TAPTOAH_DATA       raw/, incoming/, scans/, ah.db, public/   (default ~/.local/share/wow-ah)
#   TAPTOAH_WTF_DIRS   game WTF/Account folders to read TSM from, ':'-separated
#                      (e.g. /games/wow/WTF/Account:$HOME/Library/Games/wow/WTF/Account)
#   TAPTOAH_SCANS_DIR  folder where auction dump files (*.tsv) appear (optional)
#   ~/.config/taptoah/cloudflare.env   CLOUDFLARE_ACCOUNT_ID=... and CLOUDFLARE_API_TOKEN=... (optional:
#                      without a token the `wrangler login` session is used, refreshed by cf_token.py)
#   Files pushed from another machine go to $TAPTOAH_DATA/incoming/<host>/<ACCOUNT>/SavedVariables/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA=${TAPTOAH_DATA:-$HOME/.local/share/wow-ah}
BUCKET=taptoah-data
F=TradeSkillMaster_AuctionDB.lua
HOST=$(uname -n | cut -d. -f1 | tr "[:upper:]" "[:lower:]")
export AH_DB="$DATA/ah.db"
SCANS_SRC=${TAPTOAH_SCANS_DIR:-}
mkdir -p "$DATA/incoming" "$DATA/raw" "$DATA/public" "$DATA/scans"
if command -v flock >/dev/null; then   # macOS has no flock; runs are manual there
  exec 9>"$DATA/.pipeline.lock"
  flock -n 9 || { echo "pipeline already running"; exit 0; }
fi
md5of() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }

# 1. Local game clients -> incoming/<host>/<ACCOUNT>/
IFS=: read -r -a wtf_dirs <<<"${TAPTOAH_WTF_DIRS:-}"
for wtf in "${wtf_dirs[@]}"; do
  [ -n "$wtf" ] && [ -d "$wtf" ] || continue
  rsync -a --prune-empty-dirs --include='*/' --include="SavedVariables/$F" --exclude='*' "$wtf/" "$DATA/incoming/$HOST/"
done

# 2. Archive each distinct version once: raw/<mtime>_<host>_<ACCOUNT>_<md5>.lua
new=()
while IFS= read -r f; do
  rel=${f#"$DATA/incoming/"}
  host=${rel%%/*}; rest=${rel#*/}; acct=${rest%%/*}
  sum=$(md5of "$f")
  ls "$DATA/raw/"*"_$sum.lua" >/dev/null 2>&1 && continue
  ts=$(date -r "$f" +%Y%m%d-%H%M%S)
  dest="$DATA/raw/${ts}_${host}_${acct}_$sum.lua"
  cp -p "$f" "$dest"
  new+=("$dest")
done < <(find "$DATA/incoming" -name "$F" -size +1k)

# 3. Auction dump files -> scans/ (moved, so the source folder does not fill up)
if [ -n "$SCANS_SRC" ] && [ -d "$SCANS_SRC" ]; then
  find "$SCANS_SRC" -maxdepth 1 -name '*.tsv' -exec mv -n {} "$DATA/scans/" \;
fi
dumps=()
while IFS= read -r f; do dumps+=("$f"); done < <(find "$DATA/scans" -maxdepth 1 -name '*.tsv' | sort)

if [ ${#new[@]} -eq 0 ] && [ ${#dumps[@]} -eq 0 ] && [ "${1:-}" != "--force" ]; then echo "no new data"; exit 0; fi

# 4. Import (oldest first, so newer values win for the same item and day) and export
if python3 -c 'import pyarrow' 2>/dev/null; then PY=(python3); else PY=(uv run --quiet --with pyarrow python); fi
cd "$HERE"
if [ ${#new[@]} -gt 0 ]; then
  IFS=$'\n' sorted=($(printf '%s\n' "${new[@]}" | sort)); unset IFS
  "${PY[@]}" tsm_import.py "${sorted[@]}"
fi
if [ ${#dumps[@]} -gt 0 ]; then
  "${PY[@]}" ingest.py "${dumps[@]}"
  mkdir -p "$DATA/scans/done"
  for f in "${dumps[@]}"; do gzip -c "$f" > "$DATA/scans/done/$(basename "$f").gz" && rm "$f"; done
fi
"${PY[@]}" export.py "$DATA/public"

# 5. Upload to R2 (the site serves it at /data/<file>)
CF="$HOME/.config/taptoah/cloudflare.env"
if [ ! -f "$CF" ]; then echo "no $CF: skipping upload"; exit 0; fi
set -a; . "$CF"; set +a
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  CLOUDFLARE_API_TOKEN=$(python3 "$HERE/cf_token.py") || { echo "no Cloudflare credentials: skipping upload"; exit 1; }
  export CLOUDFLARE_API_TOKEN
fi
for f in items history latest auctions; do
  npx --yes wrangler r2 object put "$BUCKET/$f.parquet" --file "$DATA/public/$f.parquet" --remote \
    --content-type application/octet-stream --cache-control "public, max-age=300" 2>&1 | grep -E "Upload complete|ERROR"
done
# meta.json last: the site reads it first, so it never points at files that are not there yet
npx --yes wrangler r2 object put "$BUCKET/meta.json" --file "$DATA/public/meta.json" --remote \
  --content-type application/json --cache-control "public, max-age=60" 2>&1 | grep -E "Upload complete|ERROR"
echo "uploaded to R2 $BUCKET"
