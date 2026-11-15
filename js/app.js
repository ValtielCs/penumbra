// Penumbra — app orchestration: state, recompute pipeline, panels.
import { Dem } from './core/dem.js';
import { computeHorizon } from './core/horizon.js';
import { sampleWindow, siteFrame, earthPhase, angularRadius, SUN_R_KM, EARTH_R_KM } from './core/ephemeris.js';
import { analyzeSeries, summarize, DEFAULT_POWER } from './core/analysis.js';
import { scoreScenario } from './core/score.js';
import { DSN, DSN_MIN_EL, dsnVisibility, dsnLineOfSight } from './core/dsn.js';
import { analyzeDispersion } from './core/dispersion.js';
import { rankLandingDays, pickBest, rankOf } from './core/bestdates.js';
import { Panorama } from './ui/panorama.js';
import { Timeline } from './ui/timeline.js';
import { PolarMap } from './ui/map.js';
import { Surface3D } from './ui/view3d.js';
import { Compare } from './ui/compare.js';
import { renderLearn } from './ui/learn.js';
import { renderValidation } from './ui/validation.js';
import { startTour } from './ui/tour.js';
import { openBrief } from './ui/brief.js';
import * as U from './ui/util.js';

export const HEIGHTS = [0.5, 2, 5, 10, 20, 50, 100];
const $ = id => document.getElementById(id);

const state = {
  site: null,
  startMs: Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  durDays: 14, heightIdx: 1, commDeg: 0, tNow: 0, view: 'plan', viewMode: 'pano',
  power: { ...DEFAULT_POWER },
};
let dem = null, sites = [], current = null, panorama, timeline, map, compare, v3d = null;
const hzCache = new Map();
let winCache = { key: '', win: null };

const stepFor = days => (days <= 3 ? 5 : days <= 15 ? 10 : days <= 31 ? 15 : days <= 100 ? 30 : 60);

export function horizonFor(site, heightM) {
  const key = `${site.lat.toFixed(5)},${site.lon.toFixed(5)},${heightM}`;
  if (!hzCache.has(key)) {
    if (hzCache.size > 60) hzCache.delete(hzCache.keys().next().value);
    hzCache.set(key, computeHorizon(dem, site.lat, site.lon, heightM, 720));
  }
  return hzCache.get(key);
}
function windowFor(startMs, days) {
  const key = `${startMs}|${days}`;
  if (winCache.key !== key) winCache = { key, win: sampleWindow(startMs, startMs + days * 864e5, stepFor(days)) };
  return winCache.win;
}

/** Full analysis of a scenario (used by Plan, Compare and Learn). */
export function analyzeScenario(sc) {
  const hz = horizonFor(sc.site, HEIGHTS[sc.heightIdx]);
  const win = sc.win ?? sampleWindow(sc.startMs, sc.startMs + sc.durDays * 864e5, stepFor(sc.durDays));
  const S = analyzeSeries(win, siteFrame(sc.site.lat, sc.site.lon, hz.siteM), hz.mask, { commMaskDeg: sc.commDeg });
  const M = summarize(S, sc.tNow ?? sc.startMs, sc.power ?? state.power);
  M.score = scoreScenario(M);
  return { hz, win, S, M };
}

// ------------------------------------------------------------------ pipeline
function recompute() {
  if (!state.site) return;
  const win = windowFor(state.startMs, state.durDays);
  state.tNow = Math.min(Math.max(state.tNow, win.t[0]), win.t[win.n - 1]);
  const hz = horizonFor(state.site, HEIGHTS[state.heightIdx]);
  const frame = siteFrame(state.site.lat, state.site.lon, hz.siteM);
  const S = analyzeSeries(win, frame, hz.mask, { commMaskDeg: state.commDeg });
  if (win.dsnKey !== winCache.key) { win.dsn = dsnVisibility(win); win.dsnKey = winCache.key; }   // Earth end of the link
  S.dsn = win.dsn;
  S.dsnLos = dsnLineOfSight(win, frame, hz.mask, win.dsn, state.commDeg);   // line of sight to each antenna, not Earth's centre
  current = { hz, win, S };
  refreshNow();
  announce();
}

// one short sentence for screen readers after each scenario change (not on every animation frame)
let announceTimer = 0;
function announce() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const M = current?.M;
    if (!M) return;
    $('sr-status').textContent = `${state.site.name}, ${U.fmtDur(state.durDays * 24)} from ${U.fmtDate(state.startMs)}: sunlight ${M.sunPct.toFixed(0)} percent, `
      + `Earth in view ${M.earthPct.toFixed(0)} percent, longest darkness ${U.fmtDur(M.longestNightH)}, battery ${M.battery.survives ? 'survives' : 'runs empty'}.`;
  }, 700);
}

function refreshNow() {
  const { hz, win, S } = current;
  const M = summarize(S, state.tNow, state.power);
  M.score = scoreScenario(M);
  current.M = M;
  const i = M.now.i;
  const sunVec = [win.sun[3 * i], win.sun[3 * i + 1], win.sun[3 * i + 2]];
  const earthVec = [win.earth[3 * i], win.earth[3 * i + 1], win.earth[3 * i + 2]];
  const sunR = angularRadius(SUN_R_KM, S.sunDist[i]), earthR = angularRadius(EARTH_R_KM, S.earthDist[i]);
  panorama.set({ S, hz, now: M.now, sunR, earthR, earthPhase: earthPhase(sunVec, earthVec) });
  timeline.set(S, M, state.tNow);
  const sl = Math.hypot(...sunVec);
  map.setBodies(sunVec.map(v => v / sl), earthVec, sunR);
  map.setBearings(S.sunAz[i], S.earthAz[i]);
  map.setObserverHeight(HEIGHTS[state.heightIdx]);
  map.setCommMargin(state.commDeg);
  map.setWindowSamples(win, `${state.startMs}|${state.durDays}`);
  map.render();
  if (v3d && state.viewMode !== 'pano') {
    v3d.setSite(state.site, hz, HEIGHTS[state.heightIdx]);
    // the DSN antennas as seen from the site: on Earth's disk, in contact / blocked by lunar terrain / facing away
    const dsnSky = S.dsnLos ? DSN.map((st, k) => ({ name: st.name, az: S.dsnLos.skyAz[k][i], el: S.dsnLos.skyEl[k][i], moonEl: S.dsn.el[k][i], link: S.dsnLos.per[k][i] })) : null;
    v3d.setBodies({ sunAz: S.sunAz[i], sunEl: S.sunEl[i], earthAz: S.earthAz[i], earthEl: S.earthEl[i], sunR, earthR, sunMF: sunVec.map(v => v / sl), dsn: dsnSky });
    v3d.render();
  }
  renderNow(M, S, hz);
  checkDispersionStale();
  refreshBestDates();
  updateLinks();
}

