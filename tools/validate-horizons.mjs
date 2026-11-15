// Compare the in-browser ephemeris (js/core/ephemeris.js) against NASA/JPL Horizons.
// Usage: node tools/validate-horizons.mjs raw/horizons data/validation.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('../vendor/astronomy.js');
const E = await import('../js/core/ephemeris.js');

const [, , inDir = 'raw/horizons', outFile = 'data/validation.json'] = process.argv;
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const D2R = Math.PI / 180;

function parse(file) {
  const txt = readFileSync(join(inDir, file), 'utf8');
  const body = txt.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
  return body.map(line => {
    const c = line.split(',').map(s => s.trim());
    const [, y, mo, d, hh, mm] = c[0].match(/(\d+)-(\w+)-(\d+) (\d+):(\d+)/);
    return { t: Date.UTC(+y, MON[mo], +d, +hh, +mm), v: c.slice(3).filter(s => s !== '').map(Number) };
  });
}
const unit = (lat, lon) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
const sep = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / D2R;
const stats = arr => ({ max: Math.max(...arr.map(Math.abs)), rms: Math.sqrt(arr.reduce((s, x) => s + x * x, 0) / arr.length), n: arr.length });
const r4 = x => Math.round(x * 1e4) / 1e4;

const out = { generated: new Date().toISOString(), reference: 'NASA/JPL Horizons API (DE441, MOON_ME frame)', model: 'Astronomy Engine 2.1.19 + IAU Moon rotation model', checks: [] };

// 1) Sub-Earth / sub-solar points (site-independent geometry)
{
  const rows = parse('subpoints_2026_2027.txt');
  const dE = [], dS = [];
  for (const { t, v } of rows) {
    const g = E.moonFixed(new Date(t));
    const e = E.subPoint(g.earth), s = E.subPoint(g.sun);
    dE.push(sep(unit(e.lat, e.lon), unit(v[1], v[0])));
    dS.push(sep(unit(s.lat, s.lon), unit(v[3], v[2])));
  }
  out.checks.push({ id: 'subpoints', label: 'Sub-Earth & sub-solar points on the Moon, 1 year (6-h steps)', earthDirDeg: stats(dE), sunDirDeg: stats(dS) });
}

// 2) Topocentric AZ/EL at surface sites
const sites = [
  { id: 'c1', label: 'Connecting Ridge C1 (89.44°S, 222.83°E)', lat: -89.44, lon: 222.83, h: 1950.5 },
  { id: 'im2', label: 'IM-2 Mons Mouton (84.78°S, 29.13°E)', lat: -84.78, lon: 29.13, h: 5000 },
  { id: 'a11', label: 'Apollo 11, landing day 1969', lat: 0.67408, lon: 23.47297, h: -1900 },
];
for (const s of sites) {
  const f = E.siteFrame(s.lat, s.lon, s.h);
  const res = { id: s.id, label: s.label };
  for (const body of ['sun', 'earth']) {
    const rows = parse(`${s.id}_${body}.txt`);
    const dEl = [], dSky = [], series = [];
    for (const { t, v } of rows) {
      const g = E.moonFixed(new Date(t));
      const p = E.azel(g[body], f);
      dEl.push(p.el - v[1]);
      dSky.push(sep(unit(p.el, -p.az), unit(v[1], -v[0])));
      series.push([t, r4(p.el), r4(v[1]), r4(p.az), r4(v[0])]);
    }
    res[body] = { elevationErrDeg: stats(dEl), skyErrDeg: stats(dSky), series: series.filter((_, i) => i % 2 === 0) };
  }
  out.checks.push(res);
}

mkdirSync(dirname(outFile), { recursive: true });
// keep checks produced elsewhere (the GPU-vs-CPU table comes from tools/validate-gpu.js in the browser)
try { for (const c of JSON.parse(readFileSync(outFile, 'utf8')).checks ?? []) if (c.id === 'gpu') out.checks.push(c); } catch { /* first run */ }
writeFileSync(outFile, JSON.stringify(out));
for (const c of out.checks) {
  if (!c.sun && c.id !== 'subpoints') continue;
  if (c.id === 'subpoints') console.log(c.label, '\n  Earth dir max/rms', c.earthDirDeg.max.toFixed(4), c.earthDirDeg.rms.toFixed(4), '\n  Sun dir   max/rms', c.sunDirDeg.max.toFixed(4), c.sunDirDeg.rms.toFixed(4));
  else for (const b of ['sun', 'earth']) console.log(c.label, b.padEnd(5), 'elev err max/rms', c[b].elevationErrDeg.max.toFixed(4), c[b].elevationErrDeg.rms.toFixed(4), '| sky err max', c[b].skyErrDeg.max.toFixed(4), 'deg');
}
