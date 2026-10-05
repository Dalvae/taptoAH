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
	/** Unix time of the scan that saw this listing (absent in older files). */
	seen: number | null;
}

export type EventKind = 'new' | 'sold' | 'expired';

/** A listing that appeared ('new') or disappeared ('sold', which also covers cancelled, or 'expired'). */
export interface AuctionEvent {
	time: number;
	kind: EventKind;
	suffix_id: number | null;
	count: number;
	buyout: number | null;
	owner: string | null;
}

/** A current auction that a vendor would pay more for than it costs. */
export type VendorFlip = Auction &
	Pick<Item, 'item_id' | 'name' | 'quality' | 'icon'> & {
		sell_price: number;
		/** What a vendor pays for the whole stack. */
		vendor: number;
		/** Price we would pay: buyout, or the next valid bid for bid flips. */
		cost: number;
		profit: number;
		roi: number;
		search: string;
	};

export interface VendorFlips {
	/** Auctions on the AH for this realm (0 = no auction-level data yet). */
	total: number;
	/** Buyout below vendor value. */
	flips: VendorFlip[];
	/** No profitable buyout, but the next bid is below vendor value (only pays off if the bid wins). */
	bids: VendorFlip[];
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

const fileChecks = new Map<string, Promise<boolean>>();

/** Optional files (events.parquet may not be published yet): one HEAD request, false on 404 or network error. */
function hasFile(name: string): Promise<boolean> {
	let p = fileChecks.get(name);
	if (!p) {
		p = version()
			.then((v) => fetch(dataFileUrl(name, v), { method: 'HEAD' }))
			.then(
				(r) => r.ok,
				() => false
			);
		fileChecks.set(name, p);
	}
	return p;
}

function memo<T>(cache: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
	let p = cache.get(key);
	if (!p) {
		p = fn().catch((e) => {
			cache.delete(key);
			throw e;
		});
		cache.set(key, p);
	}
	return p;
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
		owner: r.owner ?? null,
		seen: r.seen ?? null
	}));
}

/** Minimum next bid: the server wants at least 5% (min 1c) over the current bid. */
export function nextBid(bid: number): number {
	return bid + Math.max(1, Math.floor(bid * 0.05));
}

const vendorCache = new Map<string, Promise<VendorFlips>>();

/** Every current auction whose buyout (or next bid) is below what a vendor pays for the stack. Cached per realm. */
export function getVendorFlips(realm: string): Promise<VendorFlips> {
	return memo(vendorCache, realm, async () => {
		await ensureBaseTables();
		if (!(await hasFile('auctions.parquet'))) return { total: 0, flips: [], bids: [] };
		const f = await file('auctions.parquet');
		const [{ n }] = await query<{ n: number }>(
			`SELECT count(*) AS n FROM read_parquet('${f}') WHERE realm = ?`,
			[realm]
		);
		if (!n) return { total: 0, flips: [], bids: [] };
		// a.* keeps this working with older files that lack "owner" / "seen".
		const rows = await query<Partial<Auction> & Pick<Item, 'item_id' | 'name' | 'quality' | 'icon'> & { sell_price: number }>(
			`SELECT a.* EXCLUDE (realm), i.name, i.quality, i.icon, i.sell_price
			   FROM read_parquet('${f}') a JOIN items i USING (item_id)
			  WHERE a.realm = ? AND i.sell_price > 0
			    AND ((a.buyout > 0 AND a.buyout < i.sell_price * a.count)
			      OR (a.bid > 0 AND a.bid < i.sell_price * a.count))`,
			[realm]
		);
		const flips: VendorFlip[] = [];
		const bids: VendorFlip[] = [];
		for (const r of rows) {
			const count = r.count ?? 1;
			const vendor = r.sell_price * count;
			const buyout = r.buyout ?? 0;
			const isFlip = buyout > 0 && buyout < vendor;
			const cost = isFlip ? buyout : r.bid ? nextBid(r.bid) : 0;
			if (!cost || cost >= vendor) continue;
			const flip: VendorFlip = {
				item_id: r.item_id,
				name: r.name,
				quality: r.quality,
				icon: r.icon,
				sell_price: r.sell_price,
				suffix_id: r.suffix_id ?? null,
				count,
				bid: r.bid ?? null,
				buyout: r.buyout ?? null,
				unit_buyout: r.unit_buyout ?? null,
				time_left: r.time_left ?? null,
				owner: r.owner ?? null,
				seen: r.seen ?? null,
				vendor,
				cost,
				profit: vendor - cost,
				roi: ((vendor - cost) / cost) * 100,
				search: (r.name ?? `item #${r.item_id}`).toLowerCase()
			};
			(isFlip ? flips : bids).push(flip);
		}
		return { total: n, flips, bids };
	});
}

