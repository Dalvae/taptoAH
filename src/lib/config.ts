import { PUBLIC_DATA_URL, PUBLIC_DUCKDB_BUNDLE_URL, PUBLIC_ICON_URL } from '$app/env/public';

/** Base URL for data files, without trailing slash (e.g. "/data" or "https://data.example.com"). */
export const DATA_URL: string = PUBLIC_DATA_URL;
/** Optional self-hosted duckdb-wasm dist directory; empty means jsDelivr. */
export const DUCKDB_BUNDLE_URL: string = PUBLIC_DUCKDB_BUNDLE_URL;

/** Absolute URL for a data file (DuckDB's HTTP reader needs absolute URLs). */
export function dataFileUrl(file: string, version?: number | string | null): string {
	const u = new URL(`${DATA_URL}/${file}`, location.href);
	if (version != null) u.searchParams.set('v', String(version));
	return u.toString();
}

/** Base URL for item icons (no trailing slash). */
export const ICON_URL: string = PUBLIC_ICON_URL;

/**
 * Icon image URL. `small` picks the 36px variant when the base follows the Wowhead CDN layout
 * (.../icons/large -> .../icons/medium); other bases are used as-is.
 */
export function iconUrl(icon: string, small = false): string {
	const base = small && ICON_URL.endsWith('/large') ? ICON_URL.slice(0, -'large'.length) + 'medium' : ICON_URL;
	return `${base}/${encodeURIComponent(icon.toLowerCase())}.jpg`;
}
