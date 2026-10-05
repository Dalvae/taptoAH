import { loadMeta, type Meta } from '#lib/data.ts';
import type { LayoutLoad } from './$types';

// Pure client-side app: pages are prerendered as empty shells, data is fetched in the browser.
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'never';

export const load: LayoutLoad = async ({ fetch }) => {
	let meta: Meta | null = null;
	let metaError = '';
	try {
		meta = await loadMeta(fetch);
	} catch (e) {
		metaError = e instanceof Error ? e.message : String(e);
	}
	return { meta, metaError };
};