// ------------------------------------------------------------------ best landing dates (next 12 months at this site)
let bestKey = '', bestTimer = 0, bestData = null;
const DAY_MS = 864e5, dayOf = ms => Math.floor(ms / DAY_MS);
const bestKeyNow = () => [state.site.lat.toFixed(5), state.site.lon.toFixed(5), state.heightIdx, state.durDays,
  state.commDeg, state.power.areaM2, state.power.effPct, state.power.loadW, state.power.capKWh].join('|');

function refreshBestDates() {
  if (!$('best-box').open || !state.site) return;
  const key = bestKeyNow(), day = dayOf(state.startMs);
  const inside = bestData && day >= bestData.day0 && day < bestData.day0 + bestData.cells.length;
  if (key === bestKey && inside) { if (day !== bestData.shownDay) renderBestDates(); return; }   // date moved inside the ranked year
  bestKey = key; bestData = null;
  clearTimeout(bestTimer);
  $('best-out').textContent = 'Ranking every landing day of the next 12 months…';
  bestTimer = setTimeout(() => {                                           // let the UI settle while sliders move
    if (state.durDays <= 90) {
      const hz = horizonFor(state.site, HEIGHTS[state.heightIdx]);
      const d0 = new Date(state.startMs), t0 = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
      const win = sampleWindow(t0, t0 + (365 + state.durDays) * 864e5, 60);   // shared by the ranking and the DSN link
      const link = dsnLineOfSight(win, siteFrame(state.site.lat, state.site.lon, hz.siteM), hz.mask, dsnVisibility(win), state.commDeg).any;
      const cells = rankLandingDays({ site: state.site, hz, startMs: t0, days: 365, durDays: state.durDays, power: state.power, commDeg: state.commDeg, win, link });
      bestData = { cells, day0: dayOf(cells[0].startMs) };
    }
    renderBestDates();
  }, 120);
}

function renderBestDates() {
  const out = $('best-out');
  if (!bestData) { out.textContent = 'Pick a mission window of 90 days or less to rank landing dates.'; return; }
  const { cells } = bestData;
  const top = pickBest(cells, 5, Math.max(3, Math.ceil(state.durDays / 2)));
  bestData.shownDay = dayOf(state.startMs);
  const mine = cells[bestData.shownDay - bestData.day0];
  const meta = m => `<span class="sun">Sun ${m.sunPct.toFixed(0)}%</span> · <span class="earth">Earth ${m.earthPct.toFixed(0)}%</span> · `
    + (m.dsnPct != null ? `<span class="earth">DSN ${m.dsnPct.toFixed(0)}%</span> · ` : '')
    + (m.survives ? '<span class="ok">battery ✓</span>' : `<span class="bad">battery empty</span>`);
  out.innerHTML = top.map((c, k) => `<button class="pick" data-t="${c.startMs}" title="Plan a landing on this day">
      <span class="n">${k + 1}</span><span class="d">${U.fmtDate(c.startMs, false)}</span><span class="s">score ${c.m.score}</span>
      <span class="m">${meta(c.m)}</span></button>`).join('')
    + `<div class="mine">Your date (${U.fmtDate(mine.startMs, false)}): score <b>${mine.m.score}</b>, rank ${rankOf(cells, mine)} of ${cells.length}
       from ${U.fmtDate(cells[0].startMs, false)}. ${state.durDays}-day missions, array ${HEIGHTS[state.heightIdx]} m, ranked by the mission score (js/core/score.js).</div>`;
  out.querySelectorAll('.pick').forEach(b => b.onclick = () => {
    const t = +b.dataset.t, hhmm = state.startMs - Math.floor(state.startMs / 864e5) * 864e5;   // keep the planned time of day
    state.startMs = t + hhmm; state.tNow = state.startMs;
    syncControls(); recompute();
    U.toast(`Landing moved to ${U.fmtDate(state.startMs)}`);
  });
}

// ------------------------------------------------------------------ off-target touchdown (landing ellipse)
let dispRun = 0;
const dispKey = () => [state.site.lat.toFixed(5), state.site.lon.toFixed(5), $('disp-r').value, state.heightIdx, state.startMs, state.durDays,
  state.commDeg, state.power.areaM2, state.power.effPct, state.power.loadW, state.power.capKWh].join('|');

async function runDispersion() {
  if (!state.site || !current) return;
  const out = $('disp-out'), btn = $('btn-disp'), rKm = +$('disp-r').value;
  if (!current.hz.terrain) {
    out.textContent = 'This needs the 75°S–90°S LOLA terrain model: outside it the horizon is a smooth sphere, so every touchdown point looks the same.';
    return;
  }
  const run = ++dispRun, key = dispKey();
  btn.disabled = true;
  const res = await analyzeDispersion({
    dem, site: state.site, rKm, heightM: HEIGHTS[state.heightIdx], win: current.win, commDeg: state.commDeg, power: state.power, tNow: state.tNow,
    onProgress: (k, n) => { if (run === dispRun) out.textContent = `Re-running the mission window at touchdown point ${k}/${n}…`; },
  });
  btn.disabled = false;
  if (run !== dispRun || key !== dispKey()) return;                   // scenario changed meanwhile
  state.disp = { key, res };
  // zoom the map so the ellipse is readable (never zoom out a closer user view)
  const p = Dem.toXY(state.site.lat, state.site.lon), side = Math.min(map.w || 500, map.h || 500);
  Object.assign(map, { cx: p.x, cy: p.y, mpp: Math.max(10, Math.min(map.mpp, (2.6 * rKm * 1000) / side)), userView: true });
  map.setDispersion(res);
  map.render(); map.onViewChange?.();
  renderDispersion();
}

