<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Users from '@lucide/svelte/icons/users';
	import { getSellers, type SellerBoard, type SellerStats } from '#lib/data.ts';
	import { currentRealm } from '#lib/realm.svelte.ts';
	import { className } from '#lib/wow.ts';
	import { fmtInt, fmtPct, relativeTime, absTime } from '#lib/format.ts';
	import Money from '#lib/components/Money.svelte';
	import SellerLink from '#lib/components/SellerLink.svelte';
	import DailyChart from '#lib/components/DailyChart.svelte';

	// ---- data -----------------------------------------------------------------------------------
	const realm = $derived(currentRealm());
	let data = $state<SellerBoard | null>(null);
	let error = $state('');

	$effect(() => {
		const r = realm;
		if (!r) return;
		let cancelled = false;
		data = null;
		error = '';
		getSellers(r)
			.then((d) => !cancelled && (data = d))
			.catch((e) => !cancelled && (error = e instanceof Error ? e.message : String(e)));
		return () => (cancelled = true);
	});

	/** Rank by live listings (the board is already sorted that way). */
	const rank = $derived(new Map((data?.sellers ?? []).map((s, i) => [s.owner, i + 1])));

	const summary = $derived.by(() => {
		if (!data) return null;
		const active = data.sellers.filter((s) => s.listings > 0);
		const top10 = active.slice(0, 10).reduce((n, s) => n + s.listings, 0);
		return {
			active: active.length,
			top10Share: data.totalListings ? (top10 / data.totalListings) * 100 : null,
			sold: data.sellers.reduce((n, s) => n + s.sold7d, 0),
			soldValue: data.sellers.reduce((n, s) => n + s.soldValue7d, 0)
		};
	});

	// ---- URL state ------------------------------------------------------------------------------
	type SortKey = 'owner' | 'listings' | 'value' | 'items' | 'sold7d' | 'sellThrough' | 'priceRatio' | 'lastSeen';
	const SORT_KEYS: SortKey[] = ['owner', 'listings', 'value', 'items', 'sold7d', 'sellThrough', 'priceRatio', 'lastSeen'];
	const PER = 50;

	const f = $derived.by(() => {
		const sp = page.url.searchParams;
		const sort = sp.get('sort') as SortKey | null;
		const pg = Number(sp.get('page'));
		return {
			q: sp.get('q') ?? '',
			sort: sort && SORT_KEYS.includes(sort) ? sort : ('listings' as SortKey),
			dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
			page: Number.isInteger(pg) && pg > 1 ? pg : 1
		};
	});

	function setParams(changes: Record<string, string | number | null | undefined>, resetPage = true) {
		const u = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v == null || v === '') u.searchParams.delete(k);
			else u.searchParams.set(k, String(v));
		}
		if (resetPage && !('page' in changes)) u.searchParams.delete('page');
		goto(u.pathname + u.search, { replace: true, reset: false });
	}

	let qInput = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const fromUrl = f.q;
		if (document.activeElement?.id !== 'sellers-q') qInput = fromUrl;
	});
	function onQ() {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => setParams({ q: qInput.trim() }), 180);
	}

	function sortBy(key: SortKey) {
		if (f.sort === key) setParams({ sort: key, dir: f.dir === 'desc' ? 'asc' : 'desc' });
		else setParams({ sort: key, dir: key === 'owner' || key === 'priceRatio' ? 'asc' : 'desc' });
	}

	// ---- filtering / sorting --------------------------------------------------------------------
	const rows = $derived.by(() => {
		const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
		const list = (data?.sellers ?? []).filter((s) => tokens.every((t) => s.search.includes(t)));
		const key = f.sort;
		const dir = f.dir === 'asc' ? 1 : -1;
		const val = (s: SellerStats) => (key === 'owner' ? s.search : s[key]);
		return list.sort((a, b) => {
			const va = val(a);
			const vb = val(b);
			if (va == null && vb == null) return b.listings - a.listings;
			if (va == null) return 1;
			if (vb == null) return -1;
			if (va < vb) return -dir;
			if (va > vb) return dir;
			return b.listings - a.listings;
		});
	});

	const pageCount = $derived(Math.max(1, Math.ceil(rows.length / PER)));
	const curPage = $derived(Math.min(f.page, pageCount));
	const pageRows = $derived(rows.slice((curPage - 1) * PER, curPage * PER));

	type Col = { key: SortKey | null; label: string; right?: boolean; cls?: string; title?: string };
	const cols: Col[] = [
		{ key: 'owner', label: 'Seller' },
		{ key: 'listings', label: 'Listings', right: true, title: 'Live auctions in the latest scan' },
		{ key: 'value', label: 'Live value', right: true, title: 'Sum of buyouts of their live auctions' },
		{ key: 'items', label: 'Items', right: true, cls: 'hidden md:table-cell', title: 'Distinct items listed' },
		{ key: null, label: 'Share', right: true, cls: 'hidden sm:table-cell', title: 'Share of all live auctions on the realm' },
		{ key: null, label: 'Main categories', cls: 'hidden xl:table-cell' },
		{ key: 'sold7d', label: 'Sales 7d', right: true, cls: 'hidden md:table-cell', title: 'Listings that sold (or were cancelled) in the last 7 days' },
		{ key: 'sellThrough', label: 'Sell-through', right: true, cls: 'hidden lg:table-cell', title: 'Sold / (sold + expired), last 7 days' },
		{ key: 'priceRatio', label: 'vs market', right: true, cls: 'hidden lg:table-cell', title: 'Median unit buyout of their live auctions vs market value. Negative = they list below market.' },
		{ key: 'lastSeen', label: 'Last seen', right: true, cls: 'hidden sm:table-cell' }
	];

	function classNames(cs: number[]): string {
		return cs
			.slice(0, 2)
			.map((c) => (c < 0 ? 'Unknown' : className(c)))
			.join(', ');
	}
