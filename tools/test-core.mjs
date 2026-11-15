// Unit tests for the physics/geometry core (no test framework, no network, no DEM download needed).
// Usage: node tools/test-core.mjs        Exit code 1 if anything fails.
import { createRequire } from 'node:module';
globalThis.Astronomy = createRequire(import.meta.url)('../vendor/astronomy.js');

const { destination, bearingTo } = await import('../js/core/geo.js');
const { dispersionPoints } = await import('../js/core/dispersion.js');
const { diskFractionAbove, horizonAt } = await import('../js/core/horizon.js');
const { simulateBattery, runs, summarize } = await import('../js/core/analysis.js');
const { decodeLevel } = await import('../js/core/dem.js');
const { moonFixed, subPoint, siteFrame, azel, earthPhase } = await import('../js/core/ephemeris.js');
const { pickBest, rankOf } = await import('../js/core/bestdates.js');
const { scoreScenario } = await import('../js/core/score.js');
const { fromInputUTC, wrap180 } = await import('../js/ui/util.js');

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- great-circle navigation: destination ∘ bearingTo round trip, near the pole and elsewhere
for (const [lat, lon] of [[-89.44, 222.83], [-84.78, 29.13], [-75.5, 300], [0.67, 23.47]]) {
  for (const az of [0, 45, 137.5, 270, 359]) {
    for (const d of [0.05, 0.5, 5, 120]) {
      const p = destination(lat, lon, az, d), b = bearingTo(lat, lon, p.lat, p.lon);
      check(`geo distance ${lat},${az},${d}`, near(b.distKm, d, 1e-6 * Math.max(1, d)), `${b.distKm}`);
      check(`geo azimuth ${lat},${az},${d}`, Math.abs(wrap180(b.az - az)) < 1e-4, `${b.az}`);
    }
  }
}

// --- landing ellipse: 19 points, target + 6 at r/2 + 12 at r
{
  const pts = dispersionPoints(-89.44, 222.83, 0.5);
  check('ellipse count', pts.length === 19);
  const r = pts.map(p => bearingTo(-89.44, 222.83, p.lat, p.lon).distKm);
  check('ellipse target', r[0] < 1e-9 && pts[0].target === true);
  check('ellipse inner ring', r.slice(1, 7).every(x => near(x, 0.25, 1e-6)));
  check('ellipse outer ring', r.slice(7).every(x => near(x, 0.5, 1e-6)));
}

// --- solar-disk occultation: half disk at the horizon, monotonic, clamped
check('disk at horizon = 0.5', near(diskFractionAbove(0, 0.267), 0.5, 1e-12));
check('disk fully up', diskFractionAbove(0.3, 0.267) === 1 && diskFractionAbove(-0.3, 0.267) === 0);
{
  let prev = -1, mono = true;
  for (let d = -0.3; d <= 0.3; d += 0.005) { const f = diskFractionAbove(d, 0.267); if (f < prev - 1e-12) mono = false; prev = f; }
  check('disk monotonic', mono);
  check('disk symmetric', near(diskFractionAbove(0.1, 0.267) + diskFractionAbove(-0.1, 0.267), 1, 1e-12));
}
{
  const mask = new Float32Array(720).map((_, k) => k / 720);       // linear ramp 0..1 over the bins
  check('horizon interpolation', near(horizonAt(mask, 90.25), (180.5) / 720, 1e-6));
  check('horizon wraps', near(horizonAt(mask, -0.5), horizonAt(mask, 359.5), 1e-9));
}

// --- battery: full sun never empties; darkness empties after capacity / load hours
{
  const n = 240, t = Float64Array.from({ length: n }, (_, i) => i * 3600e3);
  const sunny = simulateBattery({ n, stepMin: 60, t, power: new Float32Array(n).fill(1361) }, { areaM2: 4, effPct: 30, loadW: 150, capKWh: 5 });
  check('battery sunny survives', sunny.survives && near(sunny.minSocPct, 100, 1e-9));
  const dark = simulateBattery({ n, stepMin: 60, t, power: new Float32Array(n) }, { areaM2: 4, effPct: 30, loadW: 150, capKWh: 5 });
  // 5 kWh / 150 W = 33.3 h -> the first empty sample is hour 34 (index 33)
  check('battery dark empties at 33.3 h', !dark.survives && dark.firstEmpty === t[33], `${dark.firstEmpty / 3600e3}`);
}

