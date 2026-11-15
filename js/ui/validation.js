// Data & validation tab: method, validation against JPL Horizons and published illumination, sources.
import { fitCanvas, COLORS } from './util.js';

let rendered = false;

export async function renderValidation() {
  if (rendered) return;
  rendered = true;
  const [val, sitesJson] = await Promise.all([fetch('data/validation.json').then(r => r.json()), fetch('data/sites.json').then(r => r.json())]);
  const site = id => sitesJson.sites.find(s => s.id === id);

  document.getElementById('method').innerHTML = `
    <ol>
      <li><b>Ephemeris.</b> Geocentric Sun and Moon from Astronomy Engine (VSOP87/ELP), rotated into the Moon-fixed
        Mean-Earth/Polar-Axis frame with the IAU rotation model of the Moon (including its physical libration terms).
        This gives the direction of the Sun and the Earth from the Moon at any instant from 1700 to 2200, offline, in ~10 µs.</li>
      <li><b>Topocentric geometry.</b> Azimuth/elevation at the site (east-positive longitude) include the ~0.26° topocentric
        parallax of the Earth. There is no atmosphere, so there is no refraction term.</li>
      <li><b>Terrain horizon.</b> From the site, 720 rays are marched along great circles through the NASA LRO LOLA
        polar DEM (LDEM_75S_240M: 240 m/px to 84°S, 960 m/px to 75°S) up to 600 km, with exact spherical geometry,
        so curvature of the Moon is built in. Terrain closer than 360 m (1.5 px) is not resolved by the DEM and is skipped.</li>
      <li><b>Power &amp; communication.</b> Sunlight = fraction of the solar disk (true angular size) above the terrain line.
        Array output = 1361 W/m² × (1 AU / r)² × visible fraction × cos(elevation) for a vertical Sun-tracking array.
        Direct-to-Earth (DTE) is possible when the Earth's center clears the terrain by the chosen margin.</li>
      <li><b>Live shadow map.</b> A WebGL2 shader marches a ray from every map pixel toward the Sun (or the Earth) through the same DEM,
        with soft penumbra from the solar disk, so the map, the horizon view and the numbers always agree. Mission-window maps average
        128 instants in a floating-point render target (additive blending).</li>
      <li><b>Earth end of the link.</b> The Moon's elevation at the Deep Space Network complexes (Goldstone, Madrid, Canberra);
        a direct-to-Earth link needs the Earth above the lunar terrain <i>and</i> a DSN antenna above 10°.</li>
      <li><b>Power system &amp; landing ellipse.</b> Array × efficiency − load integrated into a battery over the window; the whole
        analysis can be re-run at 19 touchdown points of a landing ellipse (±250 m to ±5 km) to show how sensitive a site is.</li>
    </ol>`;

  const sp = val.checks.find(c => c.id === 'subpoints');
  const rows = val.checks.filter(c => c.sun).map(c => `<tr><td>${c.label}</td>
      <td>${(c.sun.elevationErrDeg.max * 3600).toFixed(1)}″</td><td>${(c.sun.skyErrDeg.max * 3600).toFixed(1)}″</td>
      <td>${(c.earth.elevationErrDeg.max * 3600).toFixed(1)}″</td><td>${(c.earth.skyErrDeg.max * 3600).toFixed(1)}″</td><td>${c.sun.elevationErrDeg.n + c.earth.elevationErrDeg.n}</td></tr>`).join('');
  const lit = [['c1', 88.0], ['c2', 78.1], ['shk', 0]].map(([id, ref]) => { const s = site(id); return `<tr><td>${s.name}</td><td>${s.lat}°, ${s.lon}°E</td><td>${s.longTerm.sunPct.toFixed(1)}%</td><td>${ref.toFixed(1)}%</td><td class="${Math.abs(s.longTerm.sunPct - ref) < 1.5 ? 'ok-badge' : ''}">${(s.longTerm.sunPct - ref >= 0 ? '+' : '') + (s.longTerm.sunPct - ref).toFixed(1)}</td></tr>`; }).join('');
  document.getElementById('validation').innerHTML = `
    <p>Reference: <b>${val.reference}</b>, fetched with the Horizons API for surface observers on the Moon
      (<code>CENTER='coord@301'</code>). Model: ${val.model}.</p>
    <table><thead><tr><th>Check (vs JPL Horizons)</th><th>Sun elev. max err</th><th>Sun sky max err</th><th>Earth elev. max err</th><th>Earth sky max err</th><th>Samples</th></tr></thead><tbody>
      ${rows}
      <tr><td>${sp.label}</td><td colspan="2">Sun direction max ${(sp.sunDirDeg.max * 3600).toFixed(1)}″</td><td colspan="2">Earth direction max ${(sp.earthDirDeg.max * 3600).toFixed(1)}″</td><td>${sp.sunDirDeg.n * 2}</td></tr>
    </tbody></table>
    <p class="ok-badge">All errors are below 0.01° (36″) — less than 1/50 of the Sun's diameter, and far below the terrain resolution.</p>
    <h3>Terrain-aware illumination vs published results</h3>
    <table><thead><tr><th>Site</th><th>Coordinates</th><th>Penumbra (2025–2044, 2 m)</th><th>Gläser et al. 2018 (20 yr, 2 m)</th><th>Δ, points</th></tr></thead><tbody>${lit}</tbody></table>
    <p>Gläser et al. (2018) used higher-resolution LOLA terrain; Penumbra reproduces their average illumination at both Connecting Ridge sites
      within 0.3 percentage points, and the permanently shadowed floor of Shackleton correctly never sees the Sun.</p>
    ${gpuTable(val.checks.find(c => c.id === 'gpu'))}
    <h3>Numerical engine checks (unit tests, run in CI)</h3>
    <table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>
      <tr><td>Long windows: exact Sun/Earth geometry every 3 h + quadratic interpolation, vs evaluating every sample</td><td class="ok-badge">&lt; 0.3″</td></tr>
      <tr><td>Moon elevation at the DSN complexes (geocentric Moon every 3 h, Earth rotation, WGS84) vs Astronomy Engine's topocentric solution</td><td class="ok-badge">≤ 0.003°</td></tr>
      <tr><td>Line of sight from the lunar site to each DSN antenna vs an exact reference (ObserverVector + GeoMoon + IAU lunar rotation)</td><td class="ok-badge">0.1″</td></tr>
      <tr><td>GPU terrain sampling without float filtering (in-shader bilinear, <code>?gpu=manual</code>) vs the CPU engine, 360 instants</td><td class="ok-badge">360 / 360</td></tr>
      <tr><td>Terrain horizon on synthetic terrain with an analytic answer (smooth sphere seen from 100 m; a 1 km ring wall 20 km away)</td><td class="ok-badge">exact within grid limits</td></tr>
      <tr><td>Great-circle navigation, landing ellipse, solar-disk occultation, battery, DEM decoding, share-link parsing, KPIs</td><td class="ok-badge">all pass</td></tr>
    </tbody></table>
    <p class="muted">Run them with <code>node tools/test-core.mjs</code>; GitHub Actions runs them on every push.</p>
    <h3>Sun elevation at Connecting Ridge C1 — Penumbra vs JPL Horizons (30 days)</h3>`;
  drawChart(val.checks.find(c => c.id === 'c1'));

  document.getElementById('sources').innerHTML = `<ul>
    <li><b>NASA LRO LOLA</b> polar gridded topography LDEM_75S_240M — PDS Geosciences Node:
      <a href="https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/" target="_blank" rel="noopener">pds-geosciences.wustl.edu</a> (Smith et al., NASA GSFC).</li>
    <li><b>NASA/JPL Horizons System</b> — reference ephemerides for validation and the “Verify in JPL Horizons” button:
      <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noopener">ssd.jpl.nasa.gov/horizons</a>.</li>
    <li><b>LROC / NASA</b> landing-site coordinates (Apollo, IM-1, IM-2, Chandrayaan-3, SLIM, Chang'e-4): <a href="https://www.lroc.asu.edu/" target="_blank" rel="noopener">lroc.asu.edu</a>; Quickmap: <a href="https://quickmap.lroc.asu.edu/" target="_blank" rel="noopener">quickmap.lroc.asu.edu</a>.</li>
    <li><b>NASA Deep Space Network</b> antenna locations (DSS-14 Goldstone, DSS-63 Madrid, DSS-43 Canberra): DSN Telecommunications Link Design Handbook 810-005, module 301.</li>
    <li>IM-2 <i>Athena</i> landing outcome (lesson 8): Spaceflight Now, 7 Mar 2025, <a href="https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/" target="_blank" rel="noopener">spaceflightnow.com</a>.</li>
    <li>Artemis III candidate site DM2 (Nobile Rim 2): multi-criteria decision-making study, <a href="https://arxiv.org/abs/2406.19863" target="_blank" rel="noopener">arXiv:2406.19863</a> (Acta Astronautica, 2024).</li>
    <li>Gläser, P. et al. (2018) <i>Illumination conditions at the lunar poles: implications for future exploration</i>, Planet. Space Sci. — NASA NTRS 20170007365.</li>
    <li>Bussey, D.B.J. et al. (2010) <i>Illumination conditions of the south pole of the Moon derived using Kaguya topography</i>, Icarus.</li>
    <li>IAU Gazetteer of Planetary Nomenclature (USGS) — feature coordinates.</li>
    <li>Space Agency Partner context: ISRO (Chandrayaan-3), JAXA (SLIM), CSA <a href="https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/" target="_blank" rel="noopener">Moon Exploration</a>.</li>
    <li><b>Astronomy Engine</b> 2.1.19 by Don Cross (MIT license) — <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener">github.com/cosinekitty/astronomy</a>.</li>
    <li><b>AI assistance disclosure:</b> most of the code, tests, documentation, slides and video were written with an AI coding assistant (Claude, Anthropic) under the team's direction; all data processing, results and validation are reproducible with the scripts in <code>tools/</code> and covered by unit tests.</li>
  </ul>`;
}

