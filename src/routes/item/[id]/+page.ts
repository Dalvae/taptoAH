import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Item pages are not prerendered: any id is served by the SPA fallback (200.html).
export const prerender = false;

export const load: PageLoad = ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Invalid item id');
	return { id };
};