// --- runs(): contiguous intervals
{
  const S = { n: 8, t: Float64Array.from({ length: 8 }, (_, i) => i) };
  const r = runs(S, i => [0, 1, 1, 0, 0, 1, 1, 1][i] === 1);
  check('runs', r.length === 2 && r[0].i0 === 1 && r[0].i1 === 2 && r[1].i0 === 5 && r[1].openEnd === true);
}

// --- terrain horizon on synthetic terrain with an analytic answer (geometry of core/horizon.js, independent of LOLA)
{
  const { Dem } = await import('../js/core/dem.js');
  const { computeHorizon } = await import('../js/core/horizon.js');
  const R = 1737400, n = 401, off = 200, scale = 240, D2R = Math.PI / 180;
  const grid = f => { const a = new Float32Array(n * n); for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) a[r * n + c] = f(Math.hypot((c - off) * scale, (off - r) * scale)); return a; };
  const dem = (heights, maxM) => new Dem({ radiusM: R, maxM, levels: [{ n, scale, off, latLimit: -88.5 }] }, [heights]);
  // 1) smooth sphere: from 100 m up, the horizon dips by acos(R / (R + h)) in every direction
  const flat = computeHorizon(dem(grid(() => 0), 0), -90, 0, 100, 360);
  const dip = -Math.acos(R / (R + 100)) / D2R;
  const errFlat = Math.max(...flat.mask.map(v => Math.abs(v - dip)));
  check('horizon of a smooth sphere = geometric dip', errFlat < 0.01, `dip ${dip.toFixed(4)}°, max err ${errFlat.toFixed(4)}°`);
  // 2) a 1000 m ring wall 20–22 km from the pole: horizon = elevation of the wall's inner top edge, exact spherical formula
  const wall = computeHorizon(dem(grid(rho => (rho >= 20000 && rho <= 22000 ? 1000 : 0)), 1000), -90, 0, 2, 360);
  // on a 240 m grid with bilinear interpolation the wall reaches full height between 20.0 km and one cell diagonal
  // (340 m) further out, plus at most one 120 m march step: the horizon must lie between those exact elevations
  const elevAt = s => { const th = s / R, rt = R + 1000; return Math.atan((rt * Math.cos(th) - (R + 2)) / (rt * Math.sin(th))) / D2R; };
  const hi = elevAt(20000), lo = elevAt(20000 + 240 * Math.SQRT2 + 120);
  const inside = [...wall.mask].every(v => v <= hi + 0.005 && v >= lo - 0.005);
  check('horizon of a ring wall within the exact spherical bounds', inside, `[${lo.toFixed(3)}°, ${hi.toFixed(3)}°] got ${Math.min(...wall.mask).toFixed(3)}–${Math.max(...wall.mask).toFixed(3)}°`);
  check('horizon distance = the wall', [...wall.dist].every(d => d > 19.7 && d < 20.4), `${Math.min(...wall.dist).toFixed(2)}–${Math.max(...wall.dist).toFixed(2)} km`);
}

// --- DEM decoding: per-row delta + byte planes (inverse of tools/build-dem.mjs)
{
  const n = 4, dn = [0, 5, -3, 32767, 10, 9, 8, 7, -32768, -32768, 0, 1, 100, -100, 100, -100];
  const bytes = new Uint8Array(2 * n * n);
  for (let r = 0; r < n; r++) {
    let prev = 0;
    for (let c = 0; c < n; c++) {
      const i = r * n + c, d = (dn[i] - prev) << 16 >> 16;          // int16 wrap-around, as the encoder
      bytes[i] = d & 0xff; bytes[n * n + i] = (d >> 8) & 0xff; prev = dn[i];
    }
  }
  const out = decodeLevel(bytes, n, 0.5);
  check('DEM decode', dn.every((v, i) => out[i] === v * 0.5), `${[...out]}`);
}

// --- ephemeris sanity (full validation vs JPL Horizons: tools/validate-horizons.mjs)
{
  let maxLat = 0;
  for (let d = 0; d < 366; d += 3) maxLat = Math.max(maxLat, Math.abs(subPoint(moonFixed(new Date(Date.UTC(2027, 0, 1) + d * 864e5)).sun).lat));
  check('sub-solar latitude within the 1.54° lunar obliquity', maxLat > 1.3 && maxLat < 1.65, `${maxLat}`);
  const g = moonFixed(new Date(Date.UTC(2027, 2, 1)));
  const sub = subPoint(g.earth);
  check('sub-Earth point within libration limits', Math.abs(sub.lat) < 7 && Math.abs(wrap180(sub.lon)) < 8.5, `${sub.lat},${sub.lon}`);
  check('Earth distance', g.earth && near(Math.hypot(...g.earth), 384400, 30000));
  const f = siteFrame(0, 0, 0), e = azel(g.earth, f);
  check('Earth near zenith at the sub-Earth region', e.el > 75, `${e.el}`);
  const ph = earthPhase(g.sun, g.earth);
  check('Earth phase in [0,1]', ph >= 0 && ph <= 1);
}

