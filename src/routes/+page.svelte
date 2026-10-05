<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getRealmRows, type Row } from '#lib/data.ts';
	import { currentRealm, withRealm } from '#lib/realm.svelte.ts';
	import { QUALITIES, className, subclassName } from '#lib/wow.ts';
	import { fmtInt, relativeTime, absTime } from '#lib/format.ts';
	import Money from '#lib/components/Money.svelte';
	import Pct from '#lib/components/Pct.svelte';
	import ItemName from '#lib/components/ItemName.svelte';

	// ---- data -----------------------------------------------------------------------------------
	const realm = $derived(currentRealm());
	let rows = $state<Row[] | null>(null);
	let error = $state('');

	$effect(() => {
		const r = realm;
		if (!r) return;
		let cancelled = false;
		rows = null;
		error = '';
		getRealmRows(r)
			.then((data) => {
				if (!cancelled) rows = data;
			})
			.catch((e) => {
				if (!cancelled) error = e instanceof Error ? e.message : String(e);
			});
		return () => (cancelled = true);
	});

	// ---- URL state ------------------------------------------------------------------------------
	type SortKey =
		| 'name'
		| 'class'
		| 'item_level'
		| 'required_level'
		| 'market_value'
		| 'min_buyout'
		| 'quantity'
		| 'mv_3d'
		| 'mv_14d'
		| 'change'
		| 'sell_price'
		| 'seen';

	const SORT_KEYS: SortKey[] = [
		'name',
		'class',
		'item_level',
		'required_level',
		'market_value',
		'min_buyout',
		'quantity',
		'mv_3d',
		'mv_14d',
		'change',
		'sell_price',
		'seen'
	];
	const PAGE_SIZES = [25, 50, 100, 200];

	function num(v: string | null): number | null {
		if (v == null || v.trim() === '') return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}

	const f = $derived.by(() => {
		const sp = page.url.searchParams;
		const sort = sp.get('sort') as SortKey | null;
		const per = num(sp.get('per'));
		return {
			q: sp.get('q') ?? '',
			qualities: (sp.get('quality') ?? '')
				.split(',')
				.filter((x) => x !== '')
				.map(Number),
			cls: num(sp.get('class')),
			sub: num(sp.get('sub')),
			ilvlMin: num(sp.get('ilvl_min')),
			ilvlMax: num(sp.get('ilvl_max')),
			reqMin: num(sp.get('req_min')),
			reqMax: num(sp.get('req_max')),
			priceMin: num(sp.get('price_min')),
			priceMax: num(sp.get('price_max')),
			onah: sp.get('onah') === '1',
			sort: sort && SORT_KEYS.includes(sort) ? sort : ('market_value' as SortKey),
			dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
			page: Math.max(1, num(sp.get('page')) ?? 1),
			per: per && PAGE_SIZES.includes(per) ? per : 50
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

	// Text search: local value, debounced into the URL.
	let qInput = $state(page.url.searchParams.get('q') ?? '');
	let qTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		// keep the box in sync when the URL changes from elsewhere (header search, back button)
		const fromUrl = f.q;
		if (document.activeElement?.id !== 'browse-q') qInput = fromUrl;
	});
	function onQ() {
		clearTimeout(qTimer);
		qTimer = setTimeout(() => setParams({ q: qInput.trim() }), 180);
	}

	function toggleQuality(q: number) {
		const s = new Set(f.qualities);
		if (s.has(q)) s.delete(q);
		else s.add(q);
		setParams({ quality: [...s].sort().join(',') });
	}

	function sortBy(key: SortKey) {
		if (f.sort === key) setParams({ sort: key, dir: f.dir === 'desc' ? 'asc' : 'desc' });
		else setParams({ sort: key, dir: key === 'name' || key === 'class' ? 'asc' : 'desc' });
	}

	function resetFilters() {
		qInput = '';
		const u = new URL(page.url.href);
		for (const k of [...u.searchParams.keys()]) if (k !== 'realm') u.searchParams.delete(k);
		goto(u.pathname + u.search, { replace: true, reset: false });
	}

	const activeFilterCount = $derived(
		[
			f.q,
			f.qualities.length,
			f.cls != null,
			f.ilvlMin != null || f.ilvlMax != null,
			f.reqMin != null || f.reqMax != null,
			f.priceMin != null || f.priceMax != null,
			f.onah
		].filter(Boolean).length
	);

	// ---- filtering / sorting --------------------------------------------------------------------
	const preCategory = $derived.by(() => {
		if (!rows) return [];
		const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
		const qs = f.qualities.length ? new Set(f.qualities) : null;
		const pMin = f.priceMin != null ? f.priceMin * 10000 : null;
		const pMax = f.priceMax != null ? f.priceMax * 10000 : null;
		return rows.filter((r) => {
			if (tokens.length && !tokens.every((t) => r.search.includes(t) || String(r.item_id) === t))
				return false;
			if (qs && (r.quality == null || !qs.has(r.quality))) return false;
			if (f.ilvlMin != null && (r.item_level ?? -1) < f.ilvlMin) return false;
			if (f.ilvlMax != null && (r.item_level ?? Infinity) > f.ilvlMax) return false;
			if (f.reqMin != null && (r.required_level ?? -1) < f.reqMin) return false;
			if (f.reqMax != null && (r.required_level ?? Infinity) > f.reqMax) return false;
			if (pMin != null && (r.market_value ?? -1) < pMin) return false;
			if (pMax != null && (r.market_value ?? Infinity) > pMax) return false;
			if (f.onah && !(r.quantity && r.quantity > 0)) return false;
			return true;
		});
	});

	const filtered = $derived(
		f.cls == null
			? preCategory
			: preCategory.filter(
					(r) =>
						(f.cls === -1 ? r.class == null : r.class === f.cls) &&
						(f.sub == null || r.subclass === f.sub)
				)
	);

	/** Category tree with counts (counts respect every filter except the category itself). */
	const tree = $derived.by(() => {
		const m = new Map<number, { count: number; subs: Map<number, number> }>();
		let unknown = 0;
		for (const r of preCategory) {
			if (r.class == null) {
				unknown++;
				continue;
			}
			let c = m.get(r.class);
			if (!c) m.set(r.class, (c = { count: 0, subs: new Map() }));
			c.count++;
			if (r.subclass != null) c.subs.set(r.subclass, (c.subs.get(r.subclass) ?? 0) + 1);
		}
		const classes = [...m.entries()]
			.sort((a, b) => className(a[0]).localeCompare(className(b[0])))
			.map(([id, c]) => ({
				id,
				count: c.count,
				subs: [...c.subs.entries()]
					.sort((a, b) => a[0] - b[0])
					.map(([sid, n]) => ({ id: sid, count: n }))
			}));
		return { classes, unknown };
	});

	function sortValue(r: Row, key: SortKey): number | string | null {
		switch (key) {
			case 'name':
				return r.search;
			case 'class':
				return r.class == null
					? null
					: `${className(r.class)} ${subclassName(r.class, r.subclass)}`;
			default:
				return r[key] as number | null;
		}
	}

	const sorted = $derived.by(() => {
		const key = f.sort;
		const dir = f.dir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			const va = sortValue(a, key);
			const vb = sortValue(b, key);
			if (va == null && vb == null) return a.item_id - b.item_id;
			if (va == null) return 1; // nulls always last
			if (vb == null) return -1;
			if (va < vb) return -dir;
			if (va > vb) return dir;
			return a.item_id - b.item_id;
		});
	});

	const pageCount = $derived(Math.max(1, Math.ceil(sorted.length / f.per)));
	const curPage = $derived(Math.min(f.page, pageCount));
	const pageRows = $derived(sorted.slice((curPage - 1) * f.per, curPage * f.per));

	let sidebarOpen = $state(false);
	let moreFilters = $state(false);

	type Col = { key: SortKey; label: string; right?: boolean; cls?: string; title?: string };
	const cols: Col[] = [
		{ key: 'name', label: 'Item' },
		{ key: 'class', label: 'Category', cls: 'hidden 2xl:table-cell' },
		{ key: 'item_level', label: 'iLvl', right: true, cls: 'hidden md:table-cell' },
		{
			key: 'required_level',
			label: 'Req',
			right: true,
			cls: 'hidden lg:table-cell',
			title: 'Required level'
		},
		{ key: 'market_value', label: 'Market value', right: true },
		{ key: 'min_buyout', label: 'Min buyout', right: true, cls: 'hidden sm:table-cell' },
		{ key: 'quantity', label: 'Qty', right: true },
		{ key: 'mv_3d', label: '3d avg', right: true, cls: 'hidden xl:table-cell' },
		{ key: 'mv_14d', label: '14d avg', right: true, cls: 'hidden lg:table-cell' },
		{
			key: 'change',
			label: 'Δ 14d',
			right: true,
			cls: 'hidden md:table-cell',
			title: 'Market value vs 14-day average'
		},
		{ key: 'sell_price', label: 'Vendor', right: true, cls: 'hidden 2xl:table-cell' },
		{ key: 'seen', label: 'Seen', right: true, cls: 'hidden 2xl:table-cell' }
	];

	function rangeInput(key: string, e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		setParams({ [key]: v === '' ? null : v });
	}

	function rowClick(e: MouseEvent, id: number) {
		if ((e.target as HTMLElement).closest('a')) return;
		goto(withRealm(`/item/${id}`));
	}
