<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import User from '@lucide/svelte/icons/user';
	import {
		getSellers,
		getSellerAuctions,
		getSellerActivity,
		realmLabel,
		type SellerBoard,
		type SellerAuction,
		type SellerActivity,
		type EventKind
	} from '#lib/data.ts';
	import { currentRealm, withRealm } from '#lib/realm.svelte.ts';
	import { className, TIME_LEFT } from '#lib/wow.ts';
	import { fmtInt, fmtPct, relativeTime, absTime } from '#lib/format.ts';
	import Money from '#lib/components/Money.svelte';
	import ItemName from '#lib/components/ItemName.svelte';
	import DailyChart from '#lib/components/DailyChart.svelte';

	let { data }: PageProps = $props();

	const realm = $derived(currentRealm());
	let board = $state<SellerBoard | null>(null);
	let auctions = $state<SellerAuction[] | null>(null);
	/** undefined = loading, null = events.parquet not published */
	let activity = $state<SellerActivity | null | undefined>(undefined);
	let error = $state('');

	$effect(() => {
		const name = data.name;
		const r = realm;
		if (!r) return;
		let cancelled = false;
		board = null;
		auctions = null;
		activity = undefined;
		error = '';
		const fail = (e: unknown) => {
			if (!cancelled) error = e instanceof Error ? e.message : String(e);
		};
		getSellers(r)
			.then((b) => !cancelled && (board = b))
			.catch(fail);
		getSellerAuctions(r, name)
			.then((a) => !cancelled && (auctions = a))
			.catch((e) => {
				fail(e);
				if (!cancelled) auctions = [];
			});
		getSellerActivity(r, name)
			.then((a) => !cancelled && (activity = a))
			.catch((e) => {
				fail(e);
				if (!cancelled) activity = null;
			});
		return () => (cancelled = true);
	});

	const stats = $derived(board?.sellers.find((s) => s.owner === data.name) ?? null);
	const rank = $derived(stats && board ? board.sellers.indexOf(stats) + 1 : null);
	const loaded = $derived(board != null && auctions != null && activity !== undefined);
	const unknown = $derived(loaded && !stats && !auctions?.length && !activity?.recent.length);

	// ---- items they dominate / categories -------------------------------------------------------
	const dominated = $derived.by(() => {
		const byItem = new Map<number, { a: SellerAuction; units: number; listings: number }>();
		for (const a of auctions ?? []) {
			const e = byItem.get(a.item_id);
			if (e) {
				e.units += a.count;
				e.listings++;
			} else byItem.set(a.item_id, { a, units: a.count, listings: 1 });
		}
		return [...byItem.values()]
			.map((e) => ({ ...e, share: e.a.item_listings ? (e.listings / e.a.item_listings) * 100 : 0 }))
			.sort((x, y) => y.share - x.share || y.a.item_listings - x.a.item_listings || y.units - x.units)
			.slice(0, 15);
	});

	const categories = $derived.by(() => {
		const m = new Map<number, { listings: number; value: number }>();
		for (const a of auctions ?? []) {
			const c = a.class ?? -1;
			const e = m.get(c) ?? { listings: 0, value: 0 };
			e.listings++;
			e.value += a.buyout ?? 0;
			m.set(c, e);
		}
		const total = auctions?.length ?? 0;
		return [...m.entries()]
			.map(([c, e]) => ({ name: c < 0 ? 'Unknown' : className(c), ...e, pct: total ? (e.listings / total) * 100 : 0 }))
			.sort((x, y) => y.listings - x.listings);
	});

	// ---- current auctions table (URL state) -----------------------------------------------------
	type SortKey = 'name' | 'count' | 'unit' | 'vs' | 'time_left';
	const SORT_KEYS: SortKey[] = ['name', 'count', 'unit', 'vs', 'time_left'];
	const PER = 50;

	const f = $derived.by(() => {
		const sp = page.url.searchParams;
		const sort = sp.get('sort') as SortKey | null;
		const pg = Number(sp.get('page'));
		return {
			q: sp.get('q') ?? '',
			sort: sort && SORT_KEYS.includes(sort) ? sort : ('name' as SortKey),
			dir: sp.get('dir') === 'desc' ? 'desc' : 'asc',
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
		if (document.activeElement?.id !== 'seller-q') qInput = fromUrl;
	});
	function onQ() {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => setParams({ q: qInput.trim() }), 180);
	}
	function sortBy(key: SortKey) {
		if (f.sort === key) setParams({ sort: key, dir: f.dir === 'desc' ? 'asc' : 'desc' });
		else setParams({ sort: key, dir: key === 'name' || key === 'vs' ? 'asc' : 'desc' });
	}

	const vs = (a: SellerAuction) =>
		a.unit_buyout && a.market_value ? (a.unit_buyout / a.market_value - 1) * 100 : null;

	const rows = $derived.by(() => {
		const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
		const list = (auctions ?? []).filter((a) => {
			const name = (a.name ?? `item #${a.item_id}`).toLowerCase();
			return tokens.every((t) => name.includes(t) || String(a.item_id) === t);
		});
		const val = (a: SellerAuction): number | string | null =>
			f.sort === 'name'
				? (a.name ?? `item #${a.item_id}`).toLowerCase()
				: f.sort === 'count'
					? a.count
					: f.sort === 'unit'
						? a.unit_buyout || null
						: f.sort === 'vs'
							? vs(a)
							: a.time_left;
		const dir = f.dir === 'asc' ? 1 : -1;
		return list.sort((a, b) => {
			const va = val(a);
			const vb = val(b);
			if (va == null && vb == null) return 0;
			if (va == null) return 1;
			if (vb == null) return -1;
			return va < vb ? -dir : va > vb ? dir : (a.unit_buyout ?? 0) - (b.unit_buyout ?? 0);
		});
	});
	const pageCount = $derived(Math.max(1, Math.ceil(rows.length / PER)));
	const curPage = $derived(Math.min(f.page, pageCount));
	const pageRows = $derived(rows.slice((curPage - 1) * PER, curPage * PER));

	const cols: { key: SortKey; label: string; right?: boolean; cls?: string; title?: string }[] = [
		{ key: 'name', label: 'Item' },
		{ key: 'count', label: 'Stack', right: true },
		{ key: 'unit', label: 'Unit buyout', right: true },
		{ key: 'vs', label: 'vs market', right: true, cls: 'hidden sm:table-cell', title: 'Unit buyout vs market value' },
		{ key: 'time_left', label: 'Time left', cls: 'hidden md:table-cell' }
	];

	// ---- events ---------------------------------------------------------------------------------
	const KINDS: Record<EventKind, { label: string; cls: string }> = {
		new: { label: 'Listed', cls: 'text-accent-2' },
		sold: { label: 'Sold', cls: 'text-up' },
		expired: { label: 'Expired', cls: 'text-muted' }
	};
