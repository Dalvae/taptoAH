/**
 * Lazy DuckDB-WASM singleton. Nothing here is imported eagerly: the duckdb-wasm JS is loaded with a
 * dynamic import the first time a query is needed, and the (large) .wasm comes from jsDelivr unless
 * PUBLIC_DUCKDB_BUNDLE_URL points at a self-hosted copy.
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { DUCKDB_BUNDLE_URL } from './config';

type DuckModule = typeof import('@duckdb/duckdb-wasm');

interface DB {
	duckdb: DuckModule;
	db: AsyncDuckDB;
	conn: AsyncDuckDBConnection;
}

let dbPromise: Promise<DB> | null = null;

async function init(): Promise<DB> {
	const duckdb = await import('@duckdb/duckdb-wasm');
	let bundles;
	if (DUCKDB_BUNDLE_URL) {
		const base = new URL(DUCKDB_BUNDLE_URL + '/', location.href).toString();
		bundles = {
			mvp: {
				mainModule: base + 'duckdb-mvp.wasm',
				mainWorker: base + 'duckdb-browser-mvp.worker.js'
			},
			eh: {
				mainModule: base + 'duckdb-eh.wasm',
				mainWorker: base + 'duckdb-browser-eh.worker.js'
			}
		};
	} else {
		bundles = duckdb.getJsDelivrBundles();
	}
	const bundle = await duckdb.selectBundle(bundles);
	// Cross-origin workers are not allowed directly; bootstrap through a same-origin blob.
	const workerUrl = URL.createObjectURL(
		new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
	);
	const worker = new Worker(workerUrl);
	const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
	await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
	URL.revokeObjectURL(workerUrl);
	const conn = await db.connect();
	return { duckdb, db, conn };
}

export function getDB(): Promise<DB> {
	if (!dbPromise) {
		dbPromise = init().catch((e) => {
			dbPromise = null;
			throw e;
		});
	}
	return dbPromise;
}

const registered = new Map<string, Promise<void>>();

/** Register a remote file under a stable name so SQL can use read_parquet('<name>'). */
export async function registerUrl(name: string, url: string): Promise<void> {
	const key = `${name}|${url}`;
	let p = registered.get(key);
	if (!p) {
		p = getDB().then(({ db, duckdb }) =>
			db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false)
		);
		registered.set(key, p);
	}
	return p;
}

function plain(v: unknown): unknown {
	if (typeof v === 'bigint') return Number(v);
	return v;
}

/** Run a query (optionally parameterised with `?`) and return plain JS rows (BIGINT -> number). */
export async function query<T extends object = Record<string, unknown>>(
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	const { conn } = await getDB();
	let table;
	if (params.length) {
		const stmt = await conn.prepare(sql);
		try {
			table = await stmt.query(...params);
		} finally {
			await stmt.close();
		}
	} else {
		table = await conn.query(sql);
	}
	const fields = table.schema.fields.map((f) => f.name);
	const cols = fields.map((f) => table.getChild(f)!);
	const out: T[] = new Array(table.numRows);
	for (let i = 0; i < table.numRows; i++) {
		const row: Record<string, unknown> = {};
		for (let j = 0; j < fields.length; j++) row[fields[j]] = plain(cols[j].get(i));
		out[i] = row as T;
	}
	return out;
}