</script>

<svelte:head>
	<title>Browse · taptoAH</title>
</svelte:head>

{#snippet range(
	label: string,
	kMin: string,
	kMax: string,
	vMin: number | null,
	vMax: number | null,
	step: string
)}
	<div class="flex flex-col gap-1">
		<span class="label">{label}</span>
		<div class="flex items-center gap-1">
			<input
				class="input num w-20"
				type="number"
				min="0"
				{step}
				placeholder="min"
				aria-label="{label} minimum"
				value={vMin ?? ''}
				onchange={(e) => rangeInput(kMin, e)}
			/>
			<span class="text-dim">–</span>
			<input
				class="input num w-20"
				type="number"
				min="0"
				{step}
				placeholder="max"
				aria-label="{label} maximum"
				value={vMax ?? ''}
				onchange={(e) => rangeInput(kMax, e)}
			/>
		</div>
	</div>
{/snippet}

<div class="flex flex-col gap-4 lg:flex-row">
	<!-- Category sidebar -->
	<aside class="lg:w-60 lg:flex-none">
		<button
			type="button"
			class="btn mb-2 w-full justify-between lg:!hidden"
			onclick={() => (sidebarOpen = !sidebarOpen)}
			aria-expanded={sidebarOpen}
		>
			<span>
				Categories{#if f.cls != null}:
					<b class="text-accent-2"
						>{f.cls === -1 ? 'Unknown' : className(f.cls)}{f.sub != null
							? ` › ${subclassName(f.cls, f.sub)}`
							: ''}</b
					>{/if}
			</span>
			<span>{sidebarOpen ? '▴' : '▾'}</span>
		</button>
		<nav
			class="panel max-h-[calc(100vh-7rem)] overflow-y-auto p-2 text-sm lg:sticky lg:top-[4.5rem] lg:!block"
			class:hidden={!sidebarOpen}
			aria-label="Item categories"
		>
			<button
				type="button"
				class="cat"
				class:on={f.cls == null}
				onclick={() => setParams({ class: null, sub: null })}
			>
				<span>All categories</span><span class="cnt">{fmtInt(preCategory.length)}</span>
			</button>
			{#each tree.classes as c (c.id)}
				<button
					type="button"
					class="cat"
					class:on={f.cls === c.id && f.sub == null}
					onclick={() =>
						setParams({ class: f.cls === c.id && f.sub == null ? null : c.id, sub: null })}
				>
					<span><span class="caret">{f.cls === c.id ? '▾' : '▸'}</span>{className(c.id)}</span>
					<span class="cnt">{fmtInt(c.count)}</span>
				</button>
				{#if f.cls === c.id}
					{#each c.subs as s (s.id)}
						<button
							type="button"
							class="cat sub"
							class:on={f.sub === s.id}
							onclick={() => setParams({ class: c.id, sub: f.sub === s.id ? null : s.id })}
						>
							<span>{subclassName(c.id, s.id)}</span><span class="cnt">{fmtInt(s.count)}</span>
						</button>
					{/each}
				{/if}
			{/each}
			{#if tree.unknown}
				<button
					type="button"
					class="cat"
					class:on={f.cls === -1}
					onclick={() => setParams({ class: f.cls === -1 ? null : -1, sub: null })}
				>
					<span class="text-muted">Unknown / custom</span><span class="cnt"
						>{fmtInt(tree.unknown)}</span
					>
				</button>
			{/if}
		</nav>
	</aside>

	<section class="min-w-0 flex-1">
		<!-- Filter bar -->
		<div class="panel mb-3 flex flex-col gap-3 p-3">
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="browse-q"
					class="input w-full sm:w-64"
					type="search"
					placeholder="Filter by name or id…"
					aria-label="Filter by name or id"
					bind:value={qInput}
					oninput={onQ}
				/>
				<div class="flex flex-wrap gap-1" role="group" aria-label="Quality">
					{#each QUALITIES as q (q.id)}
						{#if q.id !== 6}
							<button
								type="button"
								class="btn !px-2 !py-1 text-xs"
								aria-pressed={f.qualities.includes(q.id)}
								style="color:{q.color}"
								onclick={() => toggleQuality(q.id)}>{q.name}</button
							>
						{/if}
					{/each}
				</div>
				<label class="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted select-none">
					<input
						type="checkbox"
						class="accent-amber-400"
						checked={f.onah}
						onchange={(e) => setParams({ onah: e.currentTarget.checked ? 1 : null })}
					/>
					Only on AH now
				</label>
			</div>
			<button
				type="button"
				class="btn w-full justify-between sm:!hidden"
				aria-expanded={moreFilters}
				onclick={() => (moreFilters = !moreFilters)}
			>
				<span>Level &amp; price filters</span><span>{moreFilters ? '▴' : '▾'}</span>
			</button>
			<div
				class="flex-wrap items-end gap-x-4 gap-y-2 text-sm sm:!flex"
				class:flex={moreFilters}
				class:hidden={!moreFilters}
			>
				{@render range('Item level', 'ilvl_min', 'ilvl_max', f.ilvlMin, f.ilvlMax, '1')}
				{@render range('Required level', 'req_min', 'req_max', f.reqMin, f.reqMax, '1')}
				{@render range(
					'Market value (gold)',
					'price_min',
					'price_max',
					f.priceMin,
					f.priceMax,
					'any'
				)}
				{#if activeFilterCount}
					<button type="button" class="btn ml-auto" onclick={resetFilters}
						>Clear filters ({activeFilterCount})</button
					>
				{/if}
			</div>
		</div>

		<!-- Results -->
		<div class="panel overflow-hidden">
			<div
				class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm"
			>
				<span class="text-muted">
					{#if rows}
						<b class="num text-ink">{fmtInt(sorted.length)}</b> items
						{#if sorted.length !== rows.length}<span class="text-dim">of {fmtInt(rows.length)}</span
							>{/if}
					{:else if error}
						<span class="text-down">Failed to load data: {error}</span>
					{:else}
						Loading prices…
					{/if}
				</span>
				<label class="flex items-center gap-2 text-xs text-muted">
					Rows
					<select
						class="input !py-1"
						value={f.per}
						onchange={(e) =>
							setParams({ per: e.currentTarget.value === '50' ? null : e.currentTarget.value })}
					>
						{#each PAGE_SIZES as n (n)}<option value={n}>{n}</option>{/each}
					</select>
				</label>
			</div>
			<div class="overflow-x-auto">
				<table class="grid-table">
					<thead>
						<tr>
							{#each cols as c (c.key)}
								<th
									class="{c.cls ?? ''} {c.right ? 'r' : ''}"
									title={c.title}
									aria-sort={f.sort === c.key
										? f.dir === 'asc'
											? 'ascending'
											: 'descending'
										: 'none'}
								>
									<button
										type="button"
										class="sortbtn"
										class:on={f.sort === c.key}
										onclick={() => sortBy(c.key)}
									>
										{c.label}<span class="arrow"
											>{f.sort === c.key ? (f.dir === 'asc' ? '▲' : '▼') : '↕'}</span
										>
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#if !rows && !error}
							{#each Array(12) as _, i (i)}
								<tr>
									<td colspan={cols.length}><div class="skeleton h-6 w-full"></div></td>
								</tr>
							{/each}
						{:else if rows && pageRows.length === 0}
							<tr>
								<td colspan={cols.length} class="py-10 text-center text-muted">
									No items match these filters.
									{#if activeFilterCount}<button
											type="button"
											class="ml-2 text-accent underline"
											onclick={resetFilters}>Clear filters</button
										>{/if}
								</td>
							</tr>
						{:else}
							{#each pageRows as r (r.item_id)}
								<tr class="cursor-pointer" onclick={(e) => rowClick(e, r.item_id)}>
									<td class="item-cell"><ItemName item={r} /></td>
									<td class="hidden text-muted 2xl:table-cell">
										{#if r.class != null}{className(r.class)}
											<span class="text-dim">›</span>
											{subclassName(r.class, r.subclass)}{:else}<span class="text-dim">—</span>{/if}
									</td>
									<td class="r num hidden md:table-cell">{r.item_level ?? '—'}</td>
									<td class="r num hidden text-muted lg:table-cell">{r.required_level || '—'}</td>
									<td class="r"><Money value={r.market_value} /></td>
									<td class="r hidden sm:table-cell"><Money value={r.min_buyout} /></td>
									<td class="r num">{fmtInt(r.quantity)}</td>
									<td class="r hidden xl:table-cell"><Money value={r.mv_3d} /></td>
									<td class="r hidden lg:table-cell"><Money value={r.mv_14d} /></td>
									<td class="r hidden md:table-cell"><Pct value={r.change} /></td>
									<td class="r hidden 2xl:table-cell"><Money value={r.sell_price || null} /></td>
									<td class="r hidden text-muted 2xl:table-cell" title={absTime(r.seen)}
										>{relativeTime(r.seen)}</td
									>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
			{#if rows && sorted.length > 0}
				<div
					class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm"
				>
					<span class="num text-muted">
						{fmtInt((curPage - 1) * f.per + 1)}–{fmtInt(Math.min(curPage * f.per, sorted.length))}
						of {fmtInt(sorted.length)}
					</span>
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="btn"
							aria-label="First page"
							disabled={curPage <= 1}
							onclick={() => setParams({ page: null }, false)}>«</button
						>
						<button
							type="button"
							class="btn"
							disabled={curPage <= 1}
							onclick={() => setParams({ page: curPage - 1 > 1 ? curPage - 1 : null }, false)}
							>‹ Prev</button
						>
						<span class="num px-2 text-muted">{curPage} / {pageCount}</span>
						<button
							type="button"
							class="btn"
							disabled={curPage >= pageCount}
							onclick={() => setParams({ page: curPage + 1 }, false)}>Next ›</button
						>
						<button
							type="button"
							class="btn"
							aria-label="Last page"
							disabled={curPage >= pageCount}
							onclick={() => setParams({ page: pageCount }, false)}>»</button
						>
					</div>
				</div>
			{/if}
		</div>
	</section>
</div>

<style>
	.cat {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3rem 0.5rem;
		border-radius: 0.4rem;
		text-align: left;
		color: var(--color-ink);
	}
	.cat:hover {
		background: var(--color-panel-2);
	}
	.cat.on {
		background: color-mix(in oklab, var(--color-accent) 16%, transparent);
		color: var(--color-accent-2);
	}
	.cat.sub {
		padding-left: 1.6rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}
	.cat.sub.on {
		color: var(--color-accent-2);
	}
	.caret {
		display: inline-block;
		width: 1rem;
		color: var(--color-dim);
		font-size: 0.7rem;
	}
	.cnt {
		font-size: 0.75rem;
		color: var(--color-dim);
		font-variant-numeric: tabular-nums;
	}
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