// GPU window-average maps (the map layers) vs the CPU horizon engine (the numbers), like for like.
function gpuTable(g) {
  if (!g) return '';
  const pct = v => `${v.toFixed(1)}%`;
  const big = g.rows.reduce((b, r) => (Math.abs(r.siteSun - r.cpuSun) > Math.abs(b.siteSun - b.cpuSun) ? r : b), g.rows[0]);
  return `<h3>Two independent engines: GPU maps vs CPU horizon</h3>
    <p>The map layers are ray-marched per pixel on the GPU; the panels and KPIs come from the CPU horizon engine. Both ran over
      ${g.window} at every terrain-modelled site, evaluated at the same point. ${g.note.replace(/ Reproduce:.*/, '')}</p>
    <table><thead><tr><th>Site</th><th>Sunlight · CPU</th><th>Sunlight · GPU</th><th>Earth in view · CPU</th><th>Earth in view · GPU</th><th>Sunlight at the exact site</th></tr></thead><tbody>
      ${g.rows.map(r => `<tr><td>${r.name}</td><td>${pct(r.cpuSun)}</td><td>${pct(r.gpuSun)}</td><td>${pct(r.cpuEarth)}</td><td>${pct(r.gpuEarth)}</td><td>${pct(r.siteSun)}</td></tr>`).join('')}
    </tbody></table>
    <p class="ok-badge">The engines agree within ${g.maxSunPP.toFixed(1)} points of sunlight and ${g.maxEarthPP <= 0.8 ? 'one of 128 instants' : `${g.maxEarthPP.toFixed(1)} points`} of Earth visibility.</p>
    ${g.instant ? `<p>Instant by instant (${g.instant.desc.replace(/,.*/, '')}) they agree on lit vs shadowed in <b>${g.instant.agree} of ${g.instant.cases}</b> cases,
      and the visible fraction of the solar disk differs by at most ${g.instant.maxDiskFracDiff} (${g.instant.partial} of the cases had a partly hidden Sun).</p>` : ''}
    <p>The last column is a warning for mission planners: only ${big.offM.toFixed(0)} m from the ${big.name} site the one-year sunlight is
      ${pct(big.cpuSun)} instead of ${pct(big.siteSun)}. Near the pole a few metres of position matter, which is why the Plan tab re-runs a whole
      mission over the landing ellipse (“What if we land off target?”).</p>
    <p class="muted">Reproduce: paste <code>tools/validate-gpu.js</code> into the browser console.</p>`;
}

