// Cloudflare bindings (see wrangler.toml), exposed by @sveltejs/adapter-cloudflare via `cloudflare:workers`.
declare module 'cloudflare:workers' {
	export const env: {
		/** R2 bucket "taptoah-data" holding meta.json and the *.parquet files. */
		DATA?: import('@cloudflare/workers-types').R2Bucket;
	};
}