</script>

<svelte:head>
	<title>{data.name} · Sellers · taptoAH</title>
</svelte:head>

{#snippet pct(p: number | null)}
	{#if p == null}
		<span class="text-dim">—</span>
	{:else}
		<span class="num" class:text-up={p < -1} class:text-muted={p >= -1}>{fmtPct(p)}</span>
	{/if}
{/snippet}

{#snippet tile(label: string, title = '')}
	<div class="label" {title}>{label}</div>
{/snippet}

<a href={withRealm('/sellers')} class="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
	<ArrowLeft size={14} /> All sellers
</a>

{#if error}
	<div class="panel mb-4 p-4 text-sm"><b class="text-down">Error:</b> {error}</div>
{/if}

<section class="panel mb-4 flex flex-wrap items-center gap-4 p-4">
	<span class="flex h-12 w-12 items-center justify-center rounded-lg bg-panel-2 text-accent-2"><User size={26} /></span>
	<div class="min-w-0 flex-1">
		<h1 class="truncate text-xl font-bold sm:text-2xl">{data.name}</h1>
		<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
			<span>
				{realmLabel(realm).realm}{#if realmLabel(realm).faction}
					· {realmLabel(realm).faction}{/if}
			</span>
			{#if rank && board}<span>Rank <b class="num text-ink">#{rank}</b> of {fmtInt(board.sellers.length)} sellers</span>{/if}
			{#if stats?.lastSeen}<span title={absTime(stats.lastSeen)}>Last seen {relativeTime(stats.lastSeen)}</span>{/if}
		</div>
	</div>
</section>

{#if unknown}
	<div class="panel p-8 text-center text-sm text-muted">
		No auctions or sales found for <b class="text-ink">{data.name}</b> on this realm.
		{#if board && board.sellers.length === 0}
			Seller data fills in after the next in-game scan.
		{/if}
		<div class="mt-3"><a href={withRealm('/sellers')} class="text-accent-2 hover:underline">Browse all sellers</a></div>
	</div>
{:else}
	<!-- Stat tiles -->
	<section class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
		<div class="panel p-3">
			{@render tile('Listings', 'Live auctions in the latest scan')}
			<div class="num mt-1 text-lg font-semibold">{#if board}{fmtInt(stats?.listings ?? 0)}{:else}<div class="skeleton h-6 w-12"></div>{/if}</div>
			{#if stats?.units}<div class="num text-xs text-dim">{fmtInt(stats.units)} items</div>{/if}
		</div>
		<div class="panel p-3">
			{@render tile('Live value', 'Sum of buyouts')}
			<div class="mt-1 text-lg font-semibold">{#if board}<Money value={stats?.listings ? stats.value : null} compact />{:else}<div class="skeleton h-6 w-20"></div>{/if}</div>
		</div>
		<div class="panel p-3">
			{@render tile('Distinct items')}
			<div class="num mt-1 text-lg font-semibold">{#if board}{fmtInt(stats?.items ?? 0)}{:else}<div class="skeleton h-6 w-12"></div>{/if}</div>
		</div>
		<div class="panel p-3">
			{@render tile('Share', 'Share of all live auctions on the realm')}
			<div class="num mt-1 text-lg font-semibold">
				{#if board}{stats?.share != null ? `${stats.share.toFixed(1)}%` : '—'}{:else}<div class="skeleton h-6 w-12"></div>{/if}
			</div>
		</div>
		<div class="panel p-3">
			{@render tile('Sales 7d', 'Listings that sold (or were cancelled) in the last 7 days')}
			<div class="num mt-1 text-lg font-semibold">{#if board}{fmtInt(stats?.sold7d ?? 0)}{:else}<div class="skeleton h-6 w-12"></div>{/if}</div>
			{#if stats?.soldValue7d}<div class="text-xs"><Money value={stats.soldValue7d} compact /></div>{/if}
		</div>
		<div class="panel p-3">
			{@render tile('Sell-through 7d', 'Sold / (sold + expired)')}
			<div class="num mt-1 text-lg font-semibold">
				{#if board}{stats?.sellThrough != null ? `${stats.sellThrough.toFixed(0)}%` : '—'}{:else}<div class="skeleton h-6 w-12"></div>{/if}
			</div>
			{#if stats && stats.sold7d + stats.expired7d}<div class="num text-xs text-dim">{fmtInt(stats.expired7d)} expired</div>{/if}
		</div>
		<div class="panel p-3">
			{@render tile('vs market', 'Median unit buyout of their live auctions vs market value')}
			<div class="mt-1 text-lg font-semibold">
				{#if board}{@render pct(stats?.priceRatio != null ? (stats.priceRatio - 1) * 100 : null)}{:else}<div class="skeleton h-6 w-12"></div>{/if}
			</div>
			<div class="text-xs text-dim">median listing</div>
		</div>
		<div class="panel p-3">
			{@render tile('Main categories')}
			<div class="mt-1 truncate text-sm font-semibold">
				{#if auctions}{categories.slice(0, 2).map((c) => c.name).join(', ') || '—'}{:else}<div class="skeleton h-6 w-20"></div>{/if}
			</div>
		</div>
	</section>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
		<div class="flex min-w-0 flex-col gap-4">
			<!-- Current auctions -->
			<section class="panel overflow-hidden">
				<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
					<h2 class="font-semibold">
						Current auctions
						{#if auctions}<span class="num ml-1 text-xs font-normal text-muted">{fmtInt(rows.length)}</span>{/if}
					</h2>
					{#if auctions?.length}
						<input
							id="seller-q"
							class="input w-44 text-sm"
							type="search"
							placeholder="Filter items…"
							aria-label="Filter auctions by item"
							bind:value={qInput}
							oninput={onQ}
						/>
					{/if}
				</div>
				<div class="overflow-x-auto">
					<table class="grid-table">
						<thead>
							<tr>
								{#each cols as c (c.key)}
									<th
										class="{c.cls ?? ''} {c.right ? 'r' : ''}"
										title={c.title}
										aria-sort={f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
									>
										<button type="button" class="sortbtn" class:on={f.sort === c.key} onclick={() => sortBy(c.key)}>
											{c.label}<span class="arrow">{f.sort === c.key ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
										</button>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#if auctions === null}
								{#each Array(8) as _, i (i)}
									<tr><td colspan={cols.length}><div class="skeleton h-6 w-full"></div></td></tr>
								{/each}
							{:else if pageRows.length === 0}
								<tr>
									<td colspan={cols.length} class="py-8 text-center whitespace-normal text-muted">
										{#if auctions.length === 0}
											No live auctions from {data.name} in the latest scan.
										{:else}
											No auctions match “{f.q}”.
										{/if}
									</td>
								</tr>
							{:else}
								{#each pageRows as a, i (i)}
									<tr>
										<td class="item-cell"><ItemName item={a} size={22} /></td>
										<td class="r num">{a.count}</td>
										<td class="r">
											<Money value={a.unit_buyout || null} />
											{#if !a.buyout}<div class="text-xs text-dim">bid only</div>{/if}
										</td>
										<td class="r hidden sm:table-cell">{@render pct(vs(a))}</td>
										<td
											class="hidden md:table-cell"
											class:text-down={a.time_left === 1}
											class:text-muted={a.time_left !== 1}
											title={a.time_left ? TIME_LEFT[a.time_left]?.hint : ''}
											>{a.time_left ? (TIME_LEFT[a.time_left]?.label ?? a.time_left) : '—'}</td
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
			</section>

			<!-- Activity -->
			<section class="panel p-4">
				<h2 class="mb-1 font-semibold">Activity by day</h2>
				{#if activity === undefined}
					<div class="skeleton h-[200px] w-full"></div>
				{:else if activity === null}
					<p class="py-6 text-center text-sm text-muted">Sales data is not available yet.</p>
				{:else if activity.days.length === 0}
					<p class="py-6 text-center text-sm text-muted">No listings from {data.name} appeared or disappeared in the last 90 days.</p>
				{:else}
					<p class="mb-2 text-xs text-muted">Listings that appeared, sold (or were cancelled) and expired, last 90 days.</p>
					<DailyChart
						days={activity.days.map((d) => d.day)}
						series={[
							{ label: 'Listed', values: activity.days.map((d) => d.listed), color: '#a5b4fc' },
							{ label: 'Sold', values: activity.days.map((d) => d.sold), color: '#22c55e' },
							{ label: 'Expired', values: activity.days.map((d) => d.expired), color: '#64647e' }
						]}
					/>
				{/if}
			</section>

			{#if activity?.recent.length}
				<section class="panel overflow-hidden">
					<h2 class="border-b border-line px-4 py-2 font-semibold">Recent events</h2>
					<div class="max-h-[480px] overflow-auto">
						<table class="grid-table">
							<thead>
								<tr>
									<th>When</th>
									<th></th>
									<th>Item</th>
									<th class="r">Qty</th>
									<th class="r hidden sm:table-cell">Unit</th>
								</tr>
							</thead>
							<tbody>
								{#each activity.recent as e, i (i)}
									<tr>
										<td class="text-muted" title={absTime(e.time)}>{relativeTime(e.time)}</td>
										<td class={KINDS[e.kind]?.cls ?? ''}>{KINDS[e.kind]?.label ?? e.kind}</td>
										<td class="item-cell"><ItemName item={e} size={20} /></td>
										<td class="r num">{e.count}</td>
										<td class="r hidden sm:table-cell"><Money value={e.buyout && e.count ? e.buyout / e.count : null} /></td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<p class="border-t border-line px-4 py-2 text-xs text-dim">
						The newest 100 events. “Sold” also covers cancelled listings.
					</p>
				</section>
			{/if}
		</div>

		<aside class="flex min-w-0 flex-col gap-4">
			<section class="panel overflow-hidden">
				<h2 class="border-b border-line px-4 py-2 font-semibold" title="Their share of each item's live auctions">
					Items they dominate
				</h2>
				{#if auctions === null}
					<div class="p-4"><div class="skeleton h-32 w-full"></div></div>
				{:else if dominated.length === 0}
					<p class="py-6 text-center text-sm text-muted">No live auctions.</p>
				{:else}
					<table class="grid-table">
						<thead>
							<tr>
								<th>Item</th>
								<th class="r" title="Their auctions / all live auctions of the item">Share</th>
								<th class="r" title="Sellers with this item listed">Sellers</th>
							</tr>
						</thead>
						<tbody>
							{#each dominated as d (d.a.item_id)}
								<tr>
									<td class="max-w-[13rem] sm:max-w-[16rem]"><ItemName item={d.a} size={20} /></td>
									<td class="r num" title="{fmtInt(d.units)} of {fmtInt(d.a.item_units)} units">
										{d.share.toFixed(0)}%
										<span class="text-xs text-dim">({fmtInt(d.listings)}/{fmtInt(d.a.item_listings)})</span>
										<div class="share-bar"><span style="width:{d.share}%"></span></div>
									</td>
									<td class="r num text-muted">{fmtInt(d.a.item_sellers)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<section class="panel p-4">
				<h2 class="mb-2 font-semibold">Categories</h2>
				{#if auctions === null}
					<div class="skeleton h-24 w-full"></div>
				{:else if categories.length === 0}
					<p class="py-4 text-center text-sm text-muted">No live auctions.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each categories as c (c.name)}
							<li>
								<div class="flex items-baseline justify-between gap-2">
									<span>{c.name}</span>
									<span class="num text-xs text-muted">{fmtInt(c.listings)} · {c.pct.toFixed(0)}% · <Money value={c.value} compact /></span>
								</div>
								<div class="cat-bar"><span style="width:{c.pct}%"></span></div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</aside>
	</div>
{/if}

<style>
	.item-cell {
		white-space: normal;
		min-width: 9rem;
	}
	@media (min-width: 640px) {
		.item-cell {
			white-space: nowrap;
			max-width: 22rem;
		}
	}
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
	.share-bar,
	.cat-bar {
		margin-top: 2px;
		height: 3px;
		border-radius: 2px;
		background: var(--color-line);
		overflow: hidden;
	}
	.share-bar {
		margin-left: auto;
		width: 3.5rem;
	}
	.share-bar span,
	.cat-bar span {
		display: block;
		height: 100%;
		background: var(--color-accent);
	}
</style>
