<script lang="ts">
	import type { PageProps } from './$types';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import {
		getItem,
		getLatest,
		getHistory,
		getAuctions,
		getEvents,
		itemName,
		realmLabel,
		type Item,
		type Latest,
		type HistoryPoint,
		type Auction,
		type AuctionEvent,
		type EventKind
	} from '#lib/data.ts';
	import { currentRealm, withRealm } from '#lib/realm.svelte.ts';
	import {
		className,
		subclassName,
		qualityColor,
		QUALITIES,
		INVENTORY_TYPES,
		TIME_LEFT,
		wowheadUrl,
		wowheadTooltip
	} from '#lib/wow.ts';
	import { fmtInt, pctChange, relativeTime, absTime, moneyText } from '#lib/format.ts';
	import ItemIcon from '#lib/components/ItemIcon.svelte';
	import Money from '#lib/components/Money.svelte';
	import Pct from '#lib/components/Pct.svelte';
	import PriceChart from '#lib/components/PriceChart.svelte';

	let { data }: PageProps = $props();

	const realm = $derived(currentRealm());

	let item = $state<Item | null>(null);
	let latest = $state<Latest | null>(null);
	let history = $state<HistoryPoint[] | null>(null);
	let auctions = $state<Auction[] | null>(null);
	/** undefined = loading, null = events.parquet not published */
	let events = $state<AuctionEvent[] | null | undefined>(undefined);
	let loading = $state(true);
	let error = $state('');

	$effect(() => {
		const id = data.id;
		const r = realm;
		if (!r) return;
		let cancelled = false;
		loading = true;
		error = '';
		item = null;
		latest = null;
		history = null;
		auctions = null;
		events = undefined;
		const fail = (e: unknown) => {
			if (!cancelled) error = e instanceof Error ? e.message : String(e);
		};
		Promise.all([getItem(id), getLatest(r, id)])
			.then(([i, l]) => {
				if (cancelled) return;
				item = i;
				latest = l;
			})
			.catch(fail)
			.finally(() => {
				if (!cancelled) loading = false;
			});
		getHistory(r, id)
			.then((h) => !cancelled && (history = h))
			.catch(fail);
		getAuctions(r, id)
			.then((a) => !cancelled && (auctions = a))
			.catch(fail);
		getEvents(r, id)
			.then((ev) => !cancelled && (events = ev))
			.catch((e) => {
				fail(e);
				if (!cancelled) events = null;
			});
		return () => (cancelled = true);
	});

	const name = $derived(itemName({ item_id: data.id, name: item?.name ?? null }));

	// ---- chart range ----------------------------------------------------------------------------
	const RANGES = [
		{ key: '7d', days: 7 },
		{ key: '30d', days: 30 },
		{ key: '90d', days: 90 },
		{ key: 'all', days: Infinity }
	];
	let range = $state('30d');
	let clip = $state(true);
	// The chart always spans the chosen window (7d shows 7 days even with few data points).
	const chartWindow = $derived.by((): [number, number] => {
		const last = Math.max(Math.floor(Date.now() / 86400000), history?.at(-1)?.day ?? 0);
		const days = RANGES.find((r) => r.key === range)!.days;
		if (Number.isFinite(days)) return [last - days + 1, last];
		return [Math.min(history?.[0]?.day ?? last, last - 6), last];
	});
	const visible = $derived.by(() => {
		if (!history) return [];
		const [from, to] = chartWindow;
		return history.filter((p) => p.day >= from && p.day <= to);
	});

	// ---- weekday heatmap (last 12 weeks of daily market values) ---------------------------------
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const heat = $derived.by(() => {
		if (!history || history.length < 3) return null;
		const pts = history.filter((p) => p.market_value != null);
		if (pts.length < 3) return null;
		const lastDay = pts.at(-1)!.day;
		const recent = pts.filter((p) => p.day > lastDay - 84);
		// day 0 (1970-01-01) was a Thursday -> Monday-based weekday index = (day + 3) % 7
		const weekOf = (d: number) => Math.floor((d + 3) / 7);
		const firstWeek = weekOf(recent[0].day);
		const weeks = weekOf(lastDay) - firstWeek + 1;
		const grid: (number | null)[][] = Array.from({ length: weeks }, () => Array(7).fill(null));
		for (const p of recent) grid[weekOf(p.day) - firstWeek][(p.day + 3) % 7] = p.market_value;
		// percentiles / medians keep one absurd day from washing out the whole grid
		const sorted = recent.map((p) => p.market_value!).sort((a, b) => a - b);
		const pct = (q: number) => sorted[Math.round((sorted.length - 1) * q)];
		const min = pct(0.05);
		const max = pct(0.95);
		const median = pct(0.5);
		const byWeekday = WEEKDAYS.map((_, wd) => {
			const v = recent
				.filter((p) => (p.day + 3) % 7 === wd)
				.map((p) => p.market_value!)
				.sort((a, b) => a - b);
			if (!v.length || !median) return null;
			return ((v[Math.floor((v.length - 1) / 2)] - median) / median) * 100;
		});
		const startDay = firstWeek * 7 - 3; // Monday of the first week
		return { grid, min, max, byWeekday, startDay };
	});
	function heatColor(v: number | null, min: number, max: number): string {
		if (v == null) return 'transparent';
		const t = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0.5;
		return `color-mix(in oklab, #6366f1 ${Math.round(15 + t * 85)}%, #1a1a2e)`;
	}

	// ---- current listings -----------------------------------------------------------------------
	const listingStats = $derived.by(() => {
		if (!auctions || !auctions.length) return null;
		const qty = auctions.reduce((a, b) => a + (b.count ?? 0), 0);
		const priced = auctions.filter((a) => a.unit_buyout != null && a.unit_buyout > 0);
		if (!priced.length) return { qty, bins: [], maxQty: 0, lo: 0, hi: 0 };
		const prices = priced.map((a) => a.unit_buyout!).sort((a, b) => a - b);
		const lo = prices[0];
		// cap the histogram at the 95th percentile so a single absurd listing doesn't squash the rest
		const hi = Math.max(prices[Math.floor((prices.length - 1) * 0.95)], lo + 1);
		const N = 14;
		const width = (hi - lo) / N;
		const bins = Array.from({ length: N }, (_, i) => ({ from: lo + i * width, qty: 0 }));
		for (const a of priced) {
			const idx = Math.min(N - 1, Math.floor((Math.min(a.unit_buyout!, hi) - lo) / width));
			bins[idx].qty += a.count;
		}
		return { qty, bins, maxQty: Math.max(...bins.map((b) => b.qty)), lo, hi };
	});

	// ---- sales (listings that appeared / disappeared between scans) ------------------------------
	const KINDS: { kind: EventKind; label: string; cls: string }[] = [
		{ kind: 'new', label: 'Listed', cls: 'text-accent-2' },
		{ kind: 'sold', label: 'Sold', cls: 'text-up' },
		{ kind: 'expired', label: 'Expired', cls: 'text-muted' }
	];
	const sales = $derived.by(() => {
		if (!events) return null;
		const now = Date.now() / 1000;
		const win = (secs: number) => {
			const c: Record<EventKind, number> = { new: 0, sold: 0, expired: 0 };
			let soldCopper = 0;
			let soldUnits = 0;
			for (const e of events!) {
				if (e.time <= now - secs) break; // newest first
				if (!(e.kind in c)) continue;
				c[e.kind]++;
				if (e.kind === 'sold' && e.buyout && e.buyout > 0) {
					soldCopper += e.buyout;
					soldUnits += e.count;
				}
			}
			const done = c.sold + c.expired;
			return {
				counts: c,
				sellThrough: done ? (c.sold / done) * 100 : null,
				avgSold: soldUnits ? soldCopper / soldUnits : null
			};
		};
		return { d1: win(86400), d7: win(7 * 86400) };
	});

	const hasOwner = $derived(!!auctions?.some((a) => a.owner));
	const change = $derived(pctChange(latest?.market_value ?? null, latest?.mv_14d ?? null));
