import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Seller pages are not prerendered: any name is served by the SPA fallback (200.html).
export const prerender = false;

export const load: PageLoad = ({ params }) => {
	const name = params.name.trim();
	if (!name) error(404, 'Invalid seller name');
	return { name };
};
