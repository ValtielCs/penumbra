// Validate terrain-aware illumination against published values (Gläser et al. 2018, PSS):
// average illumination at 2 m above ground over ~20 years.
// Usage: node tools/check-illumination.mjs data/dem
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('../vendor/astronomy.js');
const { Dem, decodeLevel } = await import('../js/core/dem.js');
const { computeHorizon } = await import('../js/core/horizon.js');
const { sampleWindow, siteFrame } = await import('../js/core/ephemeris.js');
const { analyzeSeries, summarize } = await import('../js/core/analysis.js');

const dir = process.argv[2] || 'data/dem';
const meta = JSON.parse(readFileSync(`${dir}/dem.json`, 'utf8'));
const dem = new Dem(meta, meta.levels.map(l => decodeLevel(gunzipSync(readFileSync(`${dir}/${l.file}`)), l.n, meta.dnToMeters)));

let t = performance.now();
const win = sampleWindow(Date.UTC(2025, 0, 1), Date.UTC(2045, 0, 1), 120);
console.log(`ephemeris: ${win.n} samples in ${(performance.now() - t).toFixed(0)} ms`);

const sites = [
  { name: 'Connecting Ridge C1', lat: -89.44, lon: 222.83, ref: 88.0 },
  { name: 'Connecting Ridge C2', lat: -89.31, lon: 245.98, ref: 78.1 },
  { name: 'Shackleton center (PSR floor)', lat: -89.67, lon: 129.78, ref: 0 },
  { name: 'IM-2 Mons Mouton', lat: -84.78, lon: 29.13, ref: null },
];
for (const s of sites) {
  t = performance.now();
  const hz = computeHorizon(dem, s.lat, s.lon, 2, 720);
  const ms = performance.now() - t;
  const S = analyzeSeries(win, siteFrame(s.lat, s.lon, hz.siteM), hz.mask);
  const m = summarize(S, win.t[0]);
  const mm = Array.from(hz.mask);
  console.log(`${s.name.padEnd(30)} ground ${hz.groundM.toFixed(0)} m | horizon ${Math.min(...mm).toFixed(2)}..${Math.max(...mm).toFixed(2)}° (${ms.toFixed(0)} ms) | sun ${m.sunPct.toFixed(1)}% (ref ${s.ref ?? '-'}) | earth ${m.earthPct.toFixed(1)}% | longest night ${m.longestNightH.toFixed(0)} h`);
}
