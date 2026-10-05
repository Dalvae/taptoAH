import { env } from 'cloudflare:workers';
import type { RequestHandler } from './$types';

/**
 * Same-origin proxy for the R2 data bucket: GET/HEAD /data/<key>, with HTTP Range support so
 * DuckDB-WASM can read Parquet footers and row groups without downloading whole files.
 */
export const prerender = false;

const TYPES: Record<string, string> = {
	parquet: 'application/vnd.apache.parquet',
	json: 'application/json; charset=utf-8',
	jpg: 'image/jpeg',
	png: 'image/png',
	csv: 'text/csv; charset=utf-8'
};

function contentType(key: string): string {
	return TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

function baseHeaders(key: string, obj: { httpEtag: string; uploaded: Date }): Headers {
	const h = new Headers();
	h.set('content-type', contentType(key));
	h.set('etag', obj.httpEtag);
	h.set('last-modified', obj.uploaded.toUTCString());
	h.set('accept-ranges', 'bytes');
	h.set('cache-control', key === 'meta.json' ? 'public, max-age=60' : 'public, max-age=300');
	h.set('access-control-allow-origin', '*');
	h.set('access-control-expose-headers', 'Content-Length, Content-Range, ETag, Accept-Ranges');
	return h;
}

const handler: RequestHandler = async ({ request, params }) => {
	const bucket = env.DATA;
	if (!bucket) return new Response('R2 binding "DATA" is not configured', { status: 503 });

	const key = params.path;
	if (!key || key.split('/').some((seg) => seg === '..' || seg === '')) {
		return new Response('Not found', { status: 404 });
	}

	if (request.method === 'HEAD') {
		const head = await bucket.head(key);
		if (!head) return new Response(null, { status: 404 });
		const h = baseHeaders(key, head);
		h.set('content-length', String(head.size));
		return new Response(null, { status: 200, headers: h });
	}

	// Conditional GET: answer 304 from object metadata without streaming the body.
	const inm = request.headers.get('if-none-match');
	if (inm) {
		const head = await bucket.head(key);
		if (!head) return new Response('Not found', { status: 404 });
		if (inm.split(',').some((t) => t.trim().replace(/^W\//, '') === head.httpEtag)) {
			return new Response(null, { status: 304, headers: baseHeaders(key, head) });
		}
	}

	const rangeHeader = request.headers.get('range');
	let obj;
	try {
		obj = await bucket.get(key, rangeHeader ? { range: request.headers as never } : undefined);
	} catch {
		obj = undefined; // R2 rejects malformed / unsatisfiable ranges
	}
	if (obj === undefined || (rangeHeader && obj && !('body' in obj))) {
		const head = await bucket.head(key);
		if (!head) return new Response('Not found', { status: 404 });
		return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
	}
	if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });

	const size = obj.size;
	const requestedStart = rangeHeader?.match(/^bytes=(\d+)-/)?.[1];
	if (requestedStart != null && Number(requestedStart) >= size) {
		return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
	}

	const h = baseHeaders(key, obj);
	let status = 200;
	let start = 0;
	let end = size - 1;
	const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
	if (rangeHeader && r) {
		if (r.suffix != null) {
			start = Math.max(0, size - r.suffix);
		} else {
			start = r.offset ?? 0;
			if (r.length != null) end = Math.min(size - 1, start + r.length - 1);
		}
		if (start >= size || end < start) {
			return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
		}
		status = 206;
		h.set('content-range', `bytes ${start}-${end}/${size}`);
	}
	h.set('content-length', String(end - start + 1));
	return new Response(obj.body as unknown as ReadableStream, { status, headers: h });
};

export const GET = handler;
export const HEAD = handler;
