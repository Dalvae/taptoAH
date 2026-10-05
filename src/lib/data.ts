import { dataFileUrl, DATA_URL } from './config';
import { query, registerUrl } from './db';
import { pctChange } from './format';

export interface RealmMeta {
	last_scan?: number;
	scans?: number;
	tsm_last_scan?: number;
	tsm_items?: number;
}

export interface Meta {
	generated_at: number;
	realms: Record<string, RealmMeta>;
}

export interface Item {
	item_id: number;
	name: string | null;
	quality: number | null;
	class: number | null;
	subclass: number | null;
	item_level: number | null;
	required_level: number | null;
	inventory_type: number | null;
	sell_price: number | null;
	stackable: number | null;
	icon: string | null;
}

export interface Latest {
	seen: number | null;
	market_value: number | null;
	min_buyout: number | null;
	quantity: number | null;
	auctions: number | null;
	mv_3d: number | null;
	mv_14d: number | null;
	source: string | null;
}

export type Row = Item & Latest & { change: number | null; search: string };

export interface HistoryPoint {
	day: number;
	market_value: number | null;
	min_buyout: number | null;
	quantity: number | null;
	scans: number | null;
	source: string;
}

export interface Auction {
	suffix_id: number | null;
	count: number;
	bid: number | null;
	buyout: number | null;
	unit_buyout: number | null;
	time_left: number | null;
	/** Seller name; nullable (TSM-derived rows have none) and the column may be absent. */
	owner: string | null;
}

export function itemName(i: { item_id: number; name: string | null }): string {
	return i.name ?? `Item #${i.item_id}`;
}

export function realmLabel(key: string): { realm: string; faction: string } {
	const idx = key.lastIndexOf('_');
	if (idx < 0) return { realm: key, faction: '' };
	return { realm: key.slice(0, idx).replace(/_/g, ' '), faction: key.slice(idx + 1) };
}

export function realmLastUpdate(m: RealmMeta | undefined): number | null {
	if (!m) return null;
	return Math.max(m.last_scan ?? 0, m.tsm_last_scan ?? 0) || null;
}

let metaPromise: Promise<Meta> | null = null;

export function loadMeta(fetcher: typeof fetch = fetch): Promise<Meta> {
	if (!metaPromise) {
		metaPromise = fetcher(`${DATA_URL}/meta.json`, { cache: 'no-cache' })
			.then((r) => {
				if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`);
				return r.json() as Promise<Meta>;
			})
			.catch((e) => {
				metaPromise = null;
				throw e;
			});
	}
	return metaPromise;
}

/** Version token appended to data URLs so CDN/browser caches turn over when the data is regenerated. */
async function version(): Promise<number | null> {
	try {
		return (await loadMeta()).generated_at ?? null;
	} catch {
		return null;
	}
}

async function file(name: string): Promise<string> {
	const url = dataFileUrl(name, await version());
	await registerUrl(name, url);
	return name;
}

let baseTables: Promise<void> | null = null;

/**
 * items + latest are small (one row per item / per item+realm) so they are materialised once into
 * DuckDB tables. history and auctions stay remote and are queried with filters, letting DuckDB fetch
 * only the parquet row groups it needs via HTTP range requests.
 */
function ensureBaseTables(): Promise<void> {
	if (!baseTables) {
		baseTables = (async () => {
			const items = await file('items.parquet');
			const latest = await file('latest.parquet');
			await query(`CREATE OR REPLACE TABLE items AS SELECT * FROM read_parquet('${items}')`);
			await query(`CREATE OR REPLACE TABLE latest AS SELECT * FROM read_parquet('${latest}')`);
		})().catch((e) => {
			baseTables = null;
			throw e;
		});
	}
	return baseTables;
}

const realmRows = new Map<string, Promise<Row[]>>();

/** All items with a latest price for a realm, joined with item metadata. Cached per realm. */
export function getRealmRows(realm: string): Promise<Row[]> {
	let p = realmRows.get(realm);
	if (!p) {
		p = (async () => {
			await ensureBaseTables();
			const rows = await query<Item & Latest>(
				`SELECT l.item_id, i.name, i.quality, i.class, i.subclass, i.item_level, i.required_level,
				        i.inventory_type, i.sell_price, i.stackable, i.icon,
				        l.seen, l.market_value, l.min_buyout, l.quantity, l.auctions, l.mv_3d, l.mv_14d, l.source
				   FROM latest l LEFT JOIN items i USING (item_id)
				  WHERE l.realm = ?`,
				[realm]
			);
			return rows.map((r) => ({
				...r,
				change: pctChange(r.market_value, r.mv_14d),
				search: (r.name ?? `item #${r.item_id}`).toLowerCase()
			}));
		})().catch((e) => {
			realmRows.delete(realm);
			throw e;
		});
		realmRows.set(realm, p);
	}
	return p;
}

