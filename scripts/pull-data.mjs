#!/usr/bin/env node
// Download the published data files into ./data for local development (served at /data by vite.config.ts).
// Usage: pnpm data:pull <baseUrl>   (or DATA_SOURCE_URL=...; default: the production site's /data)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCES = [
	'https://taptoah.pages.dev/data',
	'https://pub-1f898315950f45d18e203622b4ddfb0f.r2.dev'
];
const candidates = [process.argv[2] || process.env.DATA_SOURCE_URL].filter(Boolean);
let base = '';
for (const c of candidates.length ? candidates : DEFAULT_SOURCES) {
	const u = c.replace(/\/+$/, '');
	const ok = await fetch(`${u}/meta.json`, { method: 'HEAD' }).then((r) => r.ok, () => false);
	if (ok) {
		base = u;
		break;
	}
}
if (!base) {
	console.error('No reachable data source. Pass one: pnpm data:pull https://example.com/data');
	process.exit(1);
}
console.log(`<- ${base}`);
const files = ['meta.json', 'items.parquet', 'latest.parquet', 'history.parquet', 'auctions.parquet', 'events.parquet'];
// Not published yet everywhere; the site treats a missing file as "no data".
const optional = new Set(['events.parquet']);
const out = join(root, 'data');
mkdirSync(out, { recursive: true });
for (const f of files) {
	const res = await fetch(`${base}/${f}`);
	if (!res.ok) {
		console.error(`${f}: HTTP ${res.status}${optional.has(f) ? ' (optional, skipped)' : ''}`);
		if (optional.has(f)) rmSync(join(out, f), { force: true });
		else process.exitCode = 1;
		continue;
	}
	const buf = Buffer.from(await res.arrayBuffer());
	writeFileSync(join(out, f), buf);
	console.log(`${f.padEnd(18)} ${(buf.length / 1024).toFixed(1).padStart(9)} KiB`);
}
console.log(`-> ${out}`);