/** Appear/disappear events for one item, newest first; null when events.parquet is not published. */
export async function getEvents(realm: string, id: number): Promise<AuctionEvent[] | null> {
	if (!(await hasFile('events.parquet'))) return null;
	const f = await file('events.parquet');
	return query<AuctionEvent>(
		`SELECT time, kind, suffix_id, count, buyout, owner
		   FROM read_parquet('${f}')
		  WHERE realm = ? AND item_id = ?
		  ORDER BY time DESC`,
		[realm, id]
	);
}

const soldCache = new Map<string, Promise<Map<number, number>>>();

/** Units sold (or cancelled) per item in the last 24 hours. Empty when there are no events. Cached per realm. */
export function getSold24h(realm: string): Promise<Map<number, number>> {
	return memo(soldCache, realm, async () => {
		const out = new Map<number, number>();
		if (!(await hasFile('events.parquet'))) return out;
		const f = await file('events.parquet');
		const since = Math.floor(Date.now() / 1000) - 86400;
		const rows = await query<{ item_id: number; units: number }>(
			`SELECT item_id, CAST(sum(count) AS INTEGER) AS units
			   FROM read_parquet('${f}')
			  WHERE realm = ? AND kind = 'sold' AND time > ?
			  GROUP BY item_id`,
			[realm, since]
		);
		for (const r of rows) out.set(r.item_id, r.units);
		return out;
	});
}

// ---- sellers --------------------------------------------------------------------------------------

/** One seller's footprint on a realm: live auctions (latest scan) plus the last 7 days of events. */
export interface SellerStats {
	owner: string;
	/** Live auctions / units / sum of buyouts / distinct items. */
	listings: number;
	units: number;
	value: number;
	items: number;
	/** % of all live auctions on the realm. */
	share: number | null;
	/** Item classes by number of live auctions, most first (-1 = unknown). */
	classes: number[];
	sold7d: number;
	soldValue7d: number;
	expired7d: number;
	new7d: number;
	/** sold / (sold + expired) over 7 days, %. */
	sellThrough: number | null;
	/** Median unit buyout / market value over their live auctions (1 = at market). */
	priceRatio: number | null;
	/** Newest scan that saw one of their auctions, or their newest event (90 days). */
	lastSeen: number | null;
	search: string;
}

export interface SellerDay {
	day: number;
	/** Distinct sellers with any event that day. */
	sellers: number;
	listed: number;
	sold: number;
	expired: number;
}

export interface SellerBoard {
	/** All live auctions on the realm, including ones without a known seller. */
	totalListings: number;
	totalValue: number;
	sellers: SellerStats[];
	/** Last 30 days of events, by day. */
	days: SellerDay[];
	hasEvents: boolean;
}

/** Column names of a remote parquet file (reads only the footer). */
async function columns(f: string): Promise<Set<string>> {
	const rows = await query<{ column_name: string }>(`DESCRIBE SELECT * FROM read_parquet('${f}')`);
	return new Set(rows.map((r) => r.column_name));
}

const sellerCache = new Map<string, Promise<SellerBoard>>();

/**
 * Seller leaderboard for a realm. Three realm-wide queries: live auctions grouped by owner, events
 * grouped by owner, events grouped by day. Cached per realm.
 */
