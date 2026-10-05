<script lang="ts">
	import { goto } from '$app/navigation';
	import { getItemIndex, searchIndex, itemName, type IndexEntry } from '#lib/data.ts';
	import { qualityColor } from '#lib/wow.ts';
	import { withRealm } from '#lib/realm.svelte.ts';
	import ItemIcon from './ItemIcon.svelte';

	let q = $state('');
	let open = $state(false);
	let active = $state(-1);
	let index = $state<IndexEntry[] | null>(null);
	let loading = $state(false);
	let error = $state('');

	const results = $derived(index ? searchIndex(index, q) : []);

	function warm() {
		if (index || loading) return;
		loading = true;
		getItemIndex()
			.then((i) => (index = i))
			.catch((e) => (error = String(e?.message ?? e)))
			.finally(() => (loading = false));
	}

	function pick(e: IndexEntry) {
		open = false;
		q = '';
		goto(withRealm(`/item/${e.item_id}`));
	}

	function onkeydown(ev: KeyboardEvent) {
		if (ev.key === 'ArrowDown') {
			ev.preventDefault();
			open = true;
			active = Math.min(active + 1, results.length - 1);
		} else if (ev.key === 'ArrowUp') {
			ev.preventDefault();
			active = Math.max(active - 1, -1);
		} else if (ev.key === 'Enter') {
			ev.preventDefault();
			if (active >= 0 && results[active]) pick(results[active]);
			else if (q.trim()) {
				open = false;
				goto(withRealm(`/?q=${encodeURIComponent(q.trim())}`));
			}
		} else if (ev.key === 'Escape') {
			open = false;
			(ev.target as HTMLInputElement).blur();
		}
	}
</script>

<div class="relative w-full">
	<svg
		class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-dim"
		width="16"
		height="16"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg
	>
	<input
		class="input w-full !pl-8"
		type="search"
		placeholder="Search items…"
		aria-label="Search items"
		autocomplete="off"
		bind:value={q}
		onfocus={() => {
			warm();
			open = true;
		}}
		oninput={() => {
			open = true;
			active = -1;
		}}
		onblur={() => setTimeout(() => (open = false), 150)}
		{onkeydown}
	/>
	{#if open && q.trim()}
		<div
			class="panel absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden shadow-2xl shadow-black/60"
			role="listbox"
		>
			{#if loading && !index}
				<div class="px-3 py-2 text-sm text-muted">Loading item index…</div>
			{:else if error}
				<div class="px-3 py-2 text-sm text-down">{error}</div>
			{:else if results.length === 0}
				<div class="px-3 py-2 text-sm text-muted">No items match “{q}”</div>
			{:else}
				{#each results as r, i (r.item_id)}
					<button
						type="button"
						role="option"
						aria-selected={i === active}
						class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-panel-2"
						class:bg-panel-2={i === active}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => pick(r)}
					>
						<ItemIcon icon={r.icon} quality={r.quality} size={22} />
						<span class="truncate" style="color:{qualityColor(r.quality)}">{itemName(r)}</span>
						<span class="ml-auto text-xs text-dim num">#{r.item_id}</span>
					</button>
				{/each}
				<div class="border-t border-line px-3 py-1.5 text-xs text-dim">
					Enter to search all results
				</div>
			{/if}
		</div>
	{/if}
</div>
