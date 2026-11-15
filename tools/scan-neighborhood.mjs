// Scan illumination in a small grid around a site (used to study sensitivity to location).
// Usage: node tools/scan-neighborhood.mjs <lat> <lon> [halfSizeKm=1.2] [stepKm=0.24] [heightM=2]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('../vendor/astronomy.js');
const { Dem, decodeLevel } = await import('../js/core/dem.js');
const { computeHorizon } = await import('../js/core/horizon.js');
const { sampleWindow, siteFrame } = await import('../js/core/ephemeris.js');
const { analyzeSeries, summarize } = await import('../js/core/analysis.js');
const [lat0, lon0, half = 1.2, step = 0.24, hM = 2] = process.argv.slice(2).map(Number);
const meta = JSON.parse(readFileSync('data/dem/dem.json', 'utf8'));
const dem = new Dem(meta, meta.levels.map(l => decodeLevel(gunzipSync(readFileSync(`data/dem/${l.file}`)), l.n, meta.dnToMeters)));
const win = sampleWindow(Date.UTC(2025, 0, 1), Date.UTC(2045, 0, 1), 240);
const c = Dem.toXY(lat0, lon0);
let best = null; const rows = [];
for (let dy = half; dy >= -half - 1e-9; dy -= step) {
  const row = [];
  for (let dx = -half; dx <= half + 1e-9; dx += step) {
    const { lat, lon } = Dem.toLatLon(c.x + dx * 1000, c.y + dy * 1000);
    const hz = computeHorizon(dem, lat, lon, hM, 360);
    const m = summarize(analyzeSeries(win, siteFrame(lat, lon, hz.siteM), hz.mask), win.t[0]);
    row.push(m.sunPct.toFixed(0).padStart(3));
    if (!best || m.sunPct > best.pct) best = { pct: m.sunPct, lat, lon, ground: hz.groundM, night: m.longestNightH };
  }
  rows.push(row.join(' '));
}
console.log(rows.join('\n'));
console.log('best', JSON.stringify(best));
