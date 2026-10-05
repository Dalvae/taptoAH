<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import Tag from '@lucide/svelte/icons/tag';
	import Coins from '@lucide/svelte/icons/coins';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { getRealmRows, getVendorFlips, type Row, type VendorFlips } from '#lib/data.ts';
	import { currentRealm, withRealm } from '#lib/realm.svelte.ts';
	import { fmtInt } from '#lib/format.ts';
	import Money from '#lib/components/Money.svelte';
	import Pct from '#lib/components/Pct.svelte';
	import ItemName from '#lib/components/ItemName.svelte';
	import SellerLink from '#lib/components/SellerLink.svelte';

	const realm = $derived(currentRealm());
	let rows = $state<Row[] | null>(null);
	let error = $state('');
	/** undefined = loading; null = failed (falls back to latest.min_buyout) */
	let flips = $state<VendorFlips | null | undefined>(undefined);

	$effect(() => {
		const r = realm;
		if (!r) return;
		let cancelled = false;
		rows = null;
		error = '';
		getRealmRows(r)
			.then((d) => !cancelled && (rows = d))
			.catch((e) => !cancelled && (error = e instanceof Error ? e.message : String(e)));
		flips = undefined;
		getVendorFlips(r)
			.then((d) => !cancelled && (flips = d))
			.catch(() => !cancelled && (flips = null));
		return () => (cancelled = true);
	});

	function num(v: string | null, d: number): number {
		const n = v == null || v === '' ? NaN : Number(v);
		return Number.isFinite(n) && n >= 0 ? n : d;
	}

	const DEFAULTS = { min_qty: 10, min_price: 1, deal_pct: 50, limit: 25 };
	const p = $derived({
		minQty: num(page.url.searchParams.get('min_qty'), DEFAULTS.min_qty),
		minPrice: num(page.url.searchParams.get('min_price'), DEFAULTS.min_price),
		dealPct: Math.min(100, num(page.url.searchParams.get('deal_pct'), DEFAULTS.deal_pct)),
		limit: Math.min(200, Math.max(5, num(page.url.searchParams.get('limit'), DEFAULTS.limit)))
	});

	function setParam(key: keyof typeof DEFAULTS, value: string) {
		const u = new URL(page.url.href);
		if (value === '' || Number(value) === DEFAULTS[key]) u.searchParams.delete(key);
		else u.searchParams.set(key, value);
		goto(u.pathname + u.search, { replace: true, reset: false });
	}

	const eligible = $derived(
		(rows ?? []).filter(
			(r) =>
				r.change != null &&
				(r.quantity ?? 0) >= p.minQty &&
				(r.market_value ?? 0) >= p.minPrice * 10000
		)
	);
	const risers = $derived(
		eligible
			.filter((r) => r.change! > 0)
			.sort((a, b) => b.change! - a.change!)
			.slice(0, p.limit)
	);
	const fallers = $derived(
		eligible
			.filter((r) => r.change! < 0)
			.sort((a, b) => a.change! - b.change!)
			.slice(0, p.limit)
	);

	type Deal = Row & { ratio: number };
	const deals = $derived(
		(rows ?? [])
			.filter(
				(r) =>
					r.min_buyout != null &&
					r.min_buyout > 0 &&
					r.market_value != null &&
					r.market_value >= p.minPrice * 10000 &&
					(r.quantity ?? 0) > 0
			)
			.map((r) => ({ ...r, ratio: (r.min_buyout! / r.market_value!) * 100 }) as Deal)
			.filter((r) => r.ratio < p.dealPct)
			.sort((a, b) => a.ratio - b.ratio)
			.slice(0, p.limit)
	);

	// Auction-level vendor flips when the realm has current auctions, else latest.min_buyout below vendor.
	const auctionLevel = $derived(!!flips && flips.total > 0);
	const topFlips = $derived(
		flips ? [...flips.flips].sort((a, b) => b.profit - a.profit).slice(0, p.limit) : []
	);

	type VendorDeal = Row & { profit: number };
	const vendor = $derived(
		(rows ?? [])
			.filter(
				(r) =>
					r.min_buyout != null &&
					r.min_buyout > 0 &&
					r.sell_price != null &&
					r.sell_price > r.min_buyout &&
					(r.quantity ?? 0) > 0
			)
			.map((r) => ({ ...r, profit: r.sell_price! - r.min_buyout! }) as VendorDeal)
			.sort((a, b) => b.profit - a.profit)
			.slice(0, p.limit)
	);