export function getSellers(realm: string): Promise<SellerBoard> {
	return memo(sellerCache, realm, async () => {
		await ensureBaseTables();
		const board: SellerBoard = { totalListings: 0, totalValue: 0, sellers: [], days: [], hasEvents: false };
		const byOwner = new Map<string, SellerStats>();
		const seller = (owner: string): SellerStats => {
			let s = byOwner.get(owner);
			if (!s) {
				s = {
					owner,
					listings: 0,
					units: 0,
					value: 0,
					items: 0,
					share: null,
					classes: [],
					sold7d: 0,
					soldValue7d: 0,
					expired7d: 0,
					new7d: 0,
					sellThrough: null,
					priceRatio: null,
					lastSeen: null,
					search: owner.toLowerCase()
				};
				byOwner.set(owner, s);
			}
			return s;
		};

		if (await hasFile('auctions.parquet')) {
			const f = await file('auctions.parquet');
			const cols = await columns(f);
			const owner = cols.has('owner') ? 'a.owner' : 'NULL::VARCHAR';
			const seen = cols.has('seen') ? 'a.seen' : 'NULL::BIGINT';
			const rows = await query<{
				owner: string | null;
				listings: number;
				units: number;
				value: number;
				items: number;
				last_seen: number | null;
				ratio: number | null;
				classes: string | null;
			}>(
				`WITH a AS (
				   SELECT ${owner} AS owner, a.item_id, a.count, a.buyout, ${seen} AS seen, i.class,
				          CASE WHEN a.unit_buyout > 0 AND l.market_value > 0 THEN a.unit_buyout / l.market_value END AS ratio
				     FROM read_parquet('${f}') a
				     LEFT JOIN items i USING (item_id)
				     LEFT JOIN latest l ON l.realm = a.realm AND l.item_id = a.item_id
				    WHERE a.realm = ?
				 ), c AS (
				   SELECT owner, coalesce(class, -1) AS class, count(*) AS n FROM a GROUP BY ALL
				 ), top AS (
				   SELECT owner, string_agg(class::VARCHAR, ',' ORDER BY n DESC, class) AS classes FROM c GROUP BY owner
				 )
				 SELECT a.owner, count(*)::INTEGER AS listings, sum(a.count)::DOUBLE AS units,
				        coalesce(sum(a.buyout), 0)::DOUBLE AS value, count(DISTINCT a.item_id)::INTEGER AS items,
				        max(a.seen) AS last_seen, median(a.ratio) AS ratio, any_value(top.classes) AS classes
				   FROM a LEFT JOIN top ON top.owner IS NOT DISTINCT FROM a.owner
				  GROUP BY a.owner`,
				[realm]
			);
			for (const r of rows) {
				board.totalListings += r.listings;
				board.totalValue += r.value;
				if (!r.owner) continue;
				Object.assign(seller(r.owner), {
					listings: r.listings,
					units: r.units,
					value: r.value,
					items: r.items,
					classes: (r.classes ?? '').split(',').filter(Boolean).map(Number),
					priceRatio: r.ratio,
					lastSeen: r.last_seen
				});
			}
		}

		if (await hasFile('events.parquet')) {
			board.hasEvents = true;
			const f = await file('events.parquet');
			const now = Math.floor(Date.now() / 1000);
			const since7 = now - 7 * 86400;
			const rows = await query<{
				owner: string;
				sold: number;
				sold_value: number;
				expired: number;
				listed: number;
				last_event: number | null;
			}>(
				`SELECT owner,
				        count(*) FILTER (WHERE kind = 'sold' AND time > ${since7})::INTEGER AS sold,
				        coalesce(sum(buyout) FILTER (WHERE kind = 'sold' AND time > ${since7}), 0)::DOUBLE AS sold_value,
				        count(*) FILTER (WHERE kind = 'expired' AND time > ${since7})::INTEGER AS expired,
				        count(*) FILTER (WHERE kind = 'new' AND time > ${since7})::INTEGER AS listed,
				        max(time) AS last_event
				   FROM read_parquet('${f}')
				  WHERE realm = ? AND owner IS NOT NULL
				  GROUP BY owner`,
				[realm]
			);
			for (const r of rows) {
				const s = seller(r.owner);
				s.sold7d = r.sold;
				s.soldValue7d = r.sold_value;
				s.expired7d = r.expired;
				s.new7d = r.listed;
				const done = r.sold + r.expired;
				s.sellThrough = done ? (r.sold / done) * 100 : null;
				s.lastSeen = Math.max(s.lastSeen ?? 0, r.last_event ?? 0) || null;
			}
			board.days = await query<SellerDay>(
				`SELECT (time // 86400)::INTEGER AS day,
				        count(DISTINCT owner)::INTEGER AS sellers,
				        count(*) FILTER (WHERE kind = 'new')::INTEGER AS listed,
				        count(*) FILTER (WHERE kind = 'sold')::INTEGER AS sold,
				        count(*) FILTER (WHERE kind = 'expired')::INTEGER AS expired
				   FROM read_parquet('${f}')
				  WHERE realm = ? AND time > ${now - 30 * 86400}
				  GROUP BY ALL ORDER BY day`,
				[realm]
			);
		}

		for (const s of byOwner.values()) {
			s.share = board.totalListings ? (s.listings / board.totalListings) * 100 : null;
		}
		board.sellers = [...byOwner.values()].sort((a, b) => b.listings - a.listings || b.sold7d - a.sold7d);
		return board;
	});
}

