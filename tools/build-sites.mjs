// Build data/sites.json: curated landing sites + long-term (20-yr) illumination/Earth visibility
// computed with the same code the browser uses.  Usage: node tools/build-sites.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.Astronomy = require('../vendor/astronomy.js');
const { Dem, decodeLevel } = await import('../js/core/dem.js');
const { computeHorizon } = await import('../js/core/horizon.js');
const { sampleWindow, siteFrame } = await import('../js/core/ephemeris.js');
const { analyzeSeries, summarize } = await import('../js/core/analysis.js');

const meta = JSON.parse(readFileSync('data/dem/dem.json', 'utf8'));
const dem = new Dem(meta, meta.levels.map(l => decodeLevel(gunzipSync(readFileSync(`data/dem/${l.file}`)), l.n, meta.dnToMeters)));

// refine: 'summit' -> move to the highest DEM point within `radiusKm` (named massifs whose IAU
// coordinate marks the feature, not its top). Literature/mission coordinates are kept as published.
const SITES = [
  // --- South pole: illumination references & targets -------------------------------------
  { id: 'c1', name: 'Connecting Ridge C1', group: 'South pole', lat: -89.44, lon: 222.83, kind: 'Illumination reference',
    note: 'Ridge between Shackleton and de Gerlache craters — the best-lit spot at the south pole (88% average illumination at 2 m).',
    source: 'Gläser et al. 2018, Planet. Space Sci. (NASA NTRS 20170007365)' },
  { id: 'c2', name: 'Connecting Ridge C2', group: 'South pole', lat: -89.31, lon: 245.98, kind: 'Illumination reference',
    note: 'Second ridge site of the same study (78.1% average illumination at 2 m).', source: 'Gläser et al. 2018' },
  { id: 'pns', name: 'Peak near Shackleton', group: 'South pole', lat: -88.74, lon: 124.5, kind: 'Literature high-illumination point',
    note: 'Massif ~30 km from the pole; one of the original Artemis III candidate regions.', source: 'Bussey et al. 2010, Icarus (Kaguya-based illumination study)' },
  { id: 'dgr', name: 'de Gerlache Rim', group: 'South pole', lat: -88.71, lon: 291.3, kind: 'Literature high-illumination point',
    note: 'Rim of de Gerlache crater; Artemis III candidate region "de Gerlache Rim".', source: 'Bussey et al. 2010, Icarus' },
  { id: 'shk', name: 'Shackleton crater floor', group: 'South pole', lat: -89.67, lon: 129.78, kind: 'Permanently shadowed region',
    note: 'Cold trap that may hold water ice. Never sees the Sun or the Earth — shows why rovers must "commute" from lit ridges.',
    source: 'IAU Gazetteer of Planetary Nomenclature (crater center)' },
  { id: 'mal', name: 'Malapert Massif', group: 'South pole', lat: -86.0, lon: 0.0, refine: 'summit', radiusKm: 8, kind: 'Artemis III candidate region',
    note: '~5 km high massif facing the Earth — long proposed for its line of sight to Earth.', source: 'Artemis III candidate region (NASA, 2024); summit located in LOLA DEM' },
  { id: 'mou', name: 'Mons Mouton', group: 'South pole', lat: -84.6, lon: 31.0, refine: 'summit', radiusKm: 8, kind: 'Artemis III candidate region',
    note: 'Highest mountain near the south pole; Artemis III candidate regions "Mons Mouton" and "Mons Mouton Plateau".',
    source: 'IAU Gazetteer; summit located in LOLA DEM' },
  { id: 'nr2', name: 'Nobile Rim 2', group: 'South pole', lat: -84.20156, lon: 60.69989, kind: 'Artemis III candidate region',
    note: 'Rim of Nobile crater, one of the nine NASA Artemis III candidate regions (2024). Site DM2 ranked best for power, ISRU and human factors in a multi-criteria study.',
    source: 'NASA Artemis III candidate regions (2024); site DM2 from arXiv:2406.19863 (Acta Astronautica, 2024)' },
  { id: 'im2', name: 'IM-2 Athena (CLPS)', group: 'Missions', lat: -84.78, lon: 29.13, kind: 'CLPS landing site',
    note: 'Intuitive Machines IM-2 intended landing site on Mons Mouton; landed 6 Mar 2025 (tipped over).',
    source: 'LROC / NASA (Intuitive Machines IM-2 landing region)' , date: '2025-03-06T17:28:00Z' },
  { id: 'im1', name: 'IM-1 Odysseus (CLPS)', group: 'Missions', lat: -80.13, lon: 1.44, kind: 'CLPS landing site',
    note: 'First CLPS landing (22 Feb 2024) near Malapert A crater, 300 km from the pole.',
    source: 'LROC / NASA', date: '2024-02-22T23:23:00Z' },
  // --- Other agencies & historic sites (outside the 75°S terrain model: smooth-sphere horizon) ----
  { id: 'ch3', name: 'Chandrayaan-3 Vikram (ISRO)', group: 'Missions', lat: -69.373, lon: 32.319, kind: 'ISRO landing site',
    note: 'India\'s 2023 landing "Shiv Shakti point", the southernmost landing at the time.', source: 'ISRO / LROC', date: '2023-08-23T12:34:00Z' },
  { id: 'slim', name: 'SLIM (JAXA)', group: 'Missions', lat: -13.316, lon: 25.251, kind: 'JAXA landing site',
    note: 'Japan\'s pinpoint lander (19 Jan 2024) near Shioli crater.', source: 'JAXA / LROC', date: '2024-01-19T15:20:00Z' },
  { id: 'ce4', name: "Chang'e-4 (CNSA, far side)", group: 'Missions', lat: -45.4446, lon: 177.5991, kind: 'Far-side landing site',
    note: 'On the far side the Earth is always below the horizon — direct-to-Earth contact is impossible, so a relay satellite (Queqiao) is required.',
    source: 'CNSA / LROC', date: '2019-01-03T02:26:00Z' },
  { id: 'a11', name: 'Apollo 11', group: 'Historic', lat: 0.67408, lon: 23.47297, kind: 'Apollo landing site',
    note: 'Equatorial site for contrast: the Sun climbs high and Earth hangs almost overhead.', source: 'LROC (Apollo 11 LM position)', date: '1969-07-20T20:17:40Z' },
  { id: 'a17', name: 'Apollo 17', group: 'Historic', lat: 20.1908, lon: 30.77168, kind: 'Apollo landing site',
    note: 'Taurus-Littrow valley, last crewed landing (1972).', source: 'LROC (Apollo 17 LM position)', date: '1972-12-11T19:54:57Z' },
];

