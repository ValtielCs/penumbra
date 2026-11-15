// Turn ephemeris samples + a horizon mask into power / communication time series and metrics.
import { AU_KM, SUN_R_KM, EARTH_R_KM, SOLAR_CONSTANT } from './ephemeris.js';
import { horizonAt, diskFractionAbove } from './horizon.js';

const R2D = 180 / Math.PI;

/**
 * Per-sample series for one site.
 * @param win   output of sampleWindow() (Moon-fixed Sun/Earth vectors, km)
 * @param frame output of siteFrame() at the observer height (ground + mast)
 * @param mask  horizon mask (deg) from computeHorizon()
 * @param opts  { commMaskDeg: extra clearance required above terrain for DTE link }
 */
export function analyzeSeries(win, frame, mask, opts = {}) {
  const commMask = opts.commMaskDeg ?? 0;
  const n = win.n;
  const S = {
    n, t: win.t, stepMin: win.stepMin,
    sunAz: new Float32Array(n), sunEl: new Float32Array(n), sunHz: new Float32Array(n), sunFrac: new Float32Array(n),
    earthAz: new Float32Array(n), earthEl: new Float32Array(n), earthHz: new Float32Array(n), earthVis: new Uint8Array(n),
    power: new Float32Array(n), sunDist: new Float32Array(n), earthDist: new Float32Array(n),
  };
  const [px, py, pz] = frame.pos, U = frame.up, Ea = frame.east, N = frame.north;
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < 2; b++) {
      const v = b === 0 ? win.sun : win.earth, j = i * 3;
      const x = v[j] - px, y = v[j + 1] - py, z = v[j + 2] - pz, d = Math.hypot(x, y, z);
      const up = (x * U[0] + y * U[1] + z * U[2]) / d;
      const e = (x * Ea[0] + y * Ea[1] + z * Ea[2]) / d;
      const no = (x * N[0] + y * N[1] + z * N[2]) / d;
      const az = (Math.atan2(e, no) * R2D + 360) % 360, el = Math.asin(up) * R2D, hz = horizonAt(mask, az);
      if (b === 0) {
        const frac = diskFractionAbove(el - hz, Math.asin(SUN_R_KM / d) * R2D);
        const flux = SOLAR_CONSTANT * (AU_KM / d) ** 2;
        S.sunAz[i] = az; S.sunEl[i] = el; S.sunHz[i] = hz; S.sunFrac[i] = frac; S.sunDist[i] = d;
        S.power[i] = flux * frac * Math.cos(el / R2D);    // vertical, Sun-tracking array (W/m²)
      } else {
        S.earthAz[i] = az; S.earthEl[i] = el; S.earthHz[i] = hz; S.earthDist[i] = d;
        S.earthVis[i] = el - hz > commMask ? 1 : 0;     // Earth's center clears terrain (+ margin)
      }
    }
  }
  return S;
}

export const DEFAULT_POWER = { areaM2: 4, effPct: 30, loadW: 150, capKWh: 5 };

/**
 * Energy balance of a solar + battery power system over the window (starts fully charged).
 * Array: S.power (W/m², vertical Sun-tracking) × area × efficiency. Constant load. Battery clamps at 0..capacity.
 */
export function simulateBattery(S, cfg = DEFAULT_POWER) {
  const dtH = S.stepMin / 60, cap = Math.max(1, cfg.capKWh * 1000), k = cfg.areaM2 * cfg.effPct / 100;
  const soc = new Float32Array(S.n);
  let e = cap, minE = cap, firstEmpty = null, emptyH = 0, inWh = 0;
  for (let i = 0; i < S.n; i++) {
    const pin = S.power[i] * k;
    inWh += pin * dtH;
    e = Math.min(cap, Math.max(0, e + (pin - cfg.loadW) * dtH));
    if (e <= 0) { emptyH += dtH; if (firstEmpty == null) firstEmpty = S.t[i]; }
    if (e < minE) minE = e;
    soc[i] = e / cap;
  }
  return { soc, minSocPct: 100 * minE / cap, firstEmpty, emptyH, survives: firstEmpty == null, peakW: 1361 * k, inKWh: inWh / 1000 };
}

