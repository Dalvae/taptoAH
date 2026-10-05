import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_DATA_URL: {
		public: true,
		static: true,
		description:
			'Base URL of the data files (meta.json, *.parquet, icons/). Defaults to /data (served from static/data in dev).',
		schema: (value) => (value && value.trim() ? value.trim().replace(/\/+$/, '') : '/data')
	},
	PUBLIC_ICON_URL: {
		public: true,
		static: true,
		description:
			'Base URL for item icons as <base>/<icon>.jpg. Defaults to the Wowhead image CDN (large, 56px); a trailing /large is swapped for /medium (36px) in tables.',
		schema: (value) =>
			value && value.trim()
				? value.trim().replace(/\/+$/, '')
				: 'https://wow.zamimg.com/images/wow/icons/large'
	},
	PUBLIC_DUCKDB_BUNDLE_URL: {
		public: true,
		static: true,
		description:
			'Optional base URL hosting the @duckdb/duckdb-wasm dist files. Defaults to jsDelivr (the .wasm files exceed the Cloudflare Pages 25 MiB per-file limit).',
		schema: (value) => (value && value.trim() ? value.trim().replace(/\/+$/, '') : '')
	}
});
