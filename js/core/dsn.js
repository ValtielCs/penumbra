// The Earth end of a direct-to-Earth link: can a NASA Deep Space Network complex see the Moon?
//
// Fast and exact enough: the Moon's geocentric position (true equator of date, Astronomy Engine) is evaluated every
// 3 h and interpolated (it moves ~1.6° in that time, along a smooth arc); each station's topocentric elevation then
// follows exactly from the Earth's rotation (sidereal angle) and the station's position on the WGS84 ellipsoid,
// so the Moon's ~1° topocentric parallax is included. Agrees with Astronomy Engine's full Equator() + Horizon()
// to a few hundredths of a degree (tools/test-core.mjs) at a fraction of the cost (a year: ~0.3 s → a few ms).

import { moonRotation } from './ephemeris.js';
import { horizonAt } from './horizon.js';

export const DSN = [
  { id: 'gds', name: 'Goldstone', lat: 35.4259, lon: -116.8895, h: 1000 },   // DSS-14, California
  { id: 'mad', name: 'Madrid', lat: 40.4313, lon: -4.2480, h: 865 },         // DSS-63, Spain
  { id: 'cbr', name: 'Canberra', lat: -35.4022, lon: 148.9813, h: 689 },      // DSS-43, Australia
];
export const DSN_MIN_EL = 10;   // typical minimum antenna elevation, degrees


const D2R = Math.PI / 180, R2D = 180 / Math.PI, AU_KM = 149597870.7;
const WGS84_A = 6378.137, WGS84_E2 = 0.00669437999014;   // km, first eccentricity squared
const NODE_MS = 3 * 3600e3;

/** Greenwich mean sidereal angle (rad) at a UTC instant (IAU 1982 linear term; < 0.01° from apparent). */
const gmst = ms => (((280.46061837 + 360.98564736629 * (ms / 864e5 - 10957.5)) % 360) + 360) % 360 * D2R;

const STATIONS = DSN.map(s => {
  const p = s.lat * D2R, N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(p) ** 2), hk = s.h / 1000;
  return { lon: s.lon * D2R, rxy: (N + hk) * Math.cos(p), z: (N * (1 - WGS84_E2) + hk) * Math.sin(p), cp: Math.cos(p), sp: Math.sin(p) };
});

/** Geocentric position (km) of each station in the equator & equinox of date, at a UTC instant (Earth rotation). */
function stationsEQD(ms, out) {
  const g = gmst(ms);
  for (let s = 0; s < STATIONS.length; s++) {
    const st = STATIONS[s], th = g + st.lon;
    out[3 * s] = st.rxy * Math.cos(th); out[3 * s + 1] = st.rxy * Math.sin(th); out[3 * s + 2] = st.z;
  }
  return out;
}

/**
 * Line of sight from a lunar site to each DSN antenna itself, not just to Earth's centre. Seen from the Moon an antenna
 * sits up to one Earth radius (0.95°) off the disk centre — that decides the link when the Earth hugs the polar horizon.
 * An antenna is "in contact" when it clears the lunar terrain (+ margin) AND sees the Moon above DSN_MIN_EL.
 * The equator-of-date → Moon-fixed rotation (precession, nutation, lunar orientation) is evaluated every 3 h and
 * interpolated; antenna positions follow the Earth's rotation exactly (tools/test-core.mjs checks it against
 * Astronomy Engine's ObserverVector, GeoMoon and the IAU rotation).
 * Returns { any: Uint8Array, per: Uint8Array[], skyEl: Float32Array[], skyAz: Float32Array[] }.
 */