/** Contiguous runs where pred(i) is true -> [{i0, i1, start, end, openStart, openEnd}] (inclusive sample indices). */
export function runs(S, pred) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= S.n; i++) {
    const on = i < S.n && pred(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ i0: start, i1: i - 1, start: S.t[start], end: S.t[i - 1], openStart: start === 0, openEnd: i === S.n });
      start = -1;
    }
  }
  return out;
}

// Linear interpolation of the moment a margin series crosses zero between samples i and i+1.
function crossTime(S, marginAt, i) {
  const a = marginAt(i), b = marginAt(i + 1);
  const f = a === b ? 0.5 : a / (a - b);
  return S.t[i] + f * (S.t[i + 1] - S.t[i]);
}

/** Next transition of a boolean state after index i0 (returns ms timestamp or null if beyond the window). */
function nextChange(S, i0, isOn, marginAt) {
  const s0 = isOn(i0);
  for (let i = i0; i < S.n - 1; i++) if (isOn(i + 1) !== s0) return crossTime(S, marginAt, i);
  return null;
}

/** Index of the sample closest to time tMs. */
export function indexAt(S, tMs) {
  const i = Math.round((tMs - S.t[0]) / (S.stepMin * 60000));
  return Math.max(0, Math.min(S.n - 1, i));
}

/** Summary metrics for a scenario window. `tNow` = the moment the user is inspecting. */
export function summarize(S, tNow, power = DEFAULT_POWER) {
  const hours = S.stepMin / 60;
  const sunUp = i => S.sunFrac[i] >= 0.5;                 // solar disk center above local terrain
  const sunMargin = i => S.sunEl[i] - S.sunHz[i];
  const earthUp = i => S.earthVis[i] === 1;
  const earthMargin = i => S.earthEl[i] - S.earthHz[i];
  let sumFrac = 0, sumEarth = 0, sumBoth = 0, sumPow = 0, sumFlat = 0, maxEl = -90, minEl = 90;
  for (let i = 0; i < S.n; i++) {
    sumFrac += S.sunFrac[i]; sumEarth += S.earthVis[i]; sumPow += S.power[i];
    // same sunlight on a horizontal panel: cos(incidence) = sin(elevation)
    if (S.sunEl[i] > 0) sumFlat += SOLAR_CONSTANT * (AU_KM / S.sunDist[i]) ** 2 * S.sunFrac[i] * Math.sin(S.sunEl[i] / R2D);
    if (sunUp(i) && earthUp(i)) sumBoth++;
    if (S.sunEl[i] > maxEl) maxEl = S.sunEl[i];
    if (S.sunEl[i] < minEl) minEl = S.sunEl[i];
  }
  const nights = runs(S, i => !sunUp(i)), gaps = runs(S, i => !earthUp(i));
  const longest = rs => rs.reduce((m, r) => Math.max(m, (r.i1 - r.i0 + 1) * hours), 0);
  const i = indexAt(S, tNow);
  const battery = simulateBattery(S, power);
  return {
    battery, minSocPct: battery.minSocPct, survives: battery.survives,
    sunPct: 100 * sumFrac / S.n,
    earthPct: 100 * sumEarth / S.n,
    bothPct: 100 * sumBoth / S.n,
    meanPowerWm2: sumPow / S.n,
    flatPowerWm2: sumFlat / S.n,
    energyKWhm2: sumPow * hours / 1000,
    longestNightH: longest(nights),
    longestCommGapH: longest(gaps),
    nights, gaps,
    sunElMax: maxEl, sunElMin: minEl,
    now: {
      i, t: S.t[i],
      sunAz: S.sunAz[i], sunEl: S.sunEl[i], sunHz: S.sunHz[i], sunFrac: S.sunFrac[i], power: S.power[i],
      earthAz: S.earthAz[i], earthEl: S.earthEl[i], earthHz: S.earthHz[i], earthVis: S.earthVis[i],
      sunUp: sunUp(i), earthUp: earthUp(i),
      nextSun: nextChange(S, i, sunUp, sunMargin),      // sunset if sunUp, else sunrise
      nextEarth: nextChange(S, i, earthUp, earthMargin), // Earthset if visible, else Earthrise
    },
  };
}