</script>

<svelte:head>
	<title>Movers & Deals · taptoAH</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold">Movers &amp; Deals</h1>
		<p class="text-sm text-muted">
			Market value vs its 14-day average, and listings priced far below value.
		</p>
	</div>
	<div class="panel flex flex-wrap items-end gap-3 p-3 text-sm">
		<label class="flex flex-col gap-1">
			<span class="label">Min quantity</span>
			<input
				class="input num w-24"
				type="number"
				min="0"
				value={p.minQty}
				onchange={(e) => setParam('min_qty', e.currentTarget.value)}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="label">Min value (gold)</span>
			<input
				class="input num w-24"
				type="number"
				min="0"
				step="any"
				value={p.minPrice}
				onchange={(e) => setParam('min_price', e.currentTarget.value)}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="label">Deal below % of value</span>
			<input
				class="input num w-24"
				type="number"
				min="1"
				max="100"
				value={p.dealPct}
				onchange={(e) => setParam('deal_pct', e.currentTarget.value)}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span class="label">Show</span>
			<select
				class="input"
				value={p.limit}
				onchange={(e) => setParam('limit', e.currentTarget.value)}
			>
				{#each [10, 25, 50, 100] as n (n)}<option value={n}>{n}</option>{/each}
			</select>
		</label>
	</div>
</div>

{#if error}
	<div class="panel mb-4 p-4 text-sm"><b class="text-down">Failed to load data:</b> {error}</div>
{/if}

{#snippet emptyOrLoading(colspan: number, msg: string)}
	{#if rows === null && !error}
		{#each Array(6) as _, i (i)}
			<tr><td {colspan}><div class="skeleton h-6 w-full"></div></td></tr>
		{/each}
	{:else}
		<tr><td {colspan} class="py-8 text-center text-muted">{msg}</td></tr>
	{/if}
{/snippet}

{#snippet moverTable(list: Row[], empty: string)}
	<div class="overflow-x-auto">
		<table class="grid-table">
			<thead>
				<tr>
					<th>Item</th>
					<th class="r">Market</th>
					<th class="r hidden sm:table-cell">14d avg</th>
					<th class="r hidden md:table-cell">Qty</th>
					<th class="r">Change</th>
				</tr>
			</thead>
			<tbody>
				{#if list.length === 0}
					{@render emptyOrLoading(5, empty)}
				{:else}
					{#each list as r (r.item_id)}
						<tr>
							<td class="max-w-[12rem] sm:max-w-[18rem]"><ItemName item={r} size={22} /></td>
							<td class="r"><Money value={r.market_value} /></td>
							<td class="r hidden sm:table-cell"><Money value={r.mv_14d} /></td>
							<td class="r num hidden md:table-cell">{fmtInt(r.quantity)}</td>
							<td class="r"><Pct value={r.change} /></td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
{/snippet}

<div class="grid gap-4 xl:grid-cols-2">
	<section class="panel overflow-hidden">
		<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
			<TrendingUp size={18} class="text-up" /> Biggest risers
			<span class="ml-auto text-xs font-normal text-muted">{fmtInt(eligible.length)} eligible items</span>
		</h2>
		{@render moverTable(risers, 'No risers with these thresholds.')}
	</section>

	<section class="panel overflow-hidden">
		<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
			<TrendingDown size={18} class="text-down" /> Biggest fallers
		</h2>
		{@render moverTable(fallers, 'No fallers with these thresholds.')}
	</section>

	<section class="panel overflow-hidden">
		<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
			<Tag size={18} class="text-accent-2" /> Deals: min buyout under {p.dealPct}% of market value
		</h2>
		<div class="overflow-x-auto">
			<table class="grid-table">
				<thead>
					<tr>
						<th>Item</th>
						<th class="r">Min buyout</th>
						<th class="r hidden sm:table-cell">Market</th>
						<th class="r hidden md:table-cell">Qty</th>
						<th class="r">% of value</th>
					</tr>
				</thead>
				<tbody>
					{#if deals.length === 0}
						{@render emptyOrLoading(5, 'No deals right now.')}
					{:else}
						{#each deals as r (r.item_id)}
							<tr>
								<td class="max-w-[12rem] sm:max-w-[18rem]"><ItemName item={r} size={22} /></td>
								<td class="r"><Money value={r.min_buyout} /></td>
								<td class="r hidden sm:table-cell"><Money value={r.market_value} /></td>
								<td class="r num hidden md:table-cell">{fmtInt(r.quantity)}</td>
								<td class="r num text-up">{r.ratio.toFixed(r.ratio < 10 ? 1 : 0)}%</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	</section>

	<section class="panel overflow-hidden">
		<h2 class="flex items-center gap-2 border-b border-line px-4 py-3 font-semibold">
			<Coins size={18} class="text-gold" /> Listed below vendor price
			<a
				href={withRealm('/vendor')}
				class="ml-auto inline-flex items-center gap-1 text-xs font-normal text-accent-2 hover:underline"
				>All vendor flips <ArrowRight size={13} /></a
			>
		</h2>
		{#if flips === undefined}
			<div class="overflow-x-auto">
				<table class="grid-table">
					<tbody>
						{#each Array(6) as _, i (i)}
							<tr><td><div class="skeleton h-6 w-full"></div></td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if auctionLevel}
			<div class="overflow-x-auto">
				<table class="grid-table">
					<thead>
						<tr>
							<th>Item</th>
							<th class="hidden md:table-cell">Seller</th>
							<th class="r">Buyout</th>
							<th class="r hidden sm:table-cell">Vendor value</th>
							<th class="r">Profit</th>
						</tr>
					</thead>
					<tbody>
						{#if topFlips.length === 0}
							<tr>
								<td colspan="5" class="py-8 text-center text-muted">
									Nothing on the AH right now sells for less than its vendor price.
								</td>
							</tr>
						{:else}
							{#each topFlips as r, i (i)}
								<tr>
									<td class="max-w-[12rem] sm:max-w-[18rem]">
										<ItemName item={r} size={22} />{#if r.count > 1}<span class="num ml-1 text-xs text-dim"
												>×{r.count}</span
											>{/if}
									</td>
									<td class="hidden max-w-[8rem] truncate text-muted md:table-cell"><SellerLink name={r.owner} /></td>
									<td class="r"><Money value={r.cost} /></td>
									<td class="r hidden sm:table-cell"><Money value={r.vendor} /></td>
									<td class="r"><Money value={r.profit} /></td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
			<p class="border-t border-line px-4 py-2 text-xs text-dim">
				Single auctions whose buyout is below the vendor price × stack, from the latest scan.
				{fmtInt(flips?.flips.length)} in total; see
				<a href={withRealm('/vendor')} class="text-accent-2 hover:underline">Vendor flips</a> for filters.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="grid-table">
					<thead>
						<tr>
							<th>Item</th>
							<th class="r">Min buyout</th>
							<th class="r hidden sm:table-cell">Vendor</th>
							<th class="r hidden md:table-cell">Qty</th>
							<th class="r">Profit / unit</th>
						</tr>
					</thead>
					<tbody>
						{#if vendor.length === 0}
							{@render emptyOrLoading(5, 'Nothing is listed below its vendor price.')}
						{:else}
							{#each vendor as r (r.item_id)}
								<tr>
									<td class="max-w-[12rem] sm:max-w-[18rem]"><ItemName item={r} size={22} /></td>
									<td class="r"><Money value={r.min_buyout} /></td>
									<td class="r hidden sm:table-cell"><Money value={r.sell_price} /></td>
									<td class="r num hidden md:table-cell">{fmtInt(r.quantity)}</td>
									<td class="r"><Money value={r.profit} /></td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
			<p class="border-t border-line px-4 py-2 text-xs text-dim">
				Vendor price is what a merchant pays you. Minimum buyout comes from the latest data, so the
				cheapest listing may already be gone.
			</p>
		{/if}
	</section>
</div>