function renderDispersion() {
  const d = state.disp, r = d.res, t = r.pts[0].M;
  const radius = r.rKm < 1 ? `±${(r.rKm * 1000).toFixed(0)} m` : `±${r.rKm} km`;
  const where = p => (p.target ? 'on target' : `${(p.dKm * 1000).toFixed(0)} m at ${p.az.toFixed(0)}°`);
  const bar = ([a, b], v, color) => `<div class="disp-bar" aria-hidden="true"><i style="left:${a}%;width:${Math.max(1, b - a)}%;background:${color}"></i><em style="left:calc(${v}% - 1px)"></em></div>`;
  $('disp-out').innerHTML = `
    <div class="row"><span>Sunlight within ${radius} (${r.pts.length} points)</span><b>${r.sun[0].toFixed(0)}–${r.sun[1].toFixed(0)}% <span class="muted">target ${t.sunPct.toFixed(0)}%</span></b></div>
    ${bar(r.sun, t.sunPct, U.COLORS.sun)}
    <div class="row"><span>Earth in view (DTE)</span><b>${r.earth[0].toFixed(0)}–${r.earth[1].toFixed(0)}% <span class="muted">target ${t.earthPct.toFixed(0)}%</span></b></div>
    ${bar(r.earth, t.earthPct, U.COLORS.earth)}
    <div class="row"><span>Longest darkness</span><b>${U.fmtDur(r.night[0])} – ${U.fmtDur(r.night[1])}</b></div>
    <div class="row"><span>Battery survives the window</span><b class="${r.survive === r.pts.length ? 'ok' : r.survive ? '' : 'bad'}">at ${r.survive} of ${r.pts.length} points</b></div>
    <div class="row"><span>Worst touchdown</span><b>${where(r.worst)} · ${r.worst.M.sunPct.toFixed(0)}% sun · score ${r.worst.score}</b></div>
    <div class="row"><span>Best touchdown</span><b>${where(r.best)} · ${r.best.M.sunPct.toFixed(0)}% sun · score ${r.best.score}</b></div>
    ${r.best.target ? '<div>The target is already the best point of this ellipse.</div>' : '<button class="btn tiny" id="btn-disp-best">Move the target to the best point →</button>'}`;
  $('btn-disp-best')?.addEventListener('click', () => {
    const name = state.site.name.replace(/ · shifted$/, '');
    selectSite({ ...customOf(r.best.lat, r.best.lon), name: `${name} · shifted` });
    runDispersion();
  });
}

function checkDispersionStale() {
  if (!state.disp || state.disp.key === dispKey()) return;
  state.disp = null; dispRun++;
  map.setDispersion(null);
  $('disp-out').textContent = 'Scenario changed — press “Check” to re-run the landing-ellipse analysis.';
}

// ------------------------------------------------------------------ metrics panel
function renderNow(M, S, hz) {
  const n = M.now, end = S.t[S.n - 1];
  $('now-time').textContent = U.fmtDate(n.t);
  const eta = (next, upWord, downWord, isUp) => next == null
    ? `<span class="muted">No ${isUp ? downWord : upWord} before window end (${U.fmtDur((end - n.t) / 36e5)} left)</span>`
    : `${isUp ? downWord : upWord} in <b>${U.fmtDur((next - n.t) / 36e5)}</b>`;
  const sunState = n.sunFrac >= 0.995 ? ['ok', 'Fully lit'] : n.sunFrac > 0.005 ? ['ok', `${(n.sunFrac * 100).toFixed(0)}% of disk`] : ['no', n.sunEl < 0 ? 'Below horizon' : 'Behind terrain'];
  $('now-sun').innerHTML = `<div class="lbl"><span>Sun</span><span class="pill ${sunState[0]}">${sunState[1]}</span></div>
    <div class="big">${U.fmtDeg(n.sunEl)}</div>
    <div class="sub">az ${n.sunAz.toFixed(1)}° · terrain under it ${U.fmtDeg(n.sunHz)}</div>
    <div class="sub">Array output <b>${n.power.toFixed(0)} W/m²</b> <span title="vertical, Sun-tracking array; a flat panel would get ${(n.sunEl > 0 ? n.power * Math.tan(n.sunEl * Math.PI / 180) : 0).toFixed(0)} W/m²">ⓘ</span></div>
    <div class="eta">${eta(n.nextSun, 'Sunrise', 'Sunset', n.sunUp)}</div>`;
  const earthState = n.earthUp ? ['ok', 'DTE link possible'] : ['no', n.earthEl < 0 ? 'Below horizon' : 'Behind terrain'];
  $('now-earth').innerHTML = `<div class="lbl"><span>Earth</span><span class="pill ${earthState[0]}">${earthState[1]}</span></div>
    <div class="big">${U.fmtDeg(n.earthEl)}</div>
    <div class="sub">az ${n.earthAz.toFixed(1)}° · terrain under it ${U.fmtDeg(n.earthHz)}</div>
    <div class="sub">Clearance <b>${U.fmtDeg(n.earthEl - n.earthHz)}</b> above terrain</div>
    <div class="sub">${dsnNow(S, n.i)}</div>
    <div class="eta">${eta(n.nextEarth, 'Earthrise', 'Earthset', n.earthUp)}</div>`;
  const k = (v, label, title = '') => `<div class="kpi" title="${title}"><div class="v">${v}</div><div class="k">${label}</div></div>`;
  $('kpis').innerHTML =
    k(`${M.sunPct.toFixed(1)}%`, 'Sunlight', 'Average fraction of the solar disk above the local terrain horizon') +
    k(`${M.earthPct.toFixed(1)}%`, 'Earth in view (DTE)', 'Time with Earth\'s center above terrain + margin') +
    k(`${M.bothPct.toFixed(1)}%`, 'Sun + Earth', 'Time with power AND direct-to-Earth link') +
    k(U.fmtDur(M.longestNightH), 'Longest darkness', 'Longest continuous period with the Sun\'s center hidden — sizes the battery') +
    k(U.fmtDur(M.longestCommGapH), 'Longest comm gap', 'Longest continuous loss of direct line of sight to Earth') +
    k(`${M.meanPowerWm2.toFixed(0)} W/m²`, 'Mean array output', 'Vertical Sun-tracking array, 1361 W/m² at 1 AU, scaled by visible disk');
  $('score').innerHTML = `<span>Mission score</span><div class="gauge"><i style="width:${Math.max(0, Math.min(100, M.score))}%"></i></div><b>${M.score}</b>`;
  const lt = state.site.longTerm;
  const B = M.battery, P = state.power;
  const need = (M.longestNightH * P.loadW / 1000);
  $('extra').innerHTML = `
    <div><span>Power system (${P.areaM2} m² × ${P.effPct}% ≈ ${(B.peakW / 1000).toFixed(1)} kW peak, ${P.loadW} W load, ${P.capKWh} kWh)</span>
      <b class="${B.survives ? 'ok' : 'bad'}">${B.survives ? `✓ survives · lowest charge ${B.minSocPct.toFixed(0)}%` : `✗ battery empty ${U.fmtDate(B.firstEmpty)} · ${U.fmtDur(B.emptyH)} unpowered`}</b></div>
    <div><span>Battery needed for the longest darkness at this load</span><b>${need.toFixed(1)} kWh</b></div>
    <div><span>Flat (horizontal) panel would deliver</span><b>${M.flatPowerWm2.toFixed(0)} W/m²</b></div>
    ${dsnSummary(S)}
    ${lt ? `<div><span>Long-term baseline at this site (${lt.period}, 2 m)</span><b>Sun ${lt.sunPct}% · Earth ${lt.earthPct}%</b></div>` : ''}`;
  $('pano-site').textContent = `— ${state.site.name} · ${U.fmtLat(state.site.lat)}, ${U.fmtLon(state.site.lon)}${hz.terrain ? ` · ground ${hz.groundM.toFixed(0)} m, array +${HEIGHTS[state.heightIdx]} m` : ''}`;
}

