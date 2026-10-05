<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Coins from '@lucide/svelte/icons/coins';
	import Gavel from '@lucide/svelte/icons/gavel';
	import { getVendorFlips, type VendorFlips, type VendorFlip } from '#lib/data.ts';
	import { currentRealm } from '#lib/realm.svelte.ts';
	import { TIME_LEFT } from '#lib/wow.ts';
	import { fmtInt, relativeTime, absTime } from '#lib/format.ts';
	import Money from '#lib/components/Money.svelte';
	import ItemName from '#lib/components/ItemName.svelte';

	// ---- data -----------------------------------------------------------------------------------
	const realm = $derived(currentRealm());
	let data = $state<VendorFlips | null>(null);
	let error = $state('');

	$effect(() => {
		const r = realm;
		if (!r) return;
		let cancelled = false;
		data = null;
		error = '';
		getVendorFlips(r)
			.then((d) => !cancelled && (data = d))
			.catch((e) => !cancelled && (error = e instanceof Error ? e.message : String(e)));
		return () => (cancelled = true);
	});

	// ---- URL state ------------------------------------------------------------------------------
	type SortKey = 'name' | 'owner' | 'count' | 'cost' | 'vendor' | 'profit' | 'roi' | 'time_left' | 'seen';
	const SORT_KEYS: SortKey[] = ['name', 'owner', 'count', 'cost', 'vendor', 'profit', 'roi', 'time_left', 'seen'];
	const PER = 100;

	function num(v: string | null): number | null {
		if (v == null || v.trim() === '') return null;
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? n : null;
	}

	const f = $derived.by(() => {
		const sp = page.url.searchParams;
		const sort = sp.get('sort') as SortKey | null;
		return {
			q: sp.get('q') ?? '',
			minProfit: num(sp.get('min_profit')),
			minRoi: num(sp.get('min_roi')),
			maxBuyout: num(sp.get('max_buyout')),
			sort: sort && SORT_KEYS.includes(sort) ? sort : ('profit' as SortKey),
			dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
			page: Math.max(1, num(sp.get('page')) ?? 1)
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
		if (document.activeElement?.id !== 'vendor-q') qInput = fromUrl;
	});
	function onQ() {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => setParams({ q: qInput.trim() }), 180);
	}

	function sortBy(key: SortKey) {
		if (f.sort === key) setParams({ sort: key, dir: f.dir === 'desc' ? 'asc' : 'desc' });
		else setParams({ sort: key, dir: key === 'name' || key === 'owner' || key === 'cost' ? 'asc' : 'desc' });
	}

	const activeFilterCount = $derived(
		[f.q, f.minProfit != null, f.minRoi != null, f.maxBuyout != null].filter(Boolean).length
	);

	function resetFilters() {
		qInput = '';
		setParams({ q: null, min_profit: null, min_roi: null, max_buyout: null });
	}

	// ---- filtering / sorting --------------------------------------------------------------------
	function applyFilters(list: VendorFlip[]): VendorFlip[] {
		const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
		const minProfit = f.minProfit != null ? f.minProfit * 10000 : null;
		const maxCost = f.maxBuyout != null ? f.maxBuyout * 10000 : null;
		return list.filter((r) => {
			if (
				tokens.length &&
				!tokens.every(
					(t) => r.search.includes(t) || String(r.item_id) === t || !!r.owner?.toLowerCase().includes(t)
				)
			)
				return false;
			if (minProfit != null && r.profit < minProfit) return false;
			if (f.minRoi != null && r.roi < f.minRoi) return false;
			if (maxCost != null && r.cost > maxCost) return false;
			return true;
		});
	}

	function sortValue(r: VendorFlip, key: SortKey): number | string | null {
		if (key === 'name') return r.search;
		if (key === 'owner') return r.owner?.toLowerCase() ?? null;
		return r[key];
	}

	function sortList(list: VendorFlip[]): VendorFlip[] {
		const key = f.sort;
		const dir = f.dir === 'asc' ? 1 : -1;
		return [...list].sort((a, b) => {
			const va = sortValue(a, key);
			const vb = sortValue(b, key);
			if (va == null && vb == null) return b.profit - a.profit;
			if (va == null) return 1;
			if (vb == null) return -1;
			if (va < vb) return -dir;
			if (va > vb) return dir;
			return b.profit - a.profit;
		});
	}

	const flips = $derived(sortList(applyFilters(data?.flips ?? [])));
	const bids = $derived(
		applyFilters(data?.bids ?? [])
			.sort((a, b) => b.profit - a.profit)
			.slice(0, 50)
	);
	const totals = $derived(
		flips.reduce((t, r) => ({ cost: t.cost + r.cost, profit: t.profit + r.profit }), { cost: 0, profit: 0 })
	);

	const pageCount = $derived(Math.max(1, Math.ceil(flips.length / PER)));
	const curPage = $derived(Math.min(f.page, pageCount));
	const pageRows = $derived(flips.slice((curPage - 1) * PER, curPage * PER));

	type Col = { key: SortKey; label: string; right?: boolean; cls?: string; title?: string };
	const cols: Col[] = [
		{ key: 'name', label: 'Item' },
		{ key: 'owner', label: 'Seller', cls: 'hidden sm:table-cell' },
		{ key: 'count', label: 'Stack', right: true, cls: 'hidden sm:table-cell' },
		{ key: 'cost', label: 'Buyout', right: true },
		{ key: 'vendor', label: 'Vendor value', right: true, cls: 'hidden md:table-cell', title: 'Vendor price × stack' },
		{ key: 'profit', label: 'Profit', right: true },
		{ key: 'roi', label: 'ROI', right: true, cls: 'hidden sm:table-cell', title: 'Profit / buyout' },
		{ key: 'time_left', label: 'Time left', cls: 'hidden lg:table-cell' },
		{ key: 'seen', label: 'Seen', right: true, cls: 'hidden lg:table-cell', title: 'When the scan saw it' }
	];

	function roiText(p: number): string {
		return `${p >= 1000 ? fmtInt(p) : p.toFixed(p >= 100 ? 0 : 1)}%`;
	}
	function filterInput(key: string, e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		setParams({ [key]: v === '' ? null : v });
	}