export function dsnLineOfSight(win, frame, mask, dsnVis, commDeg = 0) {
  const A = globalThis.Astronomy, n = win.n, t0 = win.t[0], t1 = win.t[n - 1];
  const nodes = Math.max(2, Math.ceil((t1 - t0) / NODE_MS) + 1), cols = new Float64Array(nodes * 9);
  for (let k = 0; k < nodes; k++) {
    const date = new Date(t0 + k * NODE_MS), time = A.MakeTime(date);
    const toEQJ = A.InverseRotation(A.Rotation_EQJ_EQD(time)), R = moonRotation(date);
    for (let c = 0; c < 3; c++) {                                  // image of each EQD basis vector in the Moon-fixed frame
      const e = A.RotateVector(toEQJ, new A.Vector(c === 0 ? 1 : 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0, time));
      for (let r = 0; r < 3; r++) cols[9 * k + 3 * c + r] = R[3 * r] * e.x + R[3 * r + 1] * e.y + R[3 * r + 2] * e.z;
    }
  }
  const S = DSN.length, per = DSN.map(() => new Uint8Array(n)), skyEl = DSN.map(() => new Float32Array(n)), skyAz = DSN.map(() => new Float32Array(n));
  const any = new Uint8Array(n), st = new Float64Array(3 * S), M = new Float64Array(9);
  const [px, py, pz] = frame.pos, U = frame.up, E = frame.east, N = frame.north;
  for (let i = 0; i < n; i++) {
    const f = (win.t[i] - t0) / NODE_MS, k = Math.min(nodes - 2, Math.floor(f)), u = f - k;
    for (let q = 0; q < 9; q++) M[q] = cols[9 * k + q] + (cols[9 * k + 9 + q] - cols[9 * k + q]) * u;
    stationsEQD(win.t[i], st);
    const ex = win.earth[3 * i], ey = win.earth[3 * i + 1], ez = win.earth[3 * i + 2];
    let ok = 0;
    for (let s = 0; s < S; s++) {
      const a = st[3 * s], b = st[3 * s + 1], c = st[3 * s + 2];
      const x = ex + M[0] * a + M[3] * b + M[6] * c - px, y = ey + M[1] * a + M[4] * b + M[7] * c - py, z = ez + M[2] * a + M[5] * b + M[8] * c - pz;
      const d = Math.hypot(x, y, z);
      const el = Math.asin((x * U[0] + y * U[1] + z * U[2]) / d) * R2D;
      const az = (Math.atan2((x * E[0] + y * E[1] + z * E[2]) / d, (x * N[0] + y * N[1] + z * N[2]) / d) * R2D + 360) % 360;
      skyEl[s][i] = el; skyAz[s][i] = az;
      const link = el - horizonAt(mask, az) > commDeg && dsnVis.el[s][i] >= DSN_MIN_EL ? 1 : 0;
      per[s][i] = link; ok |= link;
    }
    any[i] = ok;
  }
  return { any, per, skyEl, skyAz };
}

/** Returns { el: Float32Array[] (deg, per station), any: Uint8Array (≥1 station above the mask) } on the window grid. */
export function dsnVisibility(win) {
  const A = globalThis.Astronomy, n = win.n, t0 = win.t[0], t1 = win.t[n - 1];
  const nodes = Math.max(2, Math.ceil((t1 - t0) / NODE_MS) + 1), moon = new Float64Array(nodes * 3);
  for (let k = 0; k < nodes; k++) {
    const time = A.MakeTime(new Date(t0 + k * NODE_MS));
    const v = A.RotateVector(A.Rotation_EQJ_EQD(time), A.GeoMoon(time));        // geocentric, equator of date, AU
    moon[3 * k] = v.x * AU_KM; moon[3 * k + 1] = v.y * AU_KM; moon[3 * k + 2] = v.z * AU_KM;
  }
  const el = DSN.map(() => new Float32Array(n)), any = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const f = (win.t[i] - t0) / NODE_MS, k = Math.min(nodes - 2, Math.floor(f)), u = f - k, j = 3 * k;
    const mx = moon[j] + (moon[j + 3] - moon[j]) * u, my = moon[j + 1] + (moon[j + 4] - moon[j + 1]) * u, mz = moon[j + 2] + (moon[j + 5] - moon[j + 2]) * u;
    const g = gmst(win.t[i]);
    let seen = 0;
    for (let s = 0; s < STATIONS.length; s++) {
      const st = STATIONS[s], th = g + st.lon, ct = Math.cos(th), sn = Math.sin(th);
      const x = mx - st.rxy * ct, y = my - st.rxy * sn, z = mz - st.z;              // station -> Moon
      const up = (x * st.cp * ct + y * st.cp * sn + z * st.sp) / Math.hypot(x, y, z);
      const e = Math.asin(Math.max(-1, Math.min(1, up))) * R2D;
      el[s][i] = e;
      if (e >= DSN_MIN_EL) seen = 1;
    }
    any[i] = seen;
  }
  return { el, any };
}
