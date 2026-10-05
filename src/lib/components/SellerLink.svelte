<script lang="ts">
	import { withRealm } from '#lib/realm.svelte.ts';

	let { name, class: cls = '' }: { name: string | null | undefined; class?: string } = $props();
</script>

{#if name}
	<a href={withRealm(`/seller/${encodeURIComponent(name)}`)} class="hover:text-accent-2 hover:underline {cls}" title={name}
		>{name}</a
	>
{:else}
	<span class="text-dim">—</span>
{/if}
