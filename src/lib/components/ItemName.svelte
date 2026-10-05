<script lang="ts">
	import ItemIcon from './ItemIcon.svelte';
	import { qualityColor, wowheadTooltip } from '#lib/wow.ts';
	import { withRealm } from '#lib/realm.svelte.ts';
	import { itemName } from '#lib/data.ts';

	let {
		item,
		size = 26
	}: {
		item: { item_id: number; name: string | null; quality: number | null; icon: string | null };
		size?: number;
	} = $props();
</script>

<a
	href={withRealm(`/item/${item.item_id}`)}
	data-wowhead={wowheadTooltip(item.item_id)}
	class="inline-flex min-w-0 max-w-full items-center gap-2 hover:underline"
>
	<ItemIcon icon={item.icon} quality={item.quality} {size} />
	<span class="name font-medium" style="color:{qualityColor(item.quality)}">{itemName(item)}</span>
</a>

<style>
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
