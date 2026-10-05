<script lang="ts">
	import './layout.css';
		import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import Logo from '#lib/components/Logo.svelte';
	import HeaderSearch from '#lib/components/HeaderSearch.svelte';
	import RealmPicker from '#lib/components/RealmPicker.svelte';
	import { realmState, withRealm } from '#lib/realm.svelte.ts';
	import { relativeTime, absTime } from '#lib/format.ts';

	let { children, data }: LayoutProps = $props();

	$effect.pre(() => {
		realmState.meta = data.meta;
	});

	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(t);
	});

	const nav = [
		{ href: '/', label: 'Browse' },
		{ href: '/movers', label: 'Movers & Deals' }
	];
	function isActive(href: string) {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<meta name="description" content="taptoAH — auction house price history for WotLK 3.3.5a realms." />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
		<div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
			<a href={withRealm('/')} class="flex items-center no-underline" aria-label="taptoAH home">
				<Logo size="sm" inline />
			</a>
			<nav class="flex items-center gap-1 text-sm">
				{#each nav as n (n.href)}
					<a
						href={withRealm(n.href)}
						class="rounded-md px-2.5 py-1.5 hover:bg-panel-2"
						class:text-accent-2={isActive(n.href)}
						class:bg-panel-2={isActive(n.href)}
						class:text-muted={!isActive(n.href)}>{n.label}</a
					>
				{/each}
			</nav>
			<div class="order-last w-full sm:order-none sm:ml-auto sm:w-80 lg:w-96">
				<HeaderSearch />
			</div>
			<div class="ml-auto flex items-center gap-3 sm:ml-0">
				{#if data.meta}
					<span class="hidden text-xs text-muted md:inline" title={absTime(data.meta.generated_at)}>
						Data updated {relativeTime(data.meta.generated_at, now)}
					</span>
				{/if}
				<RealmPicker />
			</div>
		</div>
	</header>

	<main class="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-5">
		{#if data.metaError}
			<div class="panel mb-4 border-down/50 p-4 text-sm">
				<b class="text-down">Could not load meta.json.</b>
				<span class="text-muted">{data.metaError}</span>
			</div>
		{/if}
		{@render children()}
	</main>

	<footer class="border-t border-line text-xs text-muted">
		<div class="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 py-4 sm:px-5">
			<p>
				<b class="text-ink">taptoAH</b> is open source. Prices come from in-game auction house scans and
				TSM exports.
			</p>
			<p>Not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft® is a trademark of Blizzard.</p>
		</div>
	</footer>
</div>