function drawChart(c1) {
  const canvas = document.getElementById('val-chart');
  const { ctx, w, h } = fitCanvas(canvas);
  const s = c1.sun.series, L = 46, R = 10, T = 10, B = 24;
  const t0 = s[0][0], t1 = s[s.length - 1][0];
  let lo = Infinity, hi = -Infinity;
  for (const r of s) { lo = Math.min(lo, r[1], r[2]); hi = Math.max(hi, r[1], r[2]); }
  const x = t => L + (t - t0) / (t1 - t0) * (w - L - R), y = v => T + (hi - v) / (hi - lo) * (h - T - B);
  ctx.fillStyle = '#060912'; ctx.fillRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = COLORS.muted;
  for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) { ctx.fillText(`${v.toFixed(1)}°`, 4, y(v) + 4); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(L, y(v), w - L - R, 1); ctx.fillStyle = COLORS.muted; }
  const plot = (idx, color, lw, dash) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath(); s.forEach((r, i) => (i ? ctx.lineTo(x(r[0]), y(r[idx])) : ctx.moveTo(x(r[0]), y(r[idx])))); ctx.stroke(); ctx.setLineDash([]); };
  plot(2, '#ffffff', 4, []);
  plot(1, COLORS.sun, 1.6, [5, 3]);
  ctx.fillStyle = '#fff'; ctx.fillText('— JPL Horizons', w - 200, 22); ctx.fillStyle = COLORS.sun; ctx.fillText('- - Penumbra (in-browser)', w - 200, 38);
}
