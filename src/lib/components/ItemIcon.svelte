<script lang="ts">
	import { iconUrl } from '#lib/config.ts';
	import { qualityColor } from '#lib/wow.ts';

	let {
		icon,
		quality = null,
		size = 28
	}: { icon: string | null | undefined; quality?: number | null; size?: number } = $props();

	let failed = $state(false);
	$effect(() => {
		void icon;
		failed = false;
	});
	const border = $derived(quality != null && quality >= 2 ? qualityColor(quality) : '#3a4050');
</script>

<span
	class="icon"
	style="width:{size}px;height:{size}px;border-color:{border}"
	aria-hidden="true"
>
	{#if icon && !failed}
		<img src={iconUrl(icon, size <= 36)} alt="" width={size} height={size} loading="lazy" referrerpolicy="no-referrer" onerror={() => (failed = true)} />
	{:else}
		<svg viewBox="0 0 32 32" width={size - 2} height={size - 2}>
			<defs>
				<linearGradient id="q-bg" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stop-color="#2b2f3a" />
					<stop offset="1" stop-color="#151820" />
				</linearGradient>
			</defs>
			<rect width="32" height="32" fill="url(#q-bg)" />
			<text
				x="16"
				y="23"
				text-anchor="middle"
				font-size="20"
				font-weight="700"
				fill="#c9a640"
				font-family="Georgia, serif">?</text
			>
		</svg>
	{/if}
</span>

<style>
	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border: 1px solid;
		border-radius: 0.3rem;
		overflow: hidden;
		background: #151820;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>