</script>

<svelte:head>
	<title>Sellers · taptoAH</title>
</svelte:head>

{#snippet ratio(r: number | null)}
	{#if r == null}
		<span class="text-dim">—</span>
	{:else}
		{@const p = (r - 1) * 100}
		<span class="num" class:text-up={p < -1} class:text-muted={p >= -1}>{fmtPct(p)}</span>
	{/if}
{/snippet}

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div class="max-w-2xl">
		<h1 class="flex items-center gap-2 text-2xl font-bold"><Users size={22} class="text-accent-2" /> Sellers</h1>
		<p class="text-sm text-muted">
			Who is selling on this auction house: live auctions from the latest scan, plus sales and expiries
			from the last 7 days of scans.
		</p>
	</div>
	<div class="panel flex flex-wrap items-end gap-3 p-3 text-sm">
		<label class="flex flex-col gap-1">
			<span class="label">Search</span>
			<input
				id="sellers-q"
				class="input w-44"
				type="search"
				placeholder="Seller name…"
				aria-label="Filter by seller name"
				bind:value={qInput}
				oninput={onQ}
			/>
		</label>
	</div>
</div>

{#if error}
	<div class="panel mb-4 p-4 text-sm"><b class="text-down">Failed to load data:</b> {error}</div>
{/if}

<section class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
	<div class="panel p-3">
		<div class="label">Active sellers</div>
		<div class="num mt-1 text-lg font-semibold">
			{#if summary}{fmtInt(summary.active)}{:else}<div class="skeleton h-6 w-16"></div>{/if}
		</div>
		<div class="text-xs text-dim">with live auctions</div>
	</div>
	<div class="panel p-3">
		<div class="label" title="Share of all live auctions held by the 10 biggest sellers">Top-10 share</div>
		<div class="num mt-1 text-lg font-semibold">
			{#if summary}{summary.top10Share == null ? '—' : `${summary.top10Share.toFixed(1)}%`}{:else}<div
					class="skeleton h-6 w-16"
				></div>{/if}
		</div>
		<div class="text-xs text-dim">of live auctions (concentration)</div>
	</div>
	<div class="panel p-3">
		<div class="label">Total live value</div>
		<div class="mt-1 text-lg font-semibold">
			{#if data}<Money value={data.totalListings ? data.totalValue : null} compact />{:else}<div
					class="skeleton h-6 w-24"
				></div>{/if}
		</div>
		<div class="num text-xs text-dim">{data ? `${fmtInt(data.totalListings)} auctions` : ''}</div>
	</div>
	<div class="panel p-3">
		<div class="label">Sales 7d</div>
		<div class="mt-1 text-lg font-semibold">
			{#if summary}<Money value={summary.sold ? summary.soldValue : null} compact />{:else}<div
					class="skeleton h-6 w-24"
				></div>{/if}
		</div>
		<div class="num text-xs text-dim">{summary ? `${fmtInt(summary.sold)} listings sold` : ''}</div>
	</div>
</section>

{#if data && data.days.length > 1}
	<section class="panel mb-4 p-4">
		<h2 class="mb-1 font-semibold">Activity, last 30 days</h2>
		<p class="mb-2 text-xs text-muted">Sellers with any listing appearing or disappearing that day, and new listings.</p>
		<DailyChart
			days={data.days.map((d) => d.day)}
			series={[
				{ label: 'New listings', values: data.days.map((d) => d.listed), color: '#6366f1', bars: true, right: true },
				{ label: 'Active sellers', values: data.days.map((d) => d.sellers), color: '#fbbf24' }
			]}
		/>
	</section>
{/if}

<section class="panel overflow-hidden">
	<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
		<span class="text-muted">
			{#if data}
				<b class="num text-ink">{fmtInt(rows.length)}</b> sellers
			{:else if !error}
				Loading sellers…
			{/if}
		</span>
	</div>
	<div class="overflow-x-auto">
		<table class="grid-table">
			<thead>
				<tr>
					<th class="r hidden sm:table-cell">#</th>
					{#each cols as c, i (i)}
						<th
							class="{c.cls ?? ''} {c.right ? 'r' : ''}"
							title={c.title}
							aria-sort={c.key && f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
						>
							{#if c.key}
								{@const on = f.sort === c.key}
								<button type="button" class="sortbtn" class:on onclick={() => sortBy(c.key!)}>
									{c.label}<span class="arrow">{on ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
								</button>
							{:else}
								{c.label}
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if !data && !error}
					{#each Array(10) as _, i (i)}
						<tr><td colspan={cols.length + 1}><div class="skeleton h-6 w-full"></div></td></tr>
					{/each}
				{:else if data && pageRows.length === 0}
					<tr>
						<td colspan={cols.length + 1} class="py-10 text-center whitespace-normal text-muted">
							{#if data.sellers.length === 0}
								{#if data.totalListings}
									The latest scan has no seller names for this realm.
								{:else}
									No seller data for this realm yet. This page fills in after the next in-game scan.
								{/if}
							{:else}
								No sellers match “{f.q}”.
								<button
									type="button"
									class="ml-2 text-accent underline"
									onclick={() => {
										qInput = '';
										setParams({ q: null });
									}}>Clear search</button
								>
							{/if}
						</td>
					</tr>
				{:else}
					{#each pageRows as s (s.owner)}
						<tr>
							<td class="r num hidden text-dim sm:table-cell">{rank.get(s.owner)}</td>
							<td class="max-w-[11rem] truncate font-medium">
								<SellerLink name={s.owner} />
								<div class="text-xs font-normal text-dim sm:hidden">
									{s.share != null ? `${s.share.toFixed(1)}% · ` : ''}{fmtInt(s.sold7d)} sold 7d
								</div>
							</td>
							<td class="r num">{fmtInt(s.listings)}</td>
							<td class="r"><Money value={s.listings ? s.value : null} compact /></td>
							<td class="r num hidden md:table-cell">{fmtInt(s.items)}</td>
							<td class="r num hidden sm:table-cell">
								{s.share == null ? '—' : `${s.share.toFixed(1)}%`}
								<div class="share-bar"><span style="width:{Math.min(100, (s.share ?? 0) * 4)}%"></span></div>
							</td>
							<td class="hidden text-muted xl:table-cell">{classNames(s.classes) || '—'}</td>
							<td class="r hidden md:table-cell">
								<span class="num">{fmtInt(s.sold7d)}</span>
								{#if s.soldValue7d}<div class="text-xs"><Money value={s.soldValue7d} compact /></div>{/if}
							</td>
							<td class="r num hidden lg:table-cell"
								>{s.sellThrough == null ? '—' : `${s.sellThrough.toFixed(0)}%`}</td
							>
							<td class="r hidden lg:table-cell">{@render ratio(s.priceRatio)}</td>
							<td class="r hidden text-muted sm:table-cell" title={absTime(s.lastSeen)}
								>{s.lastSeen ? relativeTime(s.lastSeen) : '—'}</td
							>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{#if pageCount > 1}
		<div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm">
			<span class="num text-muted">
				{fmtInt((curPage - 1) * PER + 1)}–{fmtInt(Math.min(curPage * PER, rows.length))} of {fmtInt(rows.length)}
			</span>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="btn"
					disabled={curPage <= 1}
					onclick={() => setParams({ page: curPage - 1 > 1 ? curPage - 1 : null }, false)}>‹ Prev</button
				>
				<span class="num px-2 text-muted">{curPage} / {pageCount}</span>
				<button
					type="button"
					class="btn"
					disabled={curPage >= pageCount}
					onclick={() => setParams({ page: curPage + 1 }, false)}>Next ›</button
				>
			</div>
		</div>
	{/if}
	<p class="border-t border-line px-4 py-2 text-xs text-dim">
		Live numbers come from the latest scan that covered each item. Sales are listings that disappeared
		before expiring between scans, which also covers cancelled ones, so sales and sell-through are upper
		bounds. “vs market” is the median unit buyout of a seller’s live auctions compared with each item’s
		market value.
	</p>
</section>

<style>
	.sortbtn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		text-transform: inherit;
		letter-spacing: inherit;
		font-weight: inherit;
		color: inherit;
	}
	.sortbtn:hover,
	.sortbtn.on {
		color: var(--color-ink);
	}
	.arrow {
		font-size: 0.6rem;
		opacity: 0.5;
	}
	.sortbtn.on .arrow {
		opacity: 1;
		color: var(--color-accent);
	}
	.share-bar {
		margin-top: 2px;
		margin-left: auto;
		width: 4rem;
		height: 3px;
		border-radius: 2px;
		background: var(--color-line);
		overflow: hidden;
	}
	.share-bar span {
		display: block;
		height: 100%;
		background: var(--color-accent);
	}
</style>
