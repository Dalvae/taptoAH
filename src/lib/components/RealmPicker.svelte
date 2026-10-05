<script lang="ts">
	import { realmLabel, realmLastUpdate } from '#lib/data.ts';
	import { relativeTime, fmtInt } from '#lib/format.ts';
	import { realmState, realmList, currentRealm, setRealm } from '#lib/realm.svelte.ts';

	let open = $state(false);
	const current = $derived(currentRealm());
	const label = $derived(realmLabel(current));

	function factionColor(f: string) {
		return f.toLowerCase() === 'horde' ? 'var(--color-horde)' : 'var(--color-alliance)';
	}
</script>

<svelte:window onclick={() => (open = false)} />

<div class="relative">
	<button
		type="button"
		class="btn !py-1.5"
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={(e) => {
			e.stopPropagation();
			open = !open;
		}}
	>
		{#if current}
			<span class="h-2 w-2 rounded-full" style="background:{factionColor(label.faction)}"></span>
			<span class="font-medium">{label.realm}</span>
			<span class="hidden text-muted sm:inline">{label.faction}</span>
		{:else}
			<span class="text-muted">No realms</span>
		{/if}
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
			><path d="m6 9 6 6 6-6" /></svg
		>
	</button>
	{#if open}
		<div
			class="panel absolute top-full right-0 z-50 mt-1 w-72 overflow-hidden shadow-2xl shadow-black/60"
			role="listbox"
		>
			<div class="label border-b border-line px-3 py-2">Realm / faction</div>
			{#each realmList() as key (key)}
				{@const l = realmLabel(key)}
				{@const m = realmState.meta?.realms[key]}
				<button
					type="button"
					role="option"
					aria-selected={key === current}
					class="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-panel-2"
					class:bg-panel-2={key === current}
					onclick={() => {
						open = false;
						setRealm(key);
					}}
				>
					<span class="mt-1.5 h-2 w-2 flex-none rounded-full" style="background:{factionColor(l.faction)}"
					></span>
					<span class="min-w-0">
						<span class="block text-sm font-medium">{l.realm} <span class="text-muted">· {l.faction}</span></span>
						<span class="block text-xs text-muted">
							Updated {relativeTime(realmLastUpdate(m))}
							{#if m?.last_scan}· own scan {relativeTime(m.last_scan)}{/if}
						</span>
						<span class="block text-xs text-dim">
							{#if m?.tsm_items}{fmtInt(m.tsm_items)} items priced{/if}
							{#if m?.scans}· {fmtInt(m.scans)} scans{/if}
						</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
