// "When should we land here?" — every landing day of the next 12 months at one site, scored with the
// same window metrics as the Compare heatmap (hourly samples, prefix sums for O(1) window averages).
import { sampleWindow, siteFrame } from './ephemeris.js';
import { analyzeSeries, simulateBattery } from './analysis.js';
import { scoreScenario } from './score.js';

const DAY = 864e5;

/**
 * Metrics for a mission of `durDays` starting on each UTC day from `startMs` (rounded down) for `days` days.
 * `win` (hourly samples from that day) can be passed in so several sites share one ephemeris pass (Compare heatmap).
 */
export function rankLandingDays({ site, hz, startMs, days = 365, durDays, power, commDeg = 0, win: shared, link = null }) {
  const stepMin = 60, perDay = 24;
  const d0 = new Date(startMs), t0 = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  const win = shared ?? sampleWindow(t0, t0 + (days + durDays) * DAY, stepMin);
  const S = analyzeSeries(win, siteFrame(site.lat, site.lon, hz.siteM), hz.mask, { commMaskDeg: commDeg });
  const n = S.n, pf = new Float64Array(n + 1), pe = new Float64Array(n + 1), pb = new Float64Array(n + 1), pp = new Float64Array(n + 1);
  const pl = link ? new Float64Array(n + 1) : null;                    // optional: DSN antenna link (core/dsn.js dsnLineOfSight)
  for (let i = 0; i < n; i++) {
    pf[i + 1] = pf[i] + S.sunFrac[i]; pe[i + 1] = pe[i] + S.earthVis[i];
    pb[i + 1] = pb[i] + (S.sunFrac[i] >= 0.5 && S.earthVis[i] ? 1 : 0); pp[i + 1] = pp[i] + S.power[i];
    if (pl) pl[i + 1] = pl[i] + link[i];
  }
  const len = Math.max(1, Math.round(durDays * perDay)), cells = [];
  for (let d = 0; d < days; d++) {
    const a = d * perDay, b = Math.min(n, a + len), k = b - a;
    let night = 0, gap = 0, maxNight = 0, maxGap = 0;
    for (let i = a; i < b; i++) {
      night = S.sunFrac[i] < 0.5 ? night + 1 : 0; gap = S.earthVis[i] ? 0 : gap + 1;
      if (night > maxNight) maxNight = night;
      if (gap > maxGap) maxGap = gap;
    }
    const m = {
      sunPct: 100 * (pf[b] - pf[a]) / k, earthPct: 100 * (pe[b] - pe[a]) / k, bothPct: 100 * (pb[b] - pb[a]) / k,
      meanPowerWm2: (pp[b] - pp[a]) / k, longestNightH: maxNight * stepMin / 60, longestCommGapH: maxGap * stepMin / 60,
    };
    if (pl) m.dsnPct = 100 * (pl[b] - pl[a]) / k;
    if (power) {
      const bt = simulateBattery({ n: k, stepMin, t: S.t.subarray(a, b), power: S.power.subarray(a, b) }, power);
      m.minSocPct = bt.minSocPct; m.survives = bt.survives;
    }
    m.score = scoreScenario(m);
    cells.push({ startMs: t0 + d * DAY, m });
  }
  return cells;
}

/** Top `count` landing days, at least `minGapDays` apart (so the list offers real alternatives, not neighbours). */
export function pickBest(cells, count = 5, minGapDays = 3) {
  const order = [...cells].sort((p, q) => q.m.score - p.m.score || q.m.bothPct - p.m.bothPct || q.m.sunPct - p.m.sunPct);
  const out = [];
  for (const c of order) {
    if (out.every(o => Math.abs(o.startMs - c.startMs) >= minGapDays * DAY)) out.push(c);
    if (out.length === count) break;
  }
  return out;
}

/** Rank (1 = best) of a cell among all cells by score. */
export const rankOf = (cells, cell) => 1 + cells.filter(c => c.m.score > cell.m.score).length;
