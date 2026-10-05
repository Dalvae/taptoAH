<script lang="ts">
	import { fmtPct } from '#lib/format.ts';

	let { value }: { value: number | null | undefined } = $props();
</script>

<span
	class="num"
	class:text-up={value != null && value > 0.05}
	class:text-down={value != null && value < -0.05}
	class:text-muted={value == null || Math.abs(value) <= 0.05}
>
	{#if value != null && value > 0.05}▲{:else if value != null && value < -0.05}▼{/if}
	{fmtPct(value)}
</span>
