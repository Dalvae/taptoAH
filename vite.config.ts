import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import sirv from 'sirv';

/**
 * Local data for `pnpm dev` / `pnpm preview`: serve ./data (or $LOCAL_DATA_DIR) at /data with Range
 * support, ahead of the SvelteKit /data endpoint that streams from R2 in production.
 * Set LOCAL_DATA_DIR=off to exercise the R2 endpoint (wrangler's local R2) instead.
 */
function localData(): Plugin {
	const dir = process.env.LOCAL_DATA_DIR ?? 'data';
	const serve =
		dir === 'off'
			? null
			: sirv(dir, {
					dev: true,
					etag: true,
					onNoMatch: (_req, res) => {
						res.statusCode = 404;
						res.end('Not found');
					}
				});
	return {
		name: 'taptoah-local-data',
		configureServer: {
			order: 'pre',
			handler(server) {
				if (serve) server.middlewares.use('/data', serve);
			}
		},
		configurePreviewServer: {
			order: 'pre',
			handler(server) {
				if (serve) server.middlewares.use('/data', serve);
			}
		}
	};
}

export default defineConfig({
	plugins: [
		localData(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
