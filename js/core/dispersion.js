// Off-target touchdown: landers do not land exactly on target (landing ellipses of a few hundred metres
// to kilometres). At the pole that can change everything, so we re-run the whole mission window at
// 19 touchdown points of the ellipse: the target, 6 points at r/2 and 12 points at r.
import { computeHorizon } from './horizon.js';
import { siteFrame } from './ephemeris.js';
import { analyzeSeries, summarize } from './analysis.js';
import { scoreScenario } from './score.js';
import { destination } from './geo.js';

export function dispersionPoints(lat, lon, rKm) {
  const pts = [{ lat, lon, dKm: 0, az: 0, target: true }];
  for (const [n, f, rot] of [[6, 0.5, 30], [12, 1, 0]]) {
    for (let k = 0; k < n; k++) {
      const az = (k * 360 / n + rot) % 360;
      pts.push({ ...destination(lat, lon, az, rKm * f), dKm: rKm * f, az });
    }
  }
  return pts;
}

/**
 * Analyse every touchdown point over the same mission window. Yields to the UI between points.
 * Returns the points with their metrics (M), score and ground height, plus spread statistics.
 */
export async function analyzeDispersion({ dem, site, rKm, heightM, win, commDeg = 0, power, tNow, onProgress }) {
  const pts = dispersionPoints(site.lat, site.lon, rKm);
  for (const [i, p] of pts.entries()) {
    const hz = computeHorizon(dem, p.lat, p.lon, heightM, 360);
    const S = analyzeSeries(win, siteFrame(p.lat, p.lon, hz.siteM), hz.mask, { commMaskDeg: commDeg });
    p.M = summarize(S, tNow ?? win.t[0], power);
    p.score = scoreScenario(p.M);
    p.groundM = hz.groundM;
    onProgress?.(i + 1, pts.length);
    if (i % 2 === 1) await new Promise(r => setTimeout(r, 0));
  }
  const range = k => { const v = pts.map(p => p.M[k]); return [Math.min(...v), Math.max(...v)]; };
  const median = k => { const v = pts.map(p => p.M[k]).sort((a, b) => a - b); return v[(v.length - 1) / 2]; };
  const byScore = [...pts].sort((a, b) => b.score - a.score || b.M.sunPct - a.M.sunPct);
  return {
    rKm, pts,
    sun: range('sunPct'), earth: range('earthPct'), both: range('bothPct'), night: range('longestNightH'),
    sunMedian: median('sunPct'),
    survive: pts.filter(p => p.M.survives).length,
    best: byScore[0], worst: byScore[byScore.length - 1],
  };
}