// --- window sampling: long windows interpolate between 3-h nodes; must stay sub-arcsecond vs exact evaluation
{
  const { sampleWindow } = await import('../js/core/ephemeris.js');
  const ang = (a, b) => { const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)); return Math.acos(Math.min(1, c)) * 206264.806; };
  for (const [days, step] of [[29.53, 15], [400, 60], [20, 7]]) {
    const t0 = Date.UTC(2028, 4, 3, 1, 17), w = sampleWindow(t0, t0 + days * 864e5, step);
    let es = 0, ee = 0;
    for (let i = 0; i < w.n; i += Math.max(1, Math.floor(w.n / 300))) {
      const g = moonFixed(new Date(w.t[i])), j = 3 * i;
      es = Math.max(es, ang(g.sun, [w.sun[j], w.sun[j + 1], w.sun[j + 2]]));
      ee = Math.max(ee, ang(g.earth, [w.earth[j], w.earth[j + 1], w.earth[j + 2]]));
    }
    check(`sampleWindow ${days} d @ ${step} min within 1″ of exact`, es < 1 && ee < 1, `sun ${es.toFixed(3)}″ earth ${ee.toFixed(3)}″`);
  }
}

// --- best-date picking: spacing and ranking
{
  const cells = [5, 9, 9, 1, 9, 7, 2].map((s, d) => ({ startMs: d * 864e5, m: { score: s, bothPct: 0, sunPct: 0 } }));
  const top = pickBest(cells, 3, 2);
  check('pickBest spacing', top.every((a, i) => top.every((b, j) => i === j || Math.abs(a.startMs - b.startMs) >= 2 * 864e5)));
  check('pickBest order', top[0].m.score === 9 && top.length === 3, JSON.stringify(top.map(c => c.m.score)));
  check('rankOf', rankOf(cells, cells[0]) === 5);
}

// --- score policy guard rails (whatever policy the team writes, keep it in 0..100)
for (const m of [{ sunPct: 0, earthPct: 100 }, { sunPct: 100, earthPct: 100 }, { sunPct: 37, earthPct: 64 }]) {
  const s = scoreScenario({ bothPct: 0, longestNightH: 0, longestCommGapH: 0, meanPowerWm2: 0, minSocPct: 100, survives: true, ...m });
  check(`score in range ${JSON.stringify(m)}`, Number.isFinite(s) && s >= 0 && s <= 100, `${s}`);
}

// --- tolerant time parsing for share links
check('time: minutes', fromInputUTC('2027-03-01T06:30') === Date.UTC(2027, 2, 1, 6, 30));
check('time: date only', fromInputUTC('2027-03-01') === Date.UTC(2027, 2, 1));
check('time: seconds + Z', fromInputUTC('2027-03-01T06:30:15Z') === Date.UTC(2027, 2, 1, 6, 30, 15));
check('time: garbage', Number.isNaN(fromInputUTC('garbage')) && Number.isNaN(fromInputUTC(null)));

// --- DSN fast path vs Astronomy Engine's full topocentric Equator() + Horizon() (apparent, of date)
{
  const { dsnVisibility, DSN } = await import('../js/core/dsn.js');
  const A = globalThis.Astronomy;
  for (const t0 of [Date.UTC(2027, 2, 1), Date.UTC(2031, 8, 17, 5, 30)]) {
    const n = 500, stepMin = 37;                                     // odd step: samples fall between the 3-h nodes
    const win = { n, stepMin, t: Float64Array.from({ length: n }, (_, i) => t0 + i * stepMin * 60000) };
    const fast = dsnVisibility(win);
    let maxErr = 0, flips = 0, checked = 0;
    for (let i = 0; i < n; i += 5) {
      const time = A.MakeTime(new Date(win.t[i]));
      let any = 0;
      DSN.forEach((s, k) => {
        const o = new A.Observer(s.lat, s.lon, s.h), eq = A.Equator(A.Body.Moon, time, o, true, true);
        const ref = A.Horizon(time, o, eq.ra, eq.dec, null).altitude;
        maxErr = Math.max(maxErr, Math.abs(ref - fast.el[k][i]));
        if (ref >= 10) any = 1;
        checked++;
      });
      if (any !== fast.any[i]) flips++;
    }
    check(`DSN fast elevations vs full topocentric (${new Date(t0).getUTCFullYear()})`, maxErr < 0.05, `${maxErr.toFixed(4)}° over ${checked}`);
    check(`DSN visibility flags (${new Date(t0).getUTCFullYear()})`, flips <= 1, `${flips} flips`);
  }
}