// DSN: which ground stations see the Moon AND are in line of sight of the site (antenna positions on Earth's disk)
function dsnNow(S, i) {
  if (!S.dsn) return '';
  const up = DSN.map((st, k) => ({ st, el: S.dsn.el[k][i], los: S.dsnLos?.per[k][i] })).filter(x => x.el >= DSN_MIN_EL).sort((a, b) => b.el - a.el);
  if (!up.length) return '<span style="color:#ff6b6b">No DSN station sees the Moon now</span>';
  return `DSN: ${up.map(x => (x.los ? `<b>${x.st.name} ${x.el.toFixed(0)}° ✓</b>` : `${x.st.name} ${x.el.toFixed(0)}° <span style="color:#ff6b6b">behind terrain</span>`)).join(' · ')}`;
}
/**
 * % of the window with a full DTE link: some DSN antenna above 10° AND in line of sight of the site. The line of sight
 * goes to the antenna itself (up to 0.95° off Earth's centre); `centre` is the same figure for Earth's centre, for comparison.
 */
function dsnStats(S) {
  if (!S.dsn || !S.dsnLos) return null;
  let link = 0, centre = 0; const per = DSN.map(() => 0), moon = DSN.map(() => 0);
  for (let i = 0; i < S.n; i++) {
    link += S.dsnLos.any[i]; if (S.earthVis[i] && S.dsn.any[i]) centre++;
    DSN.forEach((_, k) => { per[k] += S.dsnLos.per[k][i]; if (S.dsn.el[k][i] >= DSN_MIN_EL) moon[k]++; });
  }
  const pct = v => 100 * v / S.n;
  return { link: pct(link), centre: pct(centre), per: DSN.map((st, k) => ({ name: st.name, pct: pct(per[k]), moonPct: pct(moon[k]) })) };
}
function dsnSummary(S) {
  const d = dsnStats(S);
  if (!d) return '';
  return `<div title="Line of sight to each antenna on Earth's surface, not to Earth's centre (Earth-centre model: ${d.centre.toFixed(1)}%)"><span>Full DTE link (a DSN antenna above ${DSN_MIN_EL}° and in line of sight)</span><b>${d.link.toFixed(1)}% · ${d.per.map(x => `${x.name.slice(0, 3)} ${x.pct.toFixed(0)}%`).join(' ')}</b></div>`;
}

// ------------------------------------------------------------------ site list
function renderSites() {
  const q = $('site-search').value.trim().toLowerCase();
  const list = $('site-list');
  const groups = {};
  for (const s of sites) {
    if (q && !`${s.name} ${s.kind} ${s.group}`.toLowerCase().includes(q)) continue;
    (groups[s.group] ??= []).push(s);
  }
  list.innerHTML = '';
  for (const [g, arr] of Object.entries(groups)) {
    const h = document.createElement('div'); h.className = 'site-group'; h.textContent = g; list.append(h);
    for (const s of arr) {
      const b = document.createElement('button');
      b.className = 'site'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', state.site?.id === s.id ? 'true' : 'false');
      const lt = s.longTerm;
      b.title = `${s.kind}\n${s.note}\nSource: ${s.source}${lt ? `\n20-yr average at 2 m: Sun ${lt.sunPct}% · Earth ${lt.earthPct}%` : ''}`;
      b.innerHTML = `<span class="nm">${s.name}</span><span class="ll">${U.fmtLat(s.lat)} ${U.fmtLon(s.lon)}</span>
        <span class="bars">${lt ? `<span class="minibar s"><i style="width:${lt.sunPct}%"></i></span><span class="minibar e"><i style="width:${lt.earthPct}%"></i></span>` : ''}</span>`;
      b.onclick = () => selectSite(s, true);
      list.append(b);
    }
  }
}

function selectSite(site, useMissionDate = false) {
  state.site = site;
  if (useMissionDate && site.date && site.group !== 'South pole') {
    state.startMs = Date.parse(site.date);
    state.tNow = state.startMs;
    $('in-start').value = U.toInputUTC(state.startMs);
  }
  map.setSelected(site);
  map.focus(site.lat, site.lon);
  $('in-lat').value = site.lat; $('in-lon').value = site.lon;
  renderSites();
  recompute();
}

function customSite(lat, lon) {
  lat = +lat; lon = +lon;
  if (!validLatLon(lat, lon)) { U.toast('Enter a latitude between −90 and +90 and a longitude in degrees east'); return; }
  selectSite(customOf(lat, lon));
}

