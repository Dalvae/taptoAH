# taptoAH

Auction house price history for **World of Warcraft 3.3.5a (Wrath of the Lich King)** private
servers. It works like TSM, Nexus Hub or Undermine Exchange, but for WotLK realms. The first
realm is **Frostmourne (Alliance)**. More realms and factions show up automatically when they
are added to `meta.json`.

taptoAH is a sibling of [TaptoLogs](https://github.com/Dalvae/taptologs) and uses the same
mascot and visual identity.

- **Browse** (`/`): every item with a price on the selected realm. It has a category tree
  (class › subclass), text search, quality, item level, required level and price filters,
  an "only on AH now" toggle, sortable columns and pagination. All filter and sort state is
  in the URL, so you can share a link to any view.
- **Item** (`/item/<id>`): header, stat tiles, a price/quantity chart (7d/30d/90d/all, with
  optional outlier clipping), a weekday heatmap, the current listings with a price
  histogram, and a link to Wowhead.
- **Movers & Deals** (`/movers`): biggest risers and fallers (market value vs the 14-day
  average, with minimum quantity and minimum value thresholds), listings under X% of market
  value, and listings below vendor price.
- **Header**: instant item autocomplete and a realm/faction picker that shows data
  freshness. The chosen realm is kept in `?realm=` and in localStorage.

There is no backend database. The browser loads **DuckDB-WASM** and queries Parquet files
over HTTP Range requests. The only server code is a small Cloudflare Pages Function that
streams those files from R2 on the same origin.

## Stack

- SvelteKit 3 / Svelte 5 (runes), TypeScript, Tailwind CSS 4, `@lucide/svelte` icons
- `@sveltejs/adapter-cloudflare` (Cloudflare Pages). Pages run client-side only
  (`ssr = false`). `/` and `/movers` are prerendered shells, and `/item/<id>` is rendered
  by the worker as an SPA shell.
- `@duckdb/duckdb-wasm`, loaded lazily with a dynamic import on first use. The `.wasm`
  comes from jsDelivr because each build (33–39 MB) is over the 25 MiB per-file limit of
  Cloudflare Pages. To self-host it, set `PUBLIC_DUCKDB_BUNDLE_URL`.
- **Charts: uPlot.** It is about 45 KB and very fast for time series. It handles a dual
  axis (price lines plus quantity bars) natively, and it makes it easy to control the
  y-range ourselves for outlier clipping. ECharts is around 1 MB, and layerchart (used
  by TaptoLogs) needs much more code for a dual axis with bars.

## Run locally

```sh
pnpm install
pnpm data:pull      # downloads meta.json + *.parquet into ./data (gitignored)
pnpm dev            # http://localhost:5173
pnpm check          # svelte-check / TypeScript
pnpm build          # -> .svelte-kit/cloudflare
pnpm preview:cf     # build + `wrangler pages dev` (runs the real /data R2 endpoint with a local R2)
```

In `pnpm dev` / `vite preview`, a small Vite middleware (see `vite.config.ts`) serves
`./data` at `/data`, with Range support. Use `LOCAL_DATA_DIR=<dir>` to serve another
directory, or `LOCAL_DATA_DIR=off` to skip it.

To test the production endpoint locally, load the files into wrangler's local R2:

```sh
for f in meta.json items.parquet latest.parquet history.parquet auctions.parquet; do
  npx wrangler r2 object put taptoah-data/$f --file data/$f --local --persist-to .wrangler/state
done
pnpm build && npx wrangler pages dev --persist-to .wrangler/state
```

### Environment variables (all optional, all public)

| Variable | Default | Purpose |
|---|---|---|
| `PUBLIC_DATA_URL` | `/data` | Base URL for `meta.json` and `*.parquet`. The default is the same-origin R2 proxy. It can also point at any CORS-enabled HTTP origin, e.g. a public R2 domain. |
| `PUBLIC_ICON_URL` | `https://wow.zamimg.com/images/wow/icons/large` | Icons are loaded from `<base>/<icon>.jpg`. Tables use `/medium` (36px) when the base ends in `/large`. Only the image CDN is used, not the Wowhead scripts. Missing or broken icons show a placeholder. |
| `PUBLIC_DUCKDB_BUNDLE_URL` | (jsDelivr) | A directory that hosts the `@duckdb/duckdb-wasm/dist` files. |

The variables are declared in `src/env.ts` (SvelteKit 3 `defineEnvVars`) and inlined at
build time. See `.env.example`.

## Data contract

All money values are in **copper**. All times are unix seconds (UTC), and `day = unix // 86400`.
Realm keys look like `Frostmourne_Alliance` (realm and faction joined by the last `_`).

| File | Columns | Notes |
|---|---|---|
| `meta.json` | `{generated_at, realms: {"<Realm_Faction>": {last_scan?, scans?, tsm_last_scan?, tsm_items?}}}` | Lists the realms and how fresh their data is. `generated_at` is used as a cache-buster (`?v=`). |
| `items.parquet` | `item_id, name, quality, class, subclass, item_level, required_level, inventory_type, sell_price, stackable, icon` | `name`/`class` can be NULL for server-custom items (shown as "Item #id"). `icon` can be NULL. |
| `latest.parquet` | `realm, item_id, seen, market_value, min_buyout, quantity, auctions, mv_3d, mv_14d, source` | One row per realm and item. |
| `history.parquet` | `realm, item_id, day, market_value, min_buyout, quantity, scans, source` | `source='tsm'` is the imported TSM daily market value (no min_buyout/quantity). `'scan'` is our own scans and wins when both exist for the same day. |
| `auctions.parquet` | `realm, item_id, suffix_id, count, bid, buyout, unit_buyout, time_left, owner?` | Every auction in the newest scan. It can be empty. `time_left` is 1 short, 2 medium, 3 long, 4 very long. `owner` is nullable and optional; the Seller column only appears when names exist. |

**Query strategy.** `items` and `latest` are small, so they are loaded once into in-memory
DuckDB tables. The Browse and Movers pages filter and sort the joined rows in JS, which is
instant for tens of thousands of rows. `history` and `auctions` are never loaded whole.
They are queried with `WHERE realm = ? AND item_id = ?` straight from the remote file, so
DuckDB only fetches the footer and the row groups it needs. To keep that fast as history
grows to millions of rows, **write `history.parquet` (and `auctions.parquet`) sorted by
`realm, item_id, day`** with moderate row groups (e.g. `ROW_GROUP_SIZE 100000`), so
min/max statistics prune almost every row group:

```sql
COPY (SELECT * FROM history ORDER BY realm, item_id, day)
  TO 'history.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000);
```

## Deploy (Cloudflare Pages + R2)

`wrangler.toml` sets up the Pages project `taptoah` (output `.svelte-kit/cloudflare`) with
an R2 binding `DATA` → bucket `taptoah-data`. `src/routes/data/[...path]/+server.ts`
serves objects from that bucket at `/data/<key>`. It supports `GET`/`HEAD`, single
`Range` requests (206 + `Content-Range`), `416`, `If-None-Match` → 304, and sets `ETag`,
`Accept-Ranges`, `Content-Length` and `Cache-Control: public, max-age=300` (60 for
`meta.json`). Because the data is same-origin, no CORS setup is needed.

```sh
# upload data (the pipeline that produces the files does this)
npx wrangler r2 object put taptoah-data/history.parquet --file history.parquet --remote
# build + deploy
pnpm build
npx wrangler pages deploy        # reads wrangler.toml (project "taptoah")
```

In a Git-connected Pages project, use build command `pnpm build`, output directory
`.svelte-kit/cloudflare`, and add the R2 binding `DATA` in the project settings
(or rely on `wrangler.toml`).

### Serving data from another origin (optional)

If `PUBLIC_DATA_URL` points to a different origin (e.g. a public R2 custom domain), that
bucket needs a CORS policy that allows DuckDB's range requests:

```json
[
  {
    "AllowedOrigins": ["https://taptoah.pages.dev", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "If-None-Match"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

## Layout

```
src/
  env.ts                         public env vars (PUBLIC_DATA_URL, PUBLIC_ICON_URL, ...)
  lib/
    db.ts                        lazy DuckDB-WASM singleton + query helper (BIGINT -> number)
    data.ts                      meta, realm rows, item, history, auctions, name index
    wow.ts                       qualities/colors, ItemClass/ItemSubClass names (3.3.5a), time-left
    format.ts                    money (g/s/c), %, relative time
    realm.svelte.ts              realm selection (URL + localStorage)
    components/                  Logo, HeaderSearch, RealmPicker, PriceChart, Money, ItemIcon, ...
  routes/
    +layout.ts / +layout.svelte  ssr=false, header/footer, loads meta.json
    +page.svelte                 Browse
    item/[id]/                   Item detail
    movers/                      Movers & Deals
    data/[...path]/+server.ts    R2 proxy with Range support
scripts/pull-data.mjs            pnpm data:pull
```

## Notes

- Item quality colors follow the WoW standard (Poor #9d9d9d … Legendary #ff8000,
  Artifact/Heirloom #e6cc80).
- No Wowhead tooltips or scripts are loaded. The Wowhead link opens
  `https://www.wowhead.com/wotlk/item=<id>`.
- The UX takes ideas (sidebar category tree, item page layout, outlier-clipped charts) from
  Undermine Exchange ([erorus/shatari-front](https://github.com/erorus/shatari-front),
  Apache-2.0). No code from it is included.

## License

MIT (see `LICENSE`). World of Warcraft is a trademark of Blizzard Entertainment. taptoAH is
not affiliated with or endorsed by Blizzard. Prices come from in-game scans and TSM exports.