</script>

<svelte:head>
	<title>{loading ? `Item #${data.id}` : name} · taptoAH</title>
</svelte:head>

<a href={withRealm('/')} class="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
	<ArrowLeft size={14} /> Back to browse
</a>

{#if error}
	<div class="panel mb-4 p-4 text-sm"><b class="text-down">Error:</b> {error}</div>
{/if}

<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
	<div class="flex min-w-0 flex-col gap-4">
		<!-- Header -->
		<section class="panel flex flex-wrap items-start gap-4 p-4">
			{#if loading}
				<div class="skeleton h-14 w-14"></div>
				<div class="flex-1 space-y-2">
					<div class="skeleton h-6 w-64"></div>
					<div class="skeleton h-4 w-40"></div>
				</div>
			{:else}
				<span data-wowhead={wowheadTooltip(data.id)} class="inline-flex"
					><ItemIcon icon={item?.icon} quality={item?.quality} size={56} /></span
				>
				<div class="min-w-0 flex-1">
					<h1 class="text-xl font-bold sm:text-2xl" style="color:{qualityColor(item?.quality)}">
						{name}
					</h1>
					<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
						{#if item}
							{#if item.quality != null}<span style="color:{qualityColor(item.quality)}"
									>{QUALITIES[item.quality]?.name}</span
								>{/if}
							{#if item.class != null}
								<span>{className(item.class)} › {subclassName(item.class, item.subclass)}</span>
							{/if}
							{#if item.inventory_type && INVENTORY_TYPES[item.inventory_type]}
								<span>{INVENTORY_TYPES[item.inventory_type]}</span>
							{/if}
							{#if item.item_level}<span>Item level <b class="num text-ink">{item.item_level}</b></span>{/if}
							{#if item.required_level}<span
									>Requires level <b class="num text-ink">{item.required_level}</b></span
								>{/if}
							{#if item.stackable && item.stackable > 1}<span>Stacks to {item.stackable}</span>{/if}
						{:else}
							<span>Unknown or server-custom item</span>
						{/if}
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
						<span class="text-muted">Vendor sells for <Money value={item?.sell_price || null} /></span>
						<span class="text-dim">#{data.id}</span>
						<a
							href={wowheadUrl(data.id)}
							target="_blank"
							rel="noopener noreferrer external"
							class="inline-flex items-center gap-1 text-accent-2 hover:underline"
						>
							Wowhead <ExternalLink size={13} />
						</a>
					</div>
				</div>
				<div class="text-right text-xs text-muted">
					<div>
						{realmLabel(realm).realm}{#if realmLabel(realm).faction}
							· {realmLabel(realm).faction}{/if}
					</div>
					{#if latest?.seen}
						<div title={absTime(latest.seen)}>Last seen {relativeTime(latest.seen)}</div>
						<div class="text-dim">source: {latest.source === 'scan' ? 'own scan' : 'TSM'}</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Stat tiles -->
		<section class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
			{#snippet tile(label: string, value: number | null | undefined, extra?: number | null)}
				<div class="panel p-3">
					<div class="label">{label}</div>
					<div class="mt-1 text-base font-semibold sm:text-lg">
						{#if loading}<div class="skeleton h-6 w-24"></div>{:else}<Money value={value} />{/if}
					</div>
					{#if extra !== undefined && !loading}<div class="text-xs"><Pct value={extra} /></div>{/if}
				</div>
			{/snippet}
			{@render tile('Min buyout', latest?.min_buyout)}
			{@render tile('Market value', latest?.market_value, change)}
			{@render tile('3-day avg', latest?.mv_3d)}
			{@render tile('14-day avg', latest?.mv_14d)}
			<div class="panel p-3">
				<div class="label">Quantity</div>
				<div class="num mt-1 text-base font-semibold sm:text-lg">
					{#if loading}<div class="skeleton h-6 w-16"></div>{:else}{fmtInt(latest?.quantity)}{/if}
				</div>
				{#if latest?.auctions}<div class="text-xs text-muted">{fmtInt(latest.auctions)} auctions</div>{/if}
			</div>
			<div class="panel p-3">
				<div class="label">Change vs 14d</div>
				<div class="mt-1 text-base font-semibold sm:text-lg">
					{#if loading}<div class="skeleton h-6 w-16"></div>{:else}<Pct value={change} />{/if}
				</div>
				<div class="text-xs text-dim">market value</div>
			</div>
		</section>

		<!-- Chart -->
		<section class="panel p-4">
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<h2 class="font-semibold">Price history</h2>
				<div class="flex flex-wrap items-center gap-1">
					{#each RANGES as r (r.key)}
						<button type="button" class="btn !py-1" aria-pressed={range === r.key} onclick={() => (range = r.key)}
							>{r.key === 'all' ? 'All' : r.key}</button
						>
					{/each}
					<label class="ml-2 flex items-center gap-1.5 text-xs text-muted select-none">
						<input type="checkbox" bind:checked={clip} class="accent-indigo-500" /> Clip outliers
					</label>
				</div>
			</div>
			{#if history === null}
				<div class="skeleton h-[320px] w-full"></div>
			{:else if visible.length === 0}
				<div class="flex h-[200px] items-center justify-center text-sm text-muted">
					No price history in this range{history.length ? '' : ' for this realm'}.
				</div>
			{:else}
				<PriceChart points={visible} {clip} window={chartWindow} />
				{#if visible.every((p) => p.source === 'tsm')}
					<p class="mt-2 text-xs text-dim">
						Daily market values imported from TSM. Min buyout and quantity history start with our own scans.
					</p>
				{/if}
			{/if}
		</section>

		<!-- Weekday heatmap -->
		{#if heat}
			<section class="panel p-4">
				<h2 class="mb-1 font-semibold">Market value by weekday</h2>
				<p class="mb-3 text-xs text-muted">Last 12 weeks, darker = cheaper. Bottom row: weekday median vs overall median.</p>
				<div class="overflow-x-auto">
					<table class="heat text-xs">
						<thead>
							<tr>
								<th></th>
								{#each WEEKDAYS as w (w)}<th>{w}</th>{/each}
							</tr>
						</thead>
						<tbody>
							{#each heat.grid as week, wi (wi)}
								<tr>
									<th class="text-left font-normal text-dim">
										{new Date((heat.startDay + wi * 7) * 86400000).toLocaleDateString('en-US', {
											month: 'short',
											day: 'numeric',
											timeZone: 'UTC'
										})}
									</th>
									{#each week as v, di (di)}
										<td
											style="background:{heatColor(v, heat.min, heat.max)}"
											title={v == null ? 'no data' : moneyText(v)}
											class:empty={v == null}
										></td>
									{/each}
								</tr>
							{/each}
							<tr>
								<th class="text-left font-normal text-dim">avg</th>
								{#each heat.byWeekday as p, i (i)}
									<td class="avg"><Pct value={p} /></td>
								{/each}
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>

	<!-- Right column: current listings -->
	<aside class="flex min-w-0 flex-col gap-4">
		<section class="panel p-4">
			<div class="mb-2 flex items-baseline justify-between">
				<h2 class="font-semibold">Current listings</h2>
				{#if listingStats}<span class="text-xs text-muted"
						>{fmtInt(auctions?.length)} auctions · {fmtInt(listingStats.qty)} items</span
					>{/if}
			</div>
			{#if auctions === null}
				<div class="skeleton h-40 w-full"></div>
			{:else if auctions.length === 0}
				<p class="py-6 text-center text-sm text-muted">
					No listings for this item in the latest scan.
				</p>
			{:else}
				{#if listingStats && listingStats.bins.length}
					<div class="mb-3">
						<div class="flex h-24 items-end gap-[2px]" aria-label="Quantity listed by unit price">
							{#each listingStats.bins as b, i (i)}
								<div
									class="flex-1 rounded-t-sm bg-accent/70 hover:bg-accent"
									style="height:{listingStats.maxQty ? Math.max(2, (b.qty / listingStats.maxQty) * 100) : 0}%"
									title="{moneyText(b.from)}+ : {fmtInt(b.qty)} items"
								></div>
							{/each}
						</div>
						<div class="mt-1 flex justify-between text-[0.6875rem] text-dim">
							<span>{moneyText(listingStats.lo, true)}</span>
							<span>{moneyText(listingStats.hi, true)}+</span>
						</div>
					</div>
				{/if}
				<div class="max-h-[560px] overflow-auto">
					<table class="grid-table">
						<thead>
							<tr>
								<th class="r">Stack</th>
								<th class="r">Unit buyout</th>
								<th class="r hidden sm:table-cell lg:hidden 2xl:table-cell">Total</th>
								<th class="r hidden sm:table-cell lg:hidden 2xl:table-cell">Bid</th>
								<th>Time</th>
								{#if hasOwner}<th>Seller</th>{/if}
							</tr>
						</thead>
						<tbody>
							{#each auctions as a, i (i)}
								<tr>
									<td class="r num">{a.count}</td>
									<td class="r"><Money value={a.unit_buyout || null} /></td>
									<td class="r hidden sm:table-cell lg:hidden 2xl:table-cell"><Money value={a.buyout || null} /></td>
									<td class="r hidden sm:table-cell lg:hidden 2xl:table-cell"><Money value={a.bid} /></td>
									<td class="text-muted" title={a.time_left ? TIME_LEFT[a.time_left]?.hint : ''}
										>{a.time_left ? (TIME_LEFT[a.time_left]?.label ?? a.time_left) : '—'}</td
									>
									{#if hasOwner}<td class="max-w-[8rem] truncate text-muted" title={a.owner ?? ''}
											>{a.owner ?? '—'}</td
										>{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="panel p-4">
			<h2 class="mb-2 font-semibold">Sales</h2>
			{#if events === undefined}
				<div class="skeleton h-32 w-full"></div>
			{:else if events === null}
				<p class="py-4 text-center text-sm text-muted">Sales data is not available yet.</p>
			{:else if events.length === 0 || !sales}
				<p class="py-4 text-center text-sm text-muted">
					No listings of this item appeared or disappeared in the last 90 days.
				</p>
			{:else}
				<table class="grid-table mb-3">
					<thead>
						<tr><th></th><th class="r">24h</th><th class="r">7d</th></tr>
					</thead>
					<tbody>
						{#each KINDS as k (k.kind)}
							<tr>
								<td class={k.cls}>{k.label}</td>
								<td class="r num">{fmtInt(sales.d1.counts[k.kind])}</td>
								<td class="r num">{fmtInt(sales.d7.counts[k.kind])}</td>
							</tr>
						{/each}
						<tr>
							<td title="Sold / (sold + expired)">Sell-through</td>
							<td class="r num">{sales.d1.sellThrough == null ? '—' : `${sales.d1.sellThrough.toFixed(0)}%`}</td>
							<td class="r num">{sales.d7.sellThrough == null ? '—' : `${sales.d7.sellThrough.toFixed(0)}%`}</td>
						</tr>
						<tr>
							<td>Avg sold / unit</td>
							<td class="r"><Money value={sales.d1.avgSold} /></td>
							<td class="r"><Money value={sales.d7.avgSold} /></td>
						</tr>
					</tbody>
				</table>
				<h3 class="label mb-1">Latest events</h3>
				<div class="max-h-[360px] overflow-auto">
					<table class="grid-table">
						<thead>
							<tr>
								<th>When</th>
								<th></th>
								<th>Seller</th>
								<th class="r">Qty</th>
								<th class="r">Unit</th>
							</tr>
						</thead>
						<tbody>
							{#each events.slice(0, 50) as e, i (i)}
								{@const k = KINDS.find((x) => x.kind === e.kind)}
								<tr>
									<td class="text-muted" title={absTime(e.time)}>{relativeTime(e.time)}</td>
									<td class={k?.cls ?? ''}>{k?.label ?? e.kind}</td>
									<td class="max-w-[7rem] truncate text-muted" title={e.owner ?? ''}>{e.owner ?? '—'}</td>
									<td class="r num">{e.count}</td>
									<td class="r"><Money value={e.buyout && e.count ? e.buyout / e.count : null} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="mt-2 text-xs text-dim">
					From listings that appeared or disappeared between scans. A listing that disappears before it
					expires counts as sold, which also covers cancelled ones, so sell-through is an upper bound.
				</p>
			{/if}
		</section>
	</aside>
</div>

<style>
	.heat {
		border-collapse: separate;
		border-spacing: 3px;
	}
	.heat th {
		color: var(--color-muted);
		font-weight: 500;
		padding: 0 0.25rem;
		white-space: nowrap;
	}
	.heat td {
		width: 2.4rem;
		height: 1.35rem;
		border-radius: 3px;
	}
	.heat td.empty {
		background: repeating-linear-gradient(
			45deg,
			transparent 0 3px,
			rgba(255, 255, 255, 0.04) 3px 6px
		) !important;
	}
	.heat td.avg {
		text-align: center;
		font-size: 0.625rem;
		height: auto;
	}
</style>