// ------------------------------------------------------------------ URL & links
// Debounced: refreshNow() runs every animation frame while playing or scrubbing, and browsers
// rate-limit the History API (Firefox and Safari throw after ~100–200 calls in 10 s).
let linkTimer = 0;
function updateLinks(immediate = false) {
  clearTimeout(linkTimer);
  if (immediate) writeLinks();
  else linkTimer = setTimeout(writeLinks, 300);
}
function writeLinks() {
  if (!current || !state.site) return;
  const s = state.site, hz = current.hz;
  const p = new URLSearchParams();
  if (s.id === 'custom') { p.set('lat', s.lat.toFixed(4)); p.set('lon', s.lon.toFixed(4)); } else p.set('site', s.id);
  p.set('start', U.toInputUTC(state.startMs)); p.set('days', state.durDays); p.set('h', HEIGHTS[state.heightIdx]);
  if (state.commDeg) p.set('comm', state.commDeg);
  const P = state.power, D = DEFAULT_POWER;
  if (P.areaM2 !== D.areaM2 || P.effPct !== D.effPct || P.loadW !== D.loadW || P.capKWh !== D.capKWh) p.set('pw', `${P.areaM2},${P.effPct},${P.loadW},${P.capKWh}`);
  p.set('t', U.toInputUTC(state.tNow));
  if (map.layer !== 1) p.set('layer', map.layer);
  if (state.viewMode && state.viewMode !== 'pano') p.set('vm', state.viewMode);
  if (map.userView) p.set('mv', `${(map.cx / 1000).toFixed(2)},${(map.cy / 1000).toFixed(2)},${map.mpp.toFixed(1)}`);
  if (state.disp && state.disp.key === dispKey()) p.set('ellipse', state.disp.res.rKm);   // reopens with the ellipse analysed
  if ($('best-box').open) p.set('best', 1);
  if (state.view && state.view !== 'plan') p.set('view', state.view);           // a link from Learn/Compare/Validation reopens that tab
  // the comparison travels with the link too: site~start~days~height;…
  if (compare?.items.length) p.set('cmp', compare.items.map(it => [it.site.id === 'custom' ? `${it.site.lat.toFixed(4)},${it.site.lon.toFixed(4)}` : it.site.id,
    U.toInputUTC(it.startMs), it.durDays, HEIGHTS[it.heightIdx]].join('~')).join(';'));
  try { history.replaceState(null, '', `#${p}`); } catch { /* rate-limited: the next call catches up */ }
  const altKm = ((hz.terrain ? hz.groundM : 0) + HEIGHTS[state.heightIdx]) / 1000;
  const fmt = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const hp = new URLSearchParams({
    format: 'text', COMMAND: "'10'", OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${s.lon.toFixed(4)},${s.lat.toFixed(4)},${altKm.toFixed(4)}'`,
    START_TIME: `'${fmt(state.startMs)}'`, STOP_TIME: `'${fmt(state.startMs + Math.min(state.durDays, 30) * 864e5)}'`,
    STEP_SIZE: "'1h'", QUANTITIES: "'4,20'", ANG_FORMAT: "'DEG'",
  });
  $('btn-horizons').href = `https://ssd.jpl.nasa.gov/api/horizons.api?${hp}`;
}

const validDays = d => isFinite(d) && d > 0 && d <= 400;
const validLatLon = (lat, lon) => isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90;
const customOf = (lat, lon) => ({ id: 'custom', name: 'Custom site', group: 'Custom', kind: 'User-defined coordinates', lat, lon: ((lon % 360) + 360) % 360, note: '', source: 'user' });

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.hadHash = location.hash.length > 1;
  // a hand-edited or truncated link must never break the app: ignore any value that does not parse
  const start = U.fromInputUTC(p.get('start'));
  if (isFinite(start)) state.startMs = start;
  if (validDays(+p.get('days'))) state.durDays = +p.get('days');
  if (HEIGHTS.includes(+p.get('h'))) state.heightIdx = HEIGHTS.indexOf(+p.get('h'));
  if (isFinite(+p.get('comm'))) state.commDeg = Math.max(0, Math.min(5, +p.get('comm')));
  const t = U.fromInputUTC(p.get('t'));
  state.tNow = isFinite(t) ? t : state.startMs;
  if (['plan', 'compare', 'learn', 'validate'].includes(p.get('view'))) state.initialView = p.get('view');
  if (p.has('layer')) state.layer = +p.get('layer');
  if (['orbit', 'eye'].includes(p.get('vm'))) state.initialViewMode = p.get('vm');
  if (['0.25', '0.5', '1', '2.5', '5'].includes(p.get('ellipse'))) state.initialEllipse = p.get('ellipse');
  state.initialBest = p.get('best') === '1';
  if (['sun', 'earth'].includes(p.get('look'))) state.initialLook = p.get('look');
  if (p.has('pw')) { const [a, e, l, c] = p.get('pw').split(',').map(Number); if ([a, e, l, c].every(v => isFinite(v) && v >= 0)) state.power = { areaM2: a, effPct: e, loadW: l, capKWh: c }; }
  if (p.has('mv')) { const [x, y, m] = p.get('mv').split(',').map(Number); if ([x, y, m].every(isFinite) && m >= 10 && m <= 1600) state.mapView = { x: x * 1000, y: y * 1000, mpp: m }; }
  state.initialCompare = (p.get('cmp') || '').split(';').filter(Boolean).map(tok => {
    const [id = '', start, days, h] = tok.split('~');
    const [la, lo] = id.split(',').map(Number);
    const site = id.includes(',') ? (validLatLon(la, lo) ? customOf(la, lo) : null) : sites.find(s => s.id === id);
    const startMs = U.fromInputUTC(start);
    return site && isFinite(startMs) && validDays(+days) && { site, startMs, durDays: +days, heightIdx: HEIGHTS.includes(+h) ? HEIGHTS.indexOf(+h) : 1, commDeg: 0 };
  }).filter(Boolean);
  if (p.has('site')) return sites.find(s => s.id === p.get('site')) ?? null;
  const lat = +p.get('lat'), lon = +p.get('lon');
  if (p.has('lat') && p.has('lon') && validLatLon(lat, lon)) return customOf(lat, lon);
  return null;
}