// --- DSN antenna line of sight from the lunar surface vs an exact reference built from Astronomy Engine
{
  const { dsnVisibility, dsnLineOfSight, DSN } = await import('../js/core/dsn.js');
  const { sampleWindow, moonRotation } = await import('../js/core/ephemeris.js');
  const A = globalThis.Astronomy, AU = 149597870.7, R2D = 180 / Math.PI;
  const t0 = Date.UTC(2027, 2, 1, 3), win = sampleWindow(t0, t0 + 6 * 864e5, 37);          // interpolated paths on purpose
  const frame = siteFrame(-89.44, 222.83, 1954), mask = new Float32Array(720);              // Connecting Ridge, flat horizon
  const los = dsnLineOfSight(win, frame, mask, dsnVisibility(win), 0);
  let maxErr = 0, maxOff = 0;
  for (let i = 0; i < win.n; i += 9) {
    const date = new Date(win.t[i]), time = A.MakeTime(date), R = moonRotation(date), moon = A.GeoMoon(time), p = frame.pos;
    const sx = R[0] * p[0] + R[3] * p[1] + R[6] * p[2], sy = R[1] * p[0] + R[4] * p[1] + R[7] * p[2], sz = R[2] * p[0] + R[5] * p[1] + R[8] * p[2];
    const earthEl = azel([win.earth[3 * i], win.earth[3 * i + 1], win.earth[3 * i + 2]], frame).el;
    DSN.forEach((d, s) => {
      const o = A.ObserverVector(time, new A.Observer(d.lat, d.lon, d.h), false);          // antenna, geocentric EQJ
      const vx = (o.x - moon.x) * AU - sx, vy = (o.y - moon.y) * AU - sy, vz = (o.z - moon.z) * AU - sz;
      const mx = R[0] * vx + R[1] * vy + R[2] * vz, my = R[3] * vx + R[4] * vy + R[5] * vz, mz = R[6] * vx + R[7] * vy + R[8] * vz;
      const el = Math.asin((mx * frame.up[0] + my * frame.up[1] + mz * frame.up[2]) / Math.hypot(mx, my, mz)) * R2D;
      maxErr = Math.max(maxErr, Math.abs(el - los.skyEl[s][i]));
      maxOff = Math.max(maxOff, Math.abs(el - earthEl));
    });
  }
  check('DSN antenna line of sight vs exact reference', maxErr < 0.01, `${maxErr.toFixed(4)}°`);
  check('antennas sit up to ~1 Earth radius off the disk centre', maxOff > 0.5 && maxOff < 1.0, `${maxOff.toFixed(3)}°`);
}

// --- summarize(): KPIs from a synthetic two-day series
{
  const n = 48, S = { n, stepMin: 60, t: Float64Array.from({ length: n }, (_, i) => i * 3600e3),
    sunAz: new Float32Array(n), sunEl: new Float32Array(n).fill(1), sunHz: new Float32Array(n), sunFrac: new Float32Array(n).map((_, i) => (i < 30 ? 1 : 0)),
    earthAz: new Float32Array(n), earthEl: new Float32Array(n).fill(3), earthHz: new Float32Array(n), earthVis: new Uint8Array(n).map((_, i) => (i % 2)),
    power: new Float32Array(n).map((_, i) => (i < 30 ? 1300 : 0)), sunDist: new Float32Array(n).fill(149597870.7), earthDist: new Float32Array(n).fill(384400) };
  const M = summarize(S, 0);
  check('summarize sunlight %', near(M.sunPct, 100 * 30 / 48, 1e-9));
  check('summarize Earth %', near(M.earthPct, 50, 1e-9));
  check('summarize longest night', M.longestNightH === 18);
  check('summarize next sunset', M.now.sunUp && M.now.nextSun > S.t[29] && M.now.nextSun < S.t[30]);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