function refineSummit(s) {
  const c = Dem.toXY(s.lat, s.lon);
  let best = { h: -Infinity };
  const step = 120, R = s.radiusKm * 1000;
  for (let dx = -R; dx <= R; dx += step) for (let dy = -R; dy <= R; dy += step) {
    if (dx * dx + dy * dy > R * R) continue;
    const ll = Dem.toLatLon(c.x + dx, c.y + dy);
    const h = dem.heightAt(ll.lat, ll.lon);
    if (h > best.h) best = { h, ...ll };
  }
  return { lat: +best.lat.toFixed(4), lon: +best.lon.toFixed(3) };
}

const win = sampleWindow(Date.UTC(2025, 0, 1), Date.UTC(2045, 0, 1), 120);
const out = [];
for (const s of SITES) {
  const site = { ...s };
  if (s.refine === 'summit') Object.assign(site, refineSummit(s), { refined: `summit within ${s.radiusKm} km of ${s.lat}, ${s.lon}` });
  delete site.refine; delete site.radiusKm;
  const hz = computeHorizon(dem, site.lat, site.lon, 2, 720);
  const m = summarize(analyzeSeries(win, siteFrame(site.lat, site.lon, hz.siteM), hz.mask), win.t[0]);
  site.terrain = hz.terrain;
  site.groundM = hz.terrain ? Math.round(hz.groundM) : null;
  site.longTerm = { period: '2025–2044', heightM: 2, sunPct: +m.sunPct.toFixed(1), earthPct: +m.earthPct.toFixed(1), longestNightH: Math.round(m.longestNightH) };
  out.push(site);
  console.log(site.name.padEnd(32), String(site.lat).padStart(9), String(site.lon).padStart(9), (site.groundM ?? '—').toString().padStart(6), 'm',
    'sun', site.longTerm.sunPct.toString().padStart(5), '% earth', site.longTerm.earthPct.toString().padStart(5), '% night', site.longTerm.longestNightH, 'h');
}
writeFileSync('data/sites.json', JSON.stringify({ generated: new Date().toISOString(), sites: out }, null, 1));