// ------------------------------------------------------------------ controls
function syncControls() {
  $('in-start').value = U.toInputUTC(state.startMs);
  const dur = $('in-duration');
  if (![...dur.options].some(o => +o.value === state.durDays)) dur.add(new Option(`${state.durDays} days`, state.durDays));
  dur.value = String(state.durDays);
  $('in-height').value = state.heightIdx; $('out-height').textContent = `${HEIGHTS[state.heightIdx]} m`;
  $('in-comm').value = state.commDeg; $('out-comm').textContent = `${state.commDeg}°`;
  const P = state.power;
  $('pw-area').value = P.areaM2; $('pw-eff').value = P.effPct; $('pw-load').value = P.loadW; $('pw-cap').value = P.capKWh;
  $('power-summary').textContent = `· ${P.areaM2} m², ${P.loadW} W, ${P.capKWh} kWh`;
}

const POWER_PRESETS = {
  rover: { areaM2: 1.5, effPct: 30, loadW: 120, capKWh: 1.5 },     // VIPER-class rover
  lander: { areaM2: 4, effPct: 30, loadW: 150, capKWh: 5 },       // CLPS-class lander
  base: { areaM2: 40, effPct: 30, loadW: 3000, capKWh: 120 },     // small crewed outpost
};

/** Open a scenario in Plan; opts can also pick the horizon view mode, map layer, map view and power preset. */
export function openScenario(sc, opts = {}) {
  state.startMs = sc.startMs; state.durDays = sc.durDays; state.heightIdx = sc.heightIdx ?? 1; state.commDeg = sc.commDeg ?? 0;
  state.tNow = sc.tNow ?? sc.startMs;
  if (sc.power) state.power = { ...sc.power };
  if (opts.preset) state.power = { ...POWER_PRESETS[opts.preset] };
  syncControls();
  switchView('plan');
  if (opts.resetView) map.reset(false);
  if (opts.layer != null) { map.layer = opts.layer; $('map-layer').value = String(opts.layer); }
  if (opts.mv) Object.assign(map, { cx: opts.mv[0] * 1000, cy: opts.mv[1] * 1000, mpp: opts.mv[2], userView: true });
  selectSite(sc.site);
  if (opts.mv) Object.assign(map, { cx: opts.mv[0] * 1000, cy: opts.mv[1] * 1000, mpp: opts.mv[2], userView: true });
  setViewMode(opts.viewMode ?? 'pano');
  map.render();
  window.scrollTo({ top: 0 });
  if (opts.ellipseKm) {                                                 // lesson "Land on target": run the landing-ellipse check
    $('disp-r').value = String(opts.ellipseKm);
    runDispersion().then(() => $('disp').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
}

/** Landing-ellipse statistics for a lesson (2 m array, no DTE margin). */
const ellipseStats = ({ site, startMs, durDays, rKm, power }) => analyzeDispersion({
  dem, site, rKm, heightM: HEIGHTS[1], commDeg: 0, power, tNow: startMs,
  win: sampleWindow(startMs, startMs + durDays * 864e5, stepFor(durDays)),
});

function switchView(v) {
  state.view = v;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v ? 'true' : 'false'));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${v}`));
  if (v === 'plan' && current) { panorama.draw(); timeline.draw(); map.render(); }
  if (v === 'compare') compare.show();
  if (v === 'learn') renderLearn($('lessons'), { sites, analyzeScenario, openScenario, switchView, state, HEIGHTS, ellipseStats });
  if (v === 'validate') renderValidation();
  if (current) updateLinks();
}

function setViewMode(v) {
  state.viewMode = v;
  document.querySelectorAll('#view-mode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'));
  const pano = v === 'pano';
  $('panorama').hidden = pano ? false : true; $('pano-foot').hidden = !pano; $('pano-legend').hidden = !pano;
  $('v3d-wrap').hidden = pano; $('v3d-legend').hidden = pano;
  document.querySelectorAll('.orbit-only').forEach(el => { el.hidden = v !== 'orbit'; });
  document.querySelectorAll('.eye-only').forEach(el => { el.hidden = v !== 'eye'; });
  if (!pano && !v3d) v3d = new Surface3D($('v3d'), $('v3d-ov'), dem);
  if (pano) { panorama.draw(); if (current) updateLinks(); return; }
  refreshNow();
  v3d.setMode(v);
}

function wire() {
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('site-search').oninput = renderSites;
  $('btn-go-custom').onclick = () => customSite($('in-lat').value, $('in-lon').value);
  $('in-start').onchange = e => { const t = U.fromInputUTC(e.target.value); if (isFinite(t)) { const dt = state.tNow - state.startMs; state.startMs = t; state.tNow = t + Math.max(0, dt); recompute(); } };
  $('in-duration').onchange = e => { state.durDays = +e.target.value; recompute(); };
  $('in-height').oninput = e => { state.heightIdx = +e.target.value; $('out-height').textContent = `${HEIGHTS[state.heightIdx]} m`; recompute(); };
  $('in-comm').oninput = e => { state.commDeg = +e.target.value; $('out-comm').textContent = `${state.commDeg}°`; recompute(); };
  const slip = days => { state.startMs += days * 864e5; state.tNow += days * 864e5; syncControls(); recompute(); U.toast(`Landing moved to ${U.fmtDate(state.startMs)}`); };
  $('btn-slip-minus').onclick = () => slip(-1);
  $('btn-slip-plus').onclick = () => slip(1);
  $('btn-add-compare').onclick = () => {
    compare.add({ site: state.site, startMs: state.startMs, durDays: state.durDays, heightIdx: state.heightIdx, commDeg: state.commDeg, power: { ...state.power } });
    updateLinks();
    U.toast(`Added “${state.site.name}, ${U.fmtDate(state.startMs, false)}” to Compare (${compare.items.length})`);
  };
  $('btn-tour').onclick = () => startTour(true);
  $('btn-horizons').addEventListener('click', () => updateLinks(true));   // never open a stale query
  $('btn-csv').onclick = exportSeriesCSV;
  $('btn-hz-csv').onclick = exportHorizonCSV;
  $('btn-brief').onclick = exportBrief;
  // keyboard: ←/→ step through time (Shift = 1 day) on the timeline; rotate the panorama
  $('timeline').addEventListener('keydown', e => {
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const S = current.S, step = e.shiftKey ? 864e5 : S.stepMin * 60000 * Math.max(1, Math.round(60 / S.stepMin));
    state.tNow = e.key === 'Home' ? S.t[0] : e.key === 'End' ? S.t[S.n - 1] : Math.min(S.t[S.n - 1], Math.max(S.t[0], state.tNow + (e.key === 'ArrowRight' ? step : -step)));
    refreshNow();
  });
  $('panorama').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    panorama.centerAz = ((panorama.currentCenter() + (e.key === 'ArrowRight' ? 15 : -15)) + 360) % 360; panorama.follow = false; panorama.draw();
  });
  $('btn-share').onclick = async () => { updateLinks(true); try { await navigator.clipboard.writeText(location.href); U.toast('Link copied — it reopens this exact scenario'); } catch { U.toast('Copy the address bar to share this scenario'); } };
  $('chk-follow').onchange = e => { panorama.follow = e.target.checked; panorama.draw(); };
  document.querySelectorAll('#view-mode button').forEach(b => b.onclick = () => setViewMode(b.dataset.v));
  $('v3d-ve').onchange = e => v3d?.setExaggeration(+e.target.value);
  document.querySelectorAll('[data-look]').forEach(b => b.onclick = () => v3d?.lookAt(b.dataset.look));
  $('map-layer').onchange = e => { map.setLayer(+e.target.value); updateLinks(); };
  const readPower = () => {
    const v = id => Math.max(0, +$(id).value || 0);
    state.power = { areaM2: v('pw-area'), effPct: Math.min(45, v('pw-eff')), loadW: v('pw-load'), capKWh: Math.max(0.1, v('pw-cap')) };
    syncControls(); refreshNow();
  };
  for (const id of ['pw-area', 'pw-eff', 'pw-load', 'pw-cap']) $(id).onchange = readPower;
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { state.power = { ...POWER_PRESETS[b.dataset.preset] }; syncControls(); refreshNow(); U.toast(`Power system: ${b.textContent}`); });
  $('btn-map-reset').onclick = () => map.reset();
  $('btn-disp').onclick = runDispersion;
  $('disp-r').onchange = () => { if (state.disp) runDispersion(); else checkDispersionStale(); };
  $('best-box').addEventListener('toggle', () => { bestKey = ''; refreshBestDates(); });
  let playing = false, last = 0;
  const play = ts => {
    if (!playing) return;
    const span = current.S.t[current.S.n - 1] - current.S.t[0];
    if (last) state.tNow += span * (ts - last) / 12000;     // whole window in ~12 s
    last = ts;
    if (state.tNow >= current.S.t[current.S.n - 1]) { state.tNow = current.S.t[current.S.n - 1]; playing = false; $('btn-play').textContent = '▶ Play'; }
    refreshNow();
    if (playing) requestAnimationFrame(play);
  };
  $('btn-play').onclick = () => {
    playing = !playing; last = 0;
    $('btn-play').textContent = playing ? '❚❚ Pause' : '▶ Play';
    if (playing) { if (state.tNow >= current.S.t[current.S.n - 1]) state.tNow = current.S.t[0]; requestAnimationFrame(play); }
  };
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (current) { panorama.draw(); timeline.draw(); } compare?.redraw(); }, 120); });
}

// ------------------------------------------------------------------ panorama <-> map linked cursors
// Hover the skyline: the map traces the great circle to the ridge that sets the horizon there.
// Hover the map: the panorama marks where that spot appears in the site's sky.
function linkHorizonAndMap() {
  panorama.onHoverAz = (az, distKm, el) => map.setProbe(az == null ? null : { az, distKm, el });
  map.onHoverPoint = pt => {
    const hz = current?.hz;
    if (!pt || !hz?.terrain || state.viewMode !== 'pano') { panorama.setMarker(null); return ''; }
    const b = U.bearingTo(state.site.lat, state.site.lon, pt.lat, pt.lon);
    if (b.distKm < 0.3 || b.distKm > 600) { panorama.setMarker(null); return ''; }
    const R = dem.R, th = b.distKm * 1000 / R, Rt = R + pt.h, Rs = R + hz.siteM;
    const el = Math.atan2(Rt * Math.cos(th) - Rs, Rt * Math.sin(th)) * 180 / Math.PI;   // same geometry as core/horizon.js
    const d = b.distKm.toFixed(b.distKm < 10 ? 1 : 0);
    panorama.setMarker({ az: b.az, el, text: `map cursor · ${d} km away · ${U.fmtDeg(el)}` });
    return `<br>From ${state.site.name}: <b>${d} km</b> at ${b.az.toFixed(0)}°, seen at <b>${U.fmtDeg(el)}</b>`;
  };
}

// ------------------------------------------------------------------ CSV export (for planners)
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function exportSeriesCSV() {
  const { S, hz, M } = current, s = state.site, soc = M.battery?.soc;
  const head = [`# Penumbra — ${s.name} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}E), array ${HEIGHTS[state.heightIdx]} m, DTE margin ${state.commDeg} deg`,
    `# terrain: ${hz.terrain ? 'NASA LRO LOLA LDEM_75S_240M' : 'smooth sphere (outside 75S model)'}; ephemeris: Astronomy Engine + IAU Moon rotation (validated vs JPL Horizons)`,
    'utc,sun_az_deg,sun_el_deg,terrain_el_under_sun_deg,sun_disk_visible_fraction,array_W_per_m2,earth_az_deg,earth_el_deg,terrain_el_under_earth_deg,earth_in_view,dsn_station_sees_moon,dsn_link_goldstone,dsn_link_madrid,dsn_link_canberra,battery_soc'];
  const rows = [];
  for (let i = 0; i < S.n; i++) rows.push([new Date(S.t[i]).toISOString(), S.sunAz[i].toFixed(3), S.sunEl[i].toFixed(4), S.sunHz[i].toFixed(4), S.sunFrac[i].toFixed(3),
    S.power[i].toFixed(1), S.earthAz[i].toFixed(3), S.earthEl[i].toFixed(4), S.earthHz[i].toFixed(4), S.earthVis[i], S.dsn ? S.dsn.any[i] : '', ...DSN.map((_, k) => (S.dsnLos ? S.dsnLos.per[k][i] : '')), soc ? soc[i].toFixed(3) : ''].join(','));
  download(`penumbra-${slug(s.name)}-${U.toInputUTC(state.startMs).slice(0, 10)}.csv`, head.concat(rows).join('\n'));
  U.toast(`Exported ${S.n} rows`);
}
// Printable one-page mission brief (opens in a new tab; Ctrl/⌘+P → PDF)
function exportBrief() {
  if (!current) return;
  updateLinks(true);
  const shot = (gl, ov) => {                                          // WebGL canvas + its 2D overlay as one PNG
    const c = document.createElement('canvas'); c.width = ov.width; c.height = ov.height;
    const g = c.getContext('2d'); if (gl) g.drawImage(gl, 0, 0, c.width, c.height); g.drawImage(ov, 0, 0);
    return c.toDataURL('image/png');
  };
  let horizon = '';
  if (state.viewMode === 'pano') horizon = $('panorama').toDataURL('image/png');
  else if (v3d?.gl) { v3d.draw(); horizon = shot($('v3d'), $('v3d-ov')); }   // read back in the same task as the draw
  map.draw(false);
  const images = { horizon, map: shot(map.gl ? $('map-gl') : null, $('map')), timeline: $('timeline').toDataURL('image/png') };
  const { S, M, hz } = current;
  const opened = openBrief({
    site: state.site, S, M, hz, images, url: location.href, dsn: dsnStats(S),
    disp: state.disp && state.disp.key === dispKey() ? state.disp.res : null,
    sc: { startMs: state.startMs, durDays: state.durDays, heightM: HEIGHTS[state.heightIdx], commDeg: state.commDeg, power: state.power },
  });
  U.toast(opened ? 'Mission brief opened in a new tab — Ctrl+P saves it as PDF' : 'Pop-up blocked: the brief was downloaded as an HTML file');
}

