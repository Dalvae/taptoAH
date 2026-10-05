import { page } from '$app/state';
import { goto } from '$app/navigation';
import type { Meta } from './data';

const KEY = 'taptoah:realm';

function readStored(): string {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

export const realmState = $state({
	meta: null as Meta | null,
	stored: typeof localStorage === 'undefined' ? '' : readStored()
});

export function realmList(): string[] {
	return Object.keys(realmState.meta?.realms ?? {});
}

export function defaultRealm(): string {
	return realmList()[0] ?? '';
}

/** Current realm: ?realm= in the URL wins, then the last choice (localStorage), then the first realm. */
export function currentRealm(): string {
	const list = realmList();
	const fromUrl = page.url.searchParams.get('realm');
	if (fromUrl && list.includes(fromUrl)) return fromUrl;
	if (realmState.stored && list.includes(realmState.stored)) return realmState.stored;
	return list[0] ?? '';
}

/** Add ?realm= to an internal href when the active realm is not the default one. */
export function withRealm(href: string): string {
	const r = currentRealm();
	if (!r || r === defaultRealm()) return href;
	const u = new URL(href, page.url.href);
	u.searchParams.set('realm', r);
	return u.pathname + u.search;
}

export function setRealm(key: string) {
	realmState.stored = key;
	try {
		localStorage.setItem(KEY, key);
	} catch {
		/* storage unavailable (private mode) */
	}
	const u = new URL(page.url.href);
	if (key === defaultRealm()) u.searchParams.delete('realm');
	else u.searchParams.set('realm', key);
	u.searchParams.delete('page');
	goto(u.pathname + u.search, { replace: true, reset: false });
}
