// Learn tab: short lessons, each backed by numbers computed live from LOLA + the ephemeris,
// and each one click away from the matching live view.
// The cards appear at once; the numbers (a year of hourly geometry, several sites) are computed right after,
// one ephemeris pass per window length, yielding to the browser between steps so the tab never freezes.
import { fmtDeg, fmtDur } from './util.js';
import { sampleWindow, siteFrame } from '../core/ephemeris.js';
import { DSN, DSN_MIN_EL, dsnVisibility, dsnLineOfSight } from '../core/dsn.js';

let cache = null, computing = null, ellipse = null, ellipseJob = null;

// Lesson 8 example (also used in the README, slides and video): Connecting Ridge, 14 days from 1 Mar 2027, ±500 m
const ELLIPSE_SC = { startMs: Date.UTC(2027, 2, 1), durDays: 14, rKm: 0.5 };
const LANDER = { areaM2: 4, effPct: 30, loadW: 150, capKWh: 5 };
const DAY = 864e5, LUNAR_DAY = 29.53;
const tick = () => new Promise(r => setTimeout(r, 0));

async function computeFacts(year, { sites, analyzeScenario, HEIGHTS }) {
  const S = id => sites.find(s => s.id === id), t0 = Date.UTC(year, 0, 1);
  const c1 = S('c1'), a11 = S('a11'), shk = S('shk'), ce4 = S('ce4');
  const run = (site, win, days, heightIdx = 1) => analyzeScenario({ site, startMs: t0, durDays: days, heightIdx, commDeg: 0, power: LANDER, win });
  // one lunar day (15-min steps) shared by three sites
  const wDay = sampleWindow(t0, t0 + LUNAR_DAY * DAY, 15);
  const c1Day = run(c1, wDay, LUNAR_DAY), a11Day = run(a11, wDay, LUNAR_DAY), ce4Day = run(ce4, wDay, LUNAR_DAY);
  await tick();
  // one year + 7 days (hourly); the plain year is its first 8767 samples (identical grid)
  const wY7 = sampleWindow(t0, t0 + (365.25 + 7) * DAY, 60);
  await tick();
  const n = Math.floor(365.25 * 24) + 1;
  const wY = { n, stepMin: 60, t: wY7.t.subarray(0, n), sun: wY7.sun.subarray(0, 3 * n), earth: wY7.earth.subarray(0, 3 * n) };
  const masts = [];
  for (const hi of [0, 1, 3]) { const r = run(c1, wY, 365.25, hi); masts.push({ h: HEIGHTS[hi], M: r.M, S: r.S, hz: r.hz }); await tick(); }
  // every 7-day landing window of the year (sliding over the hourly series): best and worst start dates
  const Sy = run(c1, wY7, 365.25 + 7).S, per = Math.round(1440 / Sy.stepMin), W = 7 * per, pf = new Float64Array(Sy.n + 1);
  for (let i = 0; i < Sy.n; i++) pf[i + 1] = pf[i] + Sy.sunFrac[i];
  let best = null, worst = null;
  for (let d = 0; d < 365; d++) { const a = d * per, v = 100 * (pf[a + W] - pf[a]) / W; if (!best || v > best.v) best = { d, v }; if (!worst || v < worst.v) worst = { d, v }; }
  const earthRange = r => { let lo = 90, hi = -90; for (let i = 0; i < r.S.n; i++) { lo = Math.min(lo, r.S.earthEl[i]); hi = Math.max(hi, r.S.earthEl[i]); } return [lo, hi]; };
  // where the DSN antennas sit on Earth's disk, seen from Connecting Ridge (mean offset from the disk centre while in use)
  const yr = masts[1], vis = dsnVisibility(wY), los = dsnLineOfSight(wY, siteFrame(c1.lat, c1.lon, yr.hz.siteM), yr.hz.mask, vis, 0);
  const antenna = DSN.map((d, k) => { let sum = 0, cnt = 0; for (let i = 0; i < wY.n; i++) if (vis.el[k][i] >= DSN_MIN_EL) { sum += los.skyEl[k][i] - yr.S.earthEl[i]; cnt++; } return { name: d.name, off: sum / cnt }; });
  await tick();
  const R = 1737.4, d2r = Math.PI / 180, la1 = c1.lat * d2r, la2 = shk.lat * d2r, dl = (shk.lon - c1.lon) * d2r;
  const dist = R * Math.acos(Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl)));
  return { year, c1Day, a11Day, ce4Day, masts, best, worst, yearRun: masts[1].M, c1Earth: earthRange(c1Day), ce4Earth: earthRange(ce4Day), dist, antenna };
}

