<script lang="ts">
	import { splitMoney } from '#lib/format.ts';

	let { value, compact = false }: { value: number | null | undefined; compact?: boolean } = $props();

	const parts = $derived(value == null || !Number.isFinite(value) ? null : splitMoney(value));
</script>

{#if parts}
	<span class="money num" title="{value} copper">
		{#if value! < 0}-{/if}
		{#if parts.g}<span class="g">{parts.g.toLocaleString('en-US')}<i>g</i></span>{/if}
		{#if !(compact && parts.g >= 100) && (parts.s || (parts.g && parts.c))}<span class="s"
				>{parts.s}<i>s</i></span
			>{/if}
		{#if !(compact && parts.g > 0) && (parts.c || (!parts.g && !parts.s))}<span class="c"
				>{parts.c}<i>c</i></span
			>{/if}
	</span>
{:else}
	<span class="text-dim">—</span>
{/if}

<style>
	.money {
		display: inline-flex;
		gap: 0.3em;
		justify-content: flex-end;
		white-space: nowrap;
	}
	i {
		font-style: normal;
		font-size: 0.85em;
		margin-left: 1px;
		opacity: 0.9;
	}
	.g {
		color: var(--color-gold);
	}
	.s {
		color: var(--color-silver);
	}
	.c {
		color: var(--color-copper);
	}
</style>
