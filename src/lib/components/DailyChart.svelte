<script lang="ts" module>
	export interface DailySeries {
		label: string;
		/** Aligned with `days`. */
		values: number[];
		color: string;
		bars?: boolean;
		/** Second y axis (right side). */
		right?: boolean;
	}
</script>

<script lang="ts">
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';
	import { fmtInt } from '#lib/format.ts';

	// days: days since epoch (UTC), ascending; missing days are drawn as 0.
	let { days, series, height = 200 }: { days: number[]; series: DailySeries[]; height?: number } = $props();

	const DAY = 86400;
	const AXIS = '#9494ad';
	const GRID = 'rgba(255,255,255,0.06)';
	const dateLabel = (sec: number, opts: Intl.DateTimeFormatOptions) =>
		new Date(sec * 1000).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
	const short = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	function build() {
		chart?.destroy();
		chart = null;
		if (!el || days.length === 0) return;
		const first = days[0];
		const last = days[days.length - 1];
		const xs: number[] = [];
		const index = new Map(days.map((d, i) => [d, i]));
		const cols: number[][] = series.map(() => []);
		for (let d = first; d <= last; d++) {
			xs.push(d * DAY + DAY / 2);
			const i = index.get(d);
			series.forEach((s, j) => cols[j].push(i == null ? 0 : (s.values[i] ?? 0)));
		}
		const hasRight = series.some((s) => s.right);
		const opts: uPlot.Options = {
			width: el.clientWidth || 600,
			height,
			padding: [10, 8, 0, 4],
			cursor: { points: { size: 6 }, drag: { x: false, y: false } },
			scales: {
				x: { time: true, range: () => [first * DAY, (last + 1) * DAY] },
				y: { range: (_u, _min, max) => [0, Math.max(1, (max ?? 1) * 1.1)] },
				y2: { range: (_u, _min, max) => [0, Math.max(1, (max ?? 1) * 1.1)] }
			},
			legend: { live: true },
			series: [
				{ value: (_u, v) => (v == null ? '—' : dateLabel(v, { month: 'short', day: 'numeric', year: 'numeric' })) },
				...series.map(
					(s): uPlot.Series => ({
						label: s.label,
						scale: s.right ? 'y2' : 'y',
						stroke: s.color,
						width: s.bars ? 1 : 2,
						fill: s.bars ? `${s.color}55` : undefined,
						paths: s.bars ? uPlot.paths.bars!({ size: [0.6, 24], align: 0 }) : undefined,
						points: { show: !s.bars && xs.length < 20, size: 4 },
						value: (_u, v) => fmtInt(v)
					})
				)
			],
			axes: [
				{
					stroke: AXIS,
					grid: { stroke: GRID },
					ticks: { stroke: GRID },
					incrs: [DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY],
					space: 48,
					values: (_u, vals) => vals.map((v) => dateLabel(v, { month: 'short', day: 'numeric' }))
				},
				{
					scale: 'y',
					stroke: AXIS,
					grid: { stroke: GRID },
					ticks: { stroke: GRID },
					size: 44,
					values: (_u, vals) => vals.map(short)
				},
				...(hasRight
					? [
							{
								scale: 'y2',
								side: 1,
								stroke: AXIS,
								grid: { show: false },
								ticks: { stroke: GRID },
								size: 44,
								values: (_u: uPlot, vals: number[]) => vals.map(short)
							} satisfies uPlot.Axis
						]
					: [])
			]
		};
		chart = new uPlot(opts, [xs, ...cols] as uPlot.AlignedData, el);
	}

	$effect(() => {
		void days;
		void series;
		build();
	});

	$effect(() => {
		const ro = new ResizeObserver(() => {
			if (chart && el) chart.setSize({ width: el.clientWidth, height });
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
			chart?.destroy();
			chart = null;
		};
	});
</script>

<div class="chart" bind:this={el} style="min-height:{height}px"></div>

<style>
	.chart {
		width: 100%;
	}
	.chart :global(.u-legend) {
		text-align: left;
		margin-top: 0.25rem;
		font-size: 0.75rem;
	}
	.chart :global(.u-legend .u-marker) {
		border-radius: 2px;
	}
</style>
