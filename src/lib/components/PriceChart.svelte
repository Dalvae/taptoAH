<script lang="ts">
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import type { HistoryPoint } from '#lib/data.ts';
	import { moneyText, fmtInt } from '#lib/format.ts';

	let { points, clip = true }: { points: HistoryPoint[]; clip?: boolean } = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	const COLORS = {
		mv: '#818cf8',
		mvFill: 'rgba(99,102,241,0.18)',
		mb: '#fbbf24',
		qty: 'rgba(148,148,173,0.32)',
		qtyStroke: 'rgba(148,148,173,0.55)',
		axis: '#9494ad',
		grid: 'rgba(255,255,255,0.06)'
	};

	function quantile(sorted: number[], q: number): number {
		const pos = (sorted.length - 1) * q;
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
	}

	/** Upper bound for the price axis. With clipping on, values beyond a generous IQR fence are cut off. */
	const priceScale = $derived.by(() => {
		const vals = points
			.flatMap((p) => [p.market_value, p.min_buyout])
			.filter((v): v is number => v != null && v > 0)
			.sort((a, b) => a - b);
		if (!vals.length) return { max: 1, clipped: 0 };
		const max = vals[vals.length - 1];
		if (!clip || vals.length < 4) return { max: max * 1.08, clipped: 0 };
		const q1 = quantile(vals, 0.25);
		const q3 = quantile(vals, 0.75);
		const med = quantile(vals, 0.5);
		const fence = Math.max(q3 + 3 * (q3 - q1), med * 3);
		if (max <= fence) return { max: max * 1.08, clipped: 0 };
		return { max: fence * 1.08, clipped: vals.filter((v) => v > fence).length };
	});

	function build() {
		chart?.destroy();
		chart = null;
		if (!el || points.length === 0) return;
		const xs = points.map((p) => p.day * 86400);
		const pmax = priceScale.max;
		const hasQty = points.some((p) => p.quantity != null);
		const hasMin = points.some((p) => p.min_buyout != null);
		const series: uPlot.Series[] = [
			{
				value: (_u, v) =>
					v == null
						? '—'
						: new Date(v * 1000).toLocaleDateString('en-US', {
								month: 'short',
								day: 'numeric',
								year: 'numeric',
								timeZone: 'UTC'
							})
			}
		];
		const cols: (number | null)[][] = [xs];
		const axes: uPlot.Axis[] = [
			{ stroke: COLORS.axis, grid: { stroke: COLORS.grid }, ticks: { stroke: COLORS.grid } },
			{
				scale: 'price',
				stroke: COLORS.axis,
				grid: { stroke: COLORS.grid },
				ticks: { stroke: COLORS.grid },
				size: 70,
				values: (_u, vals) => vals.map((v) => moneyText(v, true))
			}
		];
		// quantity bars first so the price lines are drawn on top
		if (hasQty) {
			series.push({
				label: 'Quantity',
				scale: 'qty',
				fill: COLORS.qty,
				stroke: COLORS.qtyStroke,
				width: 1,
				paths: uPlot.paths.bars!({ size: [0.6, 28], align: 0 }),
				points: { show: false },
				value: (_u, v) => fmtInt(v)
			});
			cols.push(points.map((p) => p.quantity));
			axes.push({
				scale: 'qty',
				side: 1,
				stroke: COLORS.axis,
				grid: { show: false },
				ticks: { stroke: COLORS.grid },
				size: 50,
				values: (_u, vals) =>
					vals.map((v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v)))
			});
		}
		series.push({
			label: 'Market value',
			scale: 'price',
			stroke: COLORS.mv,
			fill: COLORS.mvFill,
			width: 2,
			points: { show: points.length < 40, size: 5 },
			value: (_u, v) => moneyText(v)
		});
		cols.push(points.map((p) => p.market_value));
		if (hasMin) {
			series.push({
				label: 'Min buyout',
				scale: 'price',
				stroke: COLORS.mb,
				width: 1.5,
				dash: [5, 4],
				spanGaps: true,
				points: { show: false },
				value: (_u, v) => moneyText(v)
			});
			cols.push(points.map((p) => p.min_buyout));
		}
		const opts: uPlot.Options = {
			width: el.clientWidth || 600,
			height: 320,
			padding: [12, 8, 0, 4],
			cursor: { points: { size: 7 }, drag: { x: true, y: false } },
			scales: {
				x: { time: true },
				price: { range: () => [0, pmax] },
				qty: { range: (_u, _min, max) => [0, Math.max(1, (max ?? 1) * 2.5)] }
			},
			legend: { live: true },
			series,
			axes
		};
		const data = cols as uPlot.AlignedData;
		chart = new uPlot(opts, data, el);
	}

	$effect(() => {
		void points;
		void priceScale;
		build();
	});

	$effect(() => {
		const ro = new ResizeObserver(() => {
			if (chart && el) chart.setSize({ width: el.clientWidth, height: 320 });
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="chart" bind:this={el}></div>
{#if priceScale.clipped}
	<p class="mt-1 text-xs text-dim">
		{priceScale.clipped} outlier value{priceScale.clipped === 1 ? '' : 's'} above the visible range (clipped).
	</p>
{/if}

<style>
	.chart {
		width: 100%;
		min-height: 320px;
	}
	.chart :global(.u-legend) {
		text-align: left;
		margin-top: 0.25rem;
	}
	.chart :global(.u-legend .u-marker) {
		border-radius: 2px;
	}
	.chart :global(.u-select) {
		background: rgba(99, 102, 241, 0.15);
	}
</style>