export function renderLearn(root, ctx) {
  const year = new Date(ctx.state.startMs).getUTCFullYear();
  if (cache?.year === year) return paint(root, ctx, cache, year);
  paint(root, ctx, null, year);                                          // cards now, live numbers in a moment
  if (computing?.year !== year) {
    const job = { year };
    job.p = tick().then(() => computeFacts(year, ctx)).then(c => {        // after the cards have painted
      if (computing !== job) return;
      cache = c; computing = null;
      if (root.offsetParent) paint(root, ctx, c, year);                  // still on screen: fill the numbers in
    });
    computing = job;
  }
}

function paint(root, { sites, openScenario, switchView, HEIGHTS, ellipseStats }, c, year) {
  const S = id => sites.find(s => s.id === id), t0 = Date.UTC(year, 0, 1);
  const c1 = S('c1'), shk = S('shk'), ce4 = S('ce4');
  const day = d => new Date(t0 + d * DAY).toLocaleString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const open = (sc, opts = {}) => openScenario(sc, { layer: 1, resetView: true, ...opts });   // lessons start from a clean map
  const wait = '<span class="muted">Computing the live numbers…</span>';
  const fact = f => (c ? f() : wait);
  const lessons = [
    { t: 'The Sun never climbs', p: 'The Moon\'s spin axis is tilted only 1.54° to the ecliptic, so at the pole the Sun circles the sky skimming the horizon instead of rising overhead. Solar arrays must stand vertical and track it.',
      f: fact(() => `Highest Sun in one lunar day: ${fmtDeg(c.c1Day.M.sunElMax, 1)} at Connecting Ridge vs ${fmtDeg(c.a11Day.M.sunElMax, 1)} at Apollo 11.`),
      go: () => open({ site: c1, startMs: t0, durDays: LUNAR_DAY, heightIdx: 1 }, { viewMode: 'eye' }), b: 'See it through an astronaut\'s eyes' },
    { t: 'Terrain decides everything', p: 'With the Sun that low, a crater wall kilometres away can block it for months. Neighbouring spots live in completely different worlds: rims glow while crater floors stay frozen in permanent shadow, where water ice can survive.',
      f: fact(() => `${c.dist.toFixed(0)} km apart: Shackleton floor ${shk.longTerm.sunPct}% vs Connecting Ridge ${c1.longTerm.sunPct}% sunlight (20-yr average).`),
      go: () => open({ site: c1, startMs: t0, durDays: 365.25, heightIdx: 1 }, { layer: 3, mv: [-6, -4, 70] }), b: 'Map a whole year of sunlight' },
    { t: 'A few metres of mast = power', p: 'Near the horizon, every metre of height lets an array peek over nearby ridges. That is why NASA studies 10–20 m vertical solar array towers for the south pole.',
      f: fact(() => `Connecting Ridge in ${year}: ${c.masts.map(x => `${x.h} m → ${x.M.sunPct.toFixed(0)}%`).join(', ')} sunlight; longest darkness ${fmtDur(c.masts[0].M.longestNightH)} → ${fmtDur(c.masts[2].M.longestNightH)}.`),
      go: () => open({ site: c1, startMs: t0, durDays: 365.25, heightIdx: 3 }, { viewMode: 'orbit' }), b: 'Try a 10 m mast' },
    { t: 'Surviving the night', p: 'Even the best-lit ridge has nights lasting days. A small lander must carry batteries for the longest one, while a crewed outpost would need tonnes of them. That is why NASA is developing Fission Surface Power for the Moon.',
      f: fact(() => `Connecting Ridge, ${year}: longest darkness ${fmtDur(c.yearRun.longestNightH)} → ${(c.yearRun.longestNightH * 0.15).toFixed(0)} kWh of battery for a 150 W lander. A CLPS-class 5 kWh pack ${c.yearRun.survives ? 'survives' : 'runs empty'}.`),
      go: () => open({ site: c1, startMs: t0, durDays: 365.25, heightIdx: 1 }, { preset: 'lander' }), b: 'Run the battery simulation' },
    { t: 'Earth wobbles (libration)', p: 'Earth never moves far in the lunar sky, but libration makes it bob up and down by about ±7°. At the pole that is the difference between a radio link and silence. And the antenna on Earth matters too: seen from the south pole, Earth\'s southern hemisphere faces up, so Canberra sits on the upper half of the disk and keeps the link longest when Earth grazes the horizon.',
      f: fact(() => `At Connecting Ridge Earth swings between ${fmtDeg(c.c1Earth[0], 1)} and ${fmtDeg(c.c1Earth[1], 1)} over one lunar day: in view ${c.c1Day.M.earthPct.toFixed(0)}% of the time. On Earth's disk, ${c.antenna.map(a => `${a.name} ${fmtDeg(a.off, 2)}`).join(', ')} from the centre.`),
      go: () => open({ site: c1, startMs: t0, durDays: LUNAR_DAY, heightIdx: 1 }), b: 'See the Earth bob' },
    { t: 'The far side cannot call home', p: 'From the lunar far side the Earth never rises. Chang\'e-4 and Chang\'e-6 needed the Queqiao relay satellites to talk to Earth.',
      f: fact(() => `At Chang'e-4, Earth stays between ${fmtDeg(c.ce4Earth[0], 0)} and ${fmtDeg(c.ce4Earth[1], 0)}. Direct-to-Earth time: ${c.ce4Day.M.earthPct.toFixed(0)}%.`),
      go: () => open({ site: ce4, startMs: Date.parse(ce4.date), durDays: 14, heightIdx: 1 }), b: 'Open Chang\'e-4' },
    { t: 'When you land matters', p: 'The lunar "seasons" (1.54° tilt) and the Earth\'s libration shift the light from month to month. A one-month slip can make or break a solar-powered mission.',
      f: fact(() => `7-day missions at Connecting Ridge in ${year}: best landing ${day(c.best.d)} (${c.best.v.toFixed(0)}% sunlight), worst ${day(c.worst.d)} (${c.worst.v.toFixed(0)}%).`),
      go: () => switchView('compare'), b: 'Open the when & where heatmap' },
    { t: 'Land on target', p: 'Landers do not touch down exactly where they aim. In March 2025 IM-2 Athena came down about 250 m from its target, inside a small crater, and its mission ended the next day. At the pole a few hundred metres can separate a sunlit ridge from a shadow.',
      f: ellipse ? ellipseFact(ellipse) : 'Re-running a 14-day mission at 19 touchdown points of a ±500 m landing ellipse on Connecting Ridge…', id: 'fact-ellipse',
      go: () => open({ site: c1, startMs: ELLIPSE_SC.startMs, durDays: ELLIPSE_SC.durDays, heightIdx: 1 }, { preset: 'lander', ellipseKm: ELLIPSE_SC.rKm }),
      b: 'Check the landing ellipse' },
  ];
  root.innerHTML = '';
  lessons.forEach((l, i) => {
    const card = document.createElement('section');
    card.className = 'card lesson';
    card.innerHTML = `<span class="num">0${i + 1}</span><h3>${l.t}</h3><p>${l.p}</p><div class="fact"${l.id ? ` id="${l.id}"` : ''}>${l.f}</div>`;
    const btn = document.createElement('button'); btn.className = 'btn primary'; btn.textContent = `${l.b} →`; btn.onclick = l.go;
    card.append(btn); root.append(card);
  });
  // the ellipse needs 19 horizon computations: fill that fact in after the cards are on screen (once)
  if (!ellipse && !ellipseJob && ellipseStats) {
    ellipseJob = ellipseStats({ site: c1, ...ELLIPSE_SC, power: LANDER }).then(r => {
      ellipse = r;
      const el = document.getElementById('fact-ellipse');
      if (el) el.textContent = ellipseFact(r);
    });
  }
}

function ellipseFact(r) {
  return `Connecting Ridge, 14 days from 1 Mar 2027, ±500 m: sunlight ${r.sun[0].toFixed(0)}–${r.sun[1].toFixed(0)}% depending on where you touch down; a CLPS-class battery survives at ${r.survive} of ${r.pts.length} points.`;
}