</script>

<svelte:head>
	<title>Vendor flips · taptoAH</title>
</svelte:head>

{#snippet timeLeft(t: number | null)}
	<span class:text-down={t === 1} title={t ? TIME_LEFT[t]?.hint : ''}
		>{t ? (TIME_LEFT[t]?.label ?? t) : '—'}</span
	>
{/snippet}

{#snippet filterNum(label: string, key: string, value: number | null, placeholder: string)}
	<label class="flex flex-col gap-1">
		<span class="label">{label}</span>
		<input
			class="input num w-24"
			type="number"
			min="0"
			step="any"
			{placeholder}
			{value}
			onchange={(e) => filterInput(key, e)}
		/>
	</label>
{/snippet}

<div class="mb-4 flex flex-wrap items-end justify-between gap-3">
	<div class="max-w-2xl">
		<h1 class="flex items-center gap-2 text-2xl font-bold"><Coins size={22} class="text-gold" /> Vendor flips</h1>
		<p class="text-sm text-muted">
			Auctions on the AH right now whose buyout is below what a vendor pays for the stack. Buy, then
			sell to any merchant. This is only a list: nothing is bought automatically, and a listing may be
			gone by the time you get there.
		</p>
	</div>
	<div class="panel flex flex-wrap items-end gap-3 p-3 text-sm">
		<label class="flex flex-col gap-1">
			<span class="label">Search</span>
			<input
				id="vendor-q"
				class="input w-44"
				type="search"
				placeholder="Item, id or seller…"
				aria-label="Filter by item, id or seller"
				bind:value={qInput}
				oninput={onQ}
			/>
		</label>
		{@render filterNum('Min profit (gold)', 'min_profit', f.minProfit, 'any')}
		{@render filterNum('Min ROI %', 'min_roi', f.minRoi, 'any')}
		{@render filterNum('Max buyout (gold)', 'max_buyout', f.maxBuyout, 'no limit')}
		{#if activeFilterCount}
			<button type="button" class="btn" onclick={resetFilters}>Clear ({activeFilterCount})</button>
		{/if}
	</div>
</div>

{#if error}
	<div class="panel mb-4 p-4 text-sm"><b class="text-down">Failed to load data:</b> {error}</div>
{/if}

<section class="panel mb-4 overflow-hidden">
	<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
		<span class="text-muted">
			{#if data}
				<b class="num text-ink">{fmtInt(flips.length)}</b> flips
				<span class="text-dim">in {fmtInt(data.total)} auctions</span>
			{:else if !error}
				Loading auctions…
			{/if}
		</span>
		{#if flips.length}
			<span class="flex flex-wrap items-center gap-x-3 text-xs text-muted">
				<span>Buy all: <Money value={totals.cost} /></span>
				<span>Profit: <Money value={totals.profit} /></span>
			</span>
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
				{#if !data && !error}
					{#each Array(10) as _, i (i)}
						<tr><td colspan={cols.length}><div class="skeleton h-6 w-full"></div></td></tr>
					{/each}
				{:else if data && pageRows.length === 0}
					<tr>
						<td colspan={cols.length} class="py-10 text-center whitespace-normal text-muted">
							{#if data.total === 0}
								No auction-level data for this realm yet. This list fills in after the next in-game scan.
							{:else if data.flips.length === 0}
								Nothing on the AH right now sells for less than its vendor price.
							{:else}
								No flips match these filters.
								<button type="button" class="ml-2 text-accent underline" onclick={resetFilters}
									>Clear filters</button
								>
							{/if}
						</td>
					</tr>
				{:else}
					{#each pageRows as r, i (i)}
						<tr>
							<td class="item-cell">
								<ItemName item={r} size={22} />
								<div class="text-xs text-dim sm:hidden">
									{r.count > 1 ? `${r.count}× · ` : ''}{r.owner ?? ''}
								</div>
							</td>
							<td class="hidden max-w-[9rem] truncate text-muted sm:table-cell" title={r.owner ?? ''}
								>{r.owner ?? '—'}</td
							>
							<td class="r num hidden sm:table-cell">{r.count}</td>
							<td class="r"><Money value={r.cost} /></td>
							<td class="r hidden md:table-cell"><Money value={r.vendor} /></td>
							<td class="r font-semibold">
								<Money value={r.profit} />
								<div class="num text-xs font-normal text-up sm:hidden">{roiText(r.roi)}</div>
							</td>
							<td class="r num hidden text-up sm:table-cell">{roiText(r.roi)}</td>
							<td class="hidden text-muted lg:table-cell">{@render timeLeft(r.time_left)}</td>
							<td class="r hidden text-muted lg:table-cell" title={absTime(r.seen)}
								>{r.seen ? relativeTime(r.seen) : '—'}</td
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
				{fmtInt((curPage - 1) * PER + 1)}–{fmtInt(Math.min(curPage * PER, flips.length))} of {fmtInt(
					flips.length
				)}
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
		Vendor value is the merchant price × stack size. ROI is profit divided by the buyout. Listings come
		from the latest scan that covered each item; red time left means under 30 minutes.
	</p>
</section>

{#if bids.length}
	<section class="panel overflow-hidden">
		<h2 class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 font-semibold">
			<Gavel size={18} class="text-accent-2" /> Bid opportunities
			<span class="text-xs font-normal text-muted"
				>no profitable buyout, but the next bid is below vendor value</span
			>
		</h2>
		<div class="overflow-x-auto">
			<table class="grid-table">
				<thead>
					<tr>
						<th>Item</th>
						<th class="hidden sm:table-cell">Seller</th>
						<th class="r hidden sm:table-cell">Stack</th>
						<th class="r" title="Current bid + 5% minimum increment">Next bid</th>
						<th class="r hidden md:table-cell">Buyout</th>
						<th class="r hidden md:table-cell">Vendor value</th>
						<th class="r">Profit if won</th>
						<th class="hidden lg:table-cell">Time left</th>
					</tr>
				</thead>
				<tbody>
					{#each bids as r, i (i)}
						<tr>
							<td class="item-cell"><ItemName item={r} size={22} /></td>
							<td class="hidden max-w-[9rem] truncate text-muted sm:table-cell" title={r.owner ?? ''}
								>{r.owner ?? '—'}</td
							>
							<td class="r num hidden sm:table-cell">{r.count}</td>
							<td class="r"><Money value={r.cost} /></td>
							<td class="r hidden md:table-cell"><Money value={r.buyout || null} /></td>
							<td class="r hidden md:table-cell"><Money value={r.vendor} /></td>
							<td class="r"><Money value={r.profit} /></td>
							<td class="hidden text-muted lg:table-cell">{@render timeLeft(r.time_left)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="border-t border-line px-4 py-2 text-xs text-dim">
			A bid only pays off if nobody outbids you before the auction ends. Shows the top 50 by profit.
		</p>
	</section>
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
</style>