function exportHorizonCSV() {
  const { hz } = current, s = state.site;
  const rows = [`# Penumbra terrain horizon — ${s.name} (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}E), observer ${HEIGHTS[state.heightIdx]} m above ground (${hz.terrain ? hz.siteM.toFixed(1) + ' m above 1737.4 km' : 'no terrain'})`, 'azimuth_deg,horizon_elevation_deg,distance_to_horizon_km'];
  for (let k = 0; k < hz.nAz; k++) rows.push(`${(k * 360 / hz.nAz).toFixed(2)},${hz.mask[k].toFixed(4)},${hz.dist[k].toFixed(2)}`);
  download(`penumbra-horizon-${slug(s.name)}.csv`, rows.join('\n'));
  U.toast('Horizon mask exported');
}

// ------------------------------------------------------------------ boot
async function boot() {
  const setLoading = t => { $('loading-text').textContent = t; };
  try {
    const [demLoaded, sitesJson] = await Promise.all([
      Dem.load('data/dem', setLoading),
      fetch('data/sites.json').then(r => r.json()),
    ]);
    dem = demLoaded; sites = sitesJson.sites;
  } catch (err) {
    setLoading(typeof DecompressionStream === 'undefined'
      ? 'This browser is too old for Penumbra (needs DecompressionStream: Chrome/Edge 80+, Safari 16.4+, Firefox 113+).'
      : location.protocol === 'file:' ? 'Open Penumbra over HTTP, not as a file: run "python tools/serve.py 8787 ." and visit http://127.0.0.1:8787'
      : `Could not load the NASA LOLA terrain (${err.message}). Check your connection and reload.`);
    throw err;
  }
  panorama = new Panorama($('panorama'), $('pano-foot'));
  timeline = new Timeline($('timeline'), t => { state.tNow = t; refreshNow(); });
  map = new PolarMap($('map-gl'), $('map'), $('map-note'), dem, (lat, lon) => customSite(lat, lon));
  map.setSites(sites);
  linkHorizonAndMap();
  compare = new Compare({ sites, analyzeScenario, openScenario, HEIGHTS, dem, onChange: () => current && updateLinks(), getYear: () => new Date(state.startMs).getUTCFullYear(), getPower: () => state.power });
  wire();
  const fromHash = readHash();
  for (const sc of state.initialCompare) compare.add(sc);
  if (state.layer != null && [0, 1, 2, 3, 4].includes(state.layer)) { map.layer = state.layer; $('map-layer').value = String(state.layer); }
  map.onViewChange = () => { clearTimeout(state._mvT); state._mvT = setTimeout(() => current && updateLinks(), 300); };
  // a pasted share link only changes the hash (replaceState never fires this): reopen that scenario
  window.addEventListener('hashchange', () => location.reload());
  syncControls();
  selectSite(fromHash ?? sites.find(s => s.id === 'c1'));
  if (state.mapView) { Object.assign(map, { cx: state.mapView.x, cy: state.mapView.y, mpp: state.mapView.mpp, userView: true }); map.render(); }
  $('loading').classList.add('hidden');
  if (state.initialViewMode) setViewMode(state.initialViewMode);
  if (state.initialLook && v3d) v3d.lookAt(state.initialLook);           // e.g. vm=eye&look=earth
  if (state.initialBest) $('best-box').open = true;                       // 'toggle' event ranks the dates
  if (state.initialEllipse) { $('disp-r').value = state.initialEllipse; runDispersion(); }
  if (!location.search.includes('notour') && !state.hadHash) setTimeout(() => startTour(false), 600);
  if (state.initialView && state.initialView !== 'plan') switchView(state.initialView);
  // surface unexpected failures instead of failing silently (once per message; ResizeObserver noise is benign)
  const seen = new Set();
  const report = msg => { if (!msg || /ResizeObserver/.test(msg) || seen.has(msg)) return; seen.add(msg); U.toast(`Something went wrong: ${msg}`); };
  window.addEventListener('error', e => report(e.message));
  window.addEventListener('unhandledrejection', e => report(e.reason?.message ?? String(e.reason)));
  // debugging / automated checks handle
  window.penumbra = { state, analyzeScenario, map, setTime: t => { state.tNow = t; refreshNow(); }, get current() { return current; }, get v3d() { return v3d; } };
}
boot();
