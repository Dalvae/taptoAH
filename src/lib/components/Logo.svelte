<script lang="ts">
	// Shared TaptoLogs / taptoAH brand mark: mascot in a gradient circle + layered stroked wordmark.
	// `inline` lays the wordmark beside the mascot (used in the sticky header).
	type Props = { size?: 'sm' | 'md' | 'lg'; showText?: boolean; inline?: boolean; text?: string };

	let { size = 'md', showText = true, inline = false, text = 'TaptoAH' }: Props = $props();
</script>

<div class="relative flex items-center logo-{size}" class:flex-col={!inline} class:inline-logo={inline}>
	<div class="relative flex-none rounded-full">
		<svg
			class="pointer-events-none absolute inset-0 z-[1] h-full w-full"
			viewBox="0 0 200 200"
			fill="none"
			aria-hidden="true"
		>
			<path d="M28 38 L32 28 L36 38 L32 48Z" fill="rgba(255,255,255,0.6)" />
			<path d="M155 28 L159 18 L163 28 L159 38Z" fill="rgba(255,255,255,0.55)" />
			<path d="M22 145 L26 135 L30 145 L26 155Z" fill="rgba(255,255,255,0.5)" />
			<path d="M168 125 L172 117 L176 125 L172 133Z" fill="rgba(255,255,255,0.55)" />
			<path d="M152 72 L155 64 L158 72 L155 80Z" fill="rgba(255,255,255,0.4)" />
			<path d="M38 82 L41 74 L44 82 L41 90Z" fill="rgba(255,255,255,0.4)" />
			<circle cx="170" cy="160" r="5" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.5)" stroke-width="1" />
			<circle cx="26" cy="172" r="4.5" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.5)" stroke-width="1" />
		</svg>
		<div class="circle-bg relative flex items-center justify-center overflow-hidden rounded-full">
			<img src="/logo.webp" alt="taptoAH mascot" class="mascot-img absolute z-[2] max-w-none" />
		</div>
	</div>
	{#if showText}
		<div class="text-container relative z-[3] flex items-center justify-center">
			<span class="txt txt-navy absolute" aria-hidden="true">{text}</span>
			<span class="txt txt-celeste absolute" aria-hidden="true">{text}</span>
			<span class="txt txt-white absolute" aria-hidden="true">{text}</span>
			<span class="txt txt-pink relative">{text}</span>
		</div>
	{/if}
</div>

<style>
	.circle-bg {
		background: linear-gradient(145deg, #c6f7e2 0%, #c1f0dc 20%, #d4e8f7 45%, #d8d0f8 70%, #e4d6fb 100%);
		border: solid #2d2b55;
		box-shadow:
			0 4px 15px rgba(45, 43, 85, 0.25),
			inset 0 2px 10px rgba(255, 255, 255, 0.2);
	}
	.mascot-img {
		width: 200%;
		height: 200%;
		margin-left: 35%;
		margin-top: 20%;
	}
	.txt {
		font-family: 'Nunito', 'Quicksand', system-ui, sans-serif;
		font-weight: 900;
		letter-spacing: 0.02em;
		white-space: nowrap;
		paint-order: stroke fill;
	}
	.txt-navy {
		color: #2d2b55;
		-webkit-text-stroke-color: #2d2b55;
	}
	.txt-celeste {
		color: #7ec8e3;
		-webkit-text-stroke-color: #7ec8e3;
	}
	.txt-white {
		color: white;
		-webkit-text-stroke-color: white;
	}
	.txt-pink {
		color: #f9a8c9;
		filter: drop-shadow(0 2px 3px rgba(45, 43, 85, 0.2));
	}

	.logo-sm .circle-bg {
		width: 2.6rem;
		height: 2.6rem;
		border-width: 2px;
	}
	.logo-sm .text-container {
		margin-top: -0.75rem;
	}
	.logo-sm .txt {
		font-size: 0.7rem;
	}
	.logo-sm .txt-navy {
		-webkit-text-stroke-width: 5px;
	}
	.logo-sm .txt-celeste {
		-webkit-text-stroke-width: 3.5px;
	}
	.logo-sm .txt-white {
		-webkit-text-stroke-width: 2px;
	}

	.logo-md .circle-bg {
		width: 7rem;
		height: 7rem;
		border-width: 3px;
	}
	.logo-md .text-container {
		margin-top: -1.5rem;
	}
	.logo-md .txt {
		font-size: 1.75rem;
	}
	.logo-md .txt-navy {
		-webkit-text-stroke-width: 9px;
	}
	.logo-md .txt-celeste {
		-webkit-text-stroke-width: 6.5px;
	}
	.logo-md .txt-white {
		-webkit-text-stroke-width: 4px;
	}

	.logo-lg .circle-bg {
		width: 12rem;
		height: 12rem;
		border-width: 4px;
	}
	.logo-lg .text-container {
		margin-top: -2.75rem;
	}
	.logo-lg .txt {
		font-size: 3rem;
	}
	.logo-lg .txt-navy {
		-webkit-text-stroke-width: 14px;
	}
	.logo-lg .txt-celeste {
		-webkit-text-stroke-width: 10px;
	}
	.logo-lg .txt-white {
		-webkit-text-stroke-width: 6px;
	}

	/* header variant: wordmark beside the mascot */
	.inline-logo {
		gap: 0.15rem;
	}
	.inline-logo .text-container {
		margin-top: 0;
		margin-left: -0.35rem;
	}
	.inline-logo.logo-sm .txt {
		font-size: 1.2rem;
	}
	.inline-logo.logo-sm .txt-navy {
		-webkit-text-stroke-width: 7px;
	}
	.inline-logo.logo-sm .txt-celeste {
		-webkit-text-stroke-width: 5px;
	}
	.inline-logo.logo-sm .txt-white {
		-webkit-text-stroke-width: 3px;
	}
</style>