/** A seller's live auction, with item metadata, market value and the item's realm-wide totals. */
export type SellerAuction = Auction &
	Pick<Item, 'item_id' | 'name' | 'quality' | 'icon' | 'class'> & {
		market_value: number | null;
		/** All live auctions / units / sellers of this item on the realm. */
		item_listings: number;
		item_units: number;
		item_sellers: number;
	};

/** Every live auction of one seller (one query). Empty when there is no auction-level data. */
export async function getSellerAuctions(realm: string, owner: string): Promise<SellerAuction[]> {
	if (!(await hasFile('auctions.parquet'))) return [];
	await ensureBaseTables();
	const f = await file('auctions.parquet');
	if (!(await columns(f)).has('owner')) return [];
	const rows = await query<Partial<SellerAuction> & { item_id: number }>(
		`WITH a AS (SELECT * FROM read_parquet('${f}') WHERE realm = ?),
		      mine AS (SELECT * FROM a WHERE owner = ?),
		      tot AS (
		        SELECT item_id, count(*)::INTEGER AS item_listings, sum(count)::INTEGER AS item_units,
		               count(DISTINCT owner)::INTEGER AS item_sellers
		          FROM a WHERE item_id IN (SELECT item_id FROM mine) GROUP BY item_id
		      )
		 SELECT m.* EXCLUDE (realm), i.name, i.quality, i.icon, i.class, l.market_value,
		        tot.item_listings, tot.item_units, tot.item_sellers
		   FROM mine m
		   LEFT JOIN items i USING (item_id)
		   LEFT JOIN (SELECT item_id, market_value FROM latest WHERE realm = ?) l USING (item_id)
		   LEFT JOIN tot USING (item_id)
		  ORDER BY m.item_id, m.unit_buyout NULLS LAST`,
		[realm, owner, realm]
	);
	return rows.map((r) => ({
		item_id: r.item_id,
		name: r.name ?? null,
		quality: r.quality ?? null,
		icon: r.icon ?? null,
		class: r.class ?? null,
		suffix_id: r.suffix_id ?? null,
		count: r.count ?? 1,
		bid: r.bid ?? null,
		buyout: r.buyout ?? null,
		unit_buyout: r.unit_buyout ?? null,
		time_left: r.time_left ?? null,
		owner: r.owner ?? null,
		seen: r.seen ?? null,
		market_value: r.market_value ?? null,
		item_listings: r.item_listings ?? 0,
		item_units: r.item_units ?? 0,
		item_sellers: r.item_sellers ?? 0
	}));
}

export type SellerEvent = Omit<AuctionEvent, 'owner'> & Pick<Item, 'item_id' | 'name' | 'quality' | 'icon'>;

export interface SellerActivity {
	/** new / sold / expired counts per day over the 90-day window. */
	days: SellerDay[];
	/** Newest events first. */
	recent: SellerEvent[];
}

/** One seller's events: daily counts plus the newest 100. Null when events.parquet is not published. */
export async function getSellerActivity(realm: string, owner: string): Promise<SellerActivity | null> {
	if (!(await hasFile('events.parquet'))) return null;
	await ensureBaseTables();
	const f = await file('events.parquet');
	const days = await query<SellerDay>(
		`SELECT (time // 86400)::INTEGER AS day, 1 AS sellers,
		        count(*) FILTER (WHERE kind = 'new')::INTEGER AS listed,
		        count(*) FILTER (WHERE kind = 'sold')::INTEGER AS sold,
		        count(*) FILTER (WHERE kind = 'expired')::INTEGER AS expired
		   FROM read_parquet('${f}')
		  WHERE realm = ? AND owner = ?
		  GROUP BY ALL ORDER BY day`,
		[realm, owner]
	);
	const recent = await query<SellerEvent>(
		`SELECT e.item_id, e.time, e.kind, e.suffix_id, e.count, e.buyout, i.name, i.quality, i.icon
		   FROM read_parquet('${f}') e LEFT JOIN items i USING (item_id)
		  WHERE e.realm = ? AND e.owner = ?
		  ORDER BY e.time DESC LIMIT 100`,
		[realm, owner]
	);
	return { days, recent };
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