export async function getItem(id: number): Promise<Item | null> {
	await ensureBaseTables();
	const rows = await query<Item>(`SELECT * FROM items WHERE item_id = ?`, [id]);
	return rows[0] ?? null;
}

export async function getLatest(realm: string, id: number): Promise<Latest | null> {
	await ensureBaseTables();
	const rows = await query<Latest>(
		`SELECT seen, market_value, min_buyout, quantity, auctions, mv_3d, mv_14d, source
		   FROM latest WHERE realm = ? AND item_id = ?`,
		[realm, id]
	);
	return rows[0] ?? null;
}

/**
 * Daily history for one item. When both an own scan and a TSM import exist for the same day, the
 * scan wins (it has min_buyout/quantity); otherwise the TSM market value fills the gap.
 */
export async function getHistory(realm: string, id: number): Promise<HistoryPoint[]> {
	const f = await file('history.parquet');
	return query<HistoryPoint>(
		`SELECT day, market_value, min_buyout, quantity, scans, source
		   FROM read_parquet('${f}')
		  WHERE realm = ? AND item_id = ?
		QUALIFY row_number() OVER (PARTITION BY day ORDER BY (source = 'scan') DESC) = 1
		  ORDER BY day`,
		[realm, id]
	);
}

export async function getAuctions(realm: string, id: number): Promise<Auction[]> {
	const f = await file('auctions.parquet');
	// SELECT * keeps this working whether or not the optional "owner" column is present.
	const rows = await query<Partial<Auction>>(
		`SELECT * EXCLUDE (realm, item_id)
		   FROM read_parquet('${f}')
		  WHERE realm = ? AND item_id = ?
		  ORDER BY unit_buyout NULLS LAST, count`,
		[realm, id]
	);
	return rows.map((r) => ({
		suffix_id: r.suffix_id ?? null,
		count: r.count ?? 1,
		bid: r.bid ?? null,
		buyout: r.buyout ?? null,
		unit_buyout: r.unit_buyout ?? null,
		time_left: r.time_left ?? null,
		owner: r.owner ?? null
	}));
}

export interface IndexEntry {
	item_id: number;
	name: string | null;
	quality: number | null;
	icon: string | null;
	key: string;
}

let indexPromise: Promise<IndexEntry[]> | null = null;

/** Compact in-memory name index for instant autocomplete (one query, then pure JS matching). */
export function getItemIndex(): Promise<IndexEntry[]> {
	if (!indexPromise) {
		indexPromise = (async () => {
			await ensureBaseTables();
			const rows = await query<Omit<IndexEntry, 'key'>>(
				`SELECT item_id, name, quality, icon FROM items ORDER BY item_id`
			);
			return rows.map((r) => ({ ...r, key: (r.name ?? `item #${r.item_id}`).toLowerCase() }));
		})().catch((e) => {
			indexPromise = null;
			throw e;
		});
	}
	return indexPromise;
}

export function searchIndex(index: IndexEntry[], q: string, limit = 8): IndexEntry[] {
	const needle = q.trim().toLowerCase();
	if (!needle) return [];
	const asId = /^#?\d+$/.test(needle) ? Number(needle.replace('#', '')) : null;
	const tokens = needle.split(/\s+/);
	const scored: { e: IndexEntry; s: number }[] = [];
	for (const e of index) {
		if (asId != null && e.item_id === asId) {
			scored.push({ e, s: -1 });
			continue;
		}
		if (!tokens.every((t) => e.key.includes(t))) continue;
		const s = (e.key.startsWith(needle) ? 0 : e.key.includes(' ' + needle) ? 1 : 2) * 1000 + e.key.length;
		scored.push({ e, s });
	}
	scored.sort((a, b) => a.s - b.s);
	return scored.slice(0, limit).map((x) => x.e);
}
