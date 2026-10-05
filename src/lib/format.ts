/** Money is always in copper. */
export function splitMoney(copper: number): { g: number; s: number; c: number } {
	const v = Math.round(Math.abs(copper));
	return { g: Math.floor(v / 10000), s: Math.floor((v % 10000) / 100), c: v % 100 };
}

/** Plain-text money, e.g. "12g 34s 5c". Used for chart axes/tooltips. */
export function moneyText(copper: number | null | undefined, compact = false): string {
	if (copper == null || !Number.isFinite(copper)) return '—';
	const { g, s, c } = splitMoney(copper);
	const sign = copper < 0 ? '-' : '';
	if (compact) {
		if (g >= 10000) return `${sign}${(g / 1000).toFixed(g >= 100000 ? 0 : 1)}kg`;
		if (g >= 100) return `${sign}${g.toLocaleString('en-US')}g`;
		if (g > 0) return `${sign}${g}g ${s}s`;
		if (s > 0) return `${sign}${s}s ${c}c`;
		return `${sign}${c}c`;
	}
	const parts: string[] = [];
	if (g) parts.push(`${g.toLocaleString('en-US')}g`);
	if (s || (g && c)) parts.push(`${s}s`);
	if (c || parts.length === 0) parts.push(`${c}c`);
	return sign + parts.join(' ');
}

export function fmtInt(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	return Math.round(n).toLocaleString('en-US');
}

export function pctChange(now: number | null, ref: number | null): number | null {
	if (now == null || ref == null || ref <= 0) return null;
	return ((now - ref) / ref) * 100;
}

export function fmtPct(p: number | null | undefined, digits = 1): string {
	if (p == null || !Number.isFinite(p)) return '—';
	const sign = p > 0 ? '+' : '';
	return `${sign}${p.toFixed(Math.abs(p) >= 100 ? 0 : digits)}%`;
}

export function relativeTime(unixSec: number | null | undefined, nowMs = Date.now()): string {
	if (!unixSec) return 'never';
	const diff = Math.round(nowMs / 1000 - unixSec);
	const abs = Math.abs(diff);
	const units: [number, string][] = [
		[86400 * 365, 'year'],
		[86400 * 30, 'month'],
		[86400 * 7, 'week'],
		[86400, 'day'],
		[3600, 'hour'],
		[60, 'minute']
	];
	for (const [secs, name] of units) {
		if (abs >= secs) {
			const n = Math.floor(abs / secs);
			const label = `${n} ${name}${n === 1 ? '' : 's'}`;
			return diff >= 0 ? `${label} ago` : `in ${label}`;
		}
	}
	return 'just now';
}

export function absTime(unixSec: number | null | undefined): string {
	if (!unixSec) return '';
	return new Date(unixSec * 1000).toLocaleString('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

export function dayToDate(day: number): string {
	return new Date(day * 86400 * 1000).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
