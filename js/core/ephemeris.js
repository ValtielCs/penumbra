// Sun & Earth geometry as seen from a site on the lunar surface.
//
// Pipeline:  Astronomy Engine (geocentric Sun & Moon, J2000/EQJ)
//         -> IAU rotation model of the Moon (≈ MOON_ME frame, same frame as LOLA DEMs)
//         -> Moon-fixed vectors to Sun and Earth
//         -> topocentric azimuth / elevation at a surface site (east-positive lon).
//
// Works in the browser (global `Astronomy` from vendor/astronomy.browser.min.js)
// and in Node (set globalThis.Astronomy = require('vendor/astronomy.js') first).
// Validated against JPL Horizons (see tools/validate-horizons.mjs, data/validation.json).

export const AU_KM = 149597870.7;
export const MOON_R_KM = 1737.4;          // LOLA reference radius
export const SUN_R_KM = 695700;           // IAU nominal solar radius
export const EARTH_R_KM = 6371.0;         // mean Earth radius
export const SOLAR_CONSTANT = 1361;       // W/m² at 1 AU
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

const A = () => globalThis.Astronomy;

// Passive rotation matrices (frame rotations), row-major 3x3.
function rotZ(t) { const c = Math.cos(t), s = Math.sin(t); return [c, s, 0, -s, c, 0, 0, 0, 1]; }
function rotX(t) { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, s, 0, -s, c]; }
function mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
function apply(m, x, y, z) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** EQJ -> Moon body-fixed rotation, IAU WGCCRE model: R = Rz(W)·Rx(90°-δ0)·Rz(90°+α0). */
export function moonRotation(date) {
  const ax = A().RotationAxis(A().Body.Moon, date);
  const a0 = ax.ra * 15 * D2R, d0 = ax.dec * D2R, W = ax.spin * D2R;
  return mul(rotZ(W), mul(rotX(Math.PI / 2 - d0), rotZ(Math.PI / 2 + a0)));
}

/**
 * Site-independent geometry at one instant: vectors (km) from the Moon's center
 * to the Sun and to the Earth, expressed in the Moon-fixed (ME) frame.
 */
export function moonFixed(date) {
  const Ast = A();
  const m = Ast.GeoMoon(date);                       // Earth -> Moon, EQJ, AU
  const s = Ast.GeoVector(Ast.Body.Sun, date, true); // Earth -> Sun (apparent), EQJ, AU
  const R = moonRotation(date);
  const sun = apply(R, (s.x - m.x) * AU_KM, (s.y - m.y) * AU_KM, (s.z - m.z) * AU_KM);
  const earth = apply(R, -m.x * AU_KM, -m.y * AU_KM, -m.z * AU_KM);
  return { sun, earth };
}

/** Planetocentric lat/lon (deg, east-positive 0..360) of a Moon-fixed direction. */
export function subPoint(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / r) * R2D, lon: (Math.atan2(v[1], v[0]) * R2D + 360) % 360, dist: r };
}

/** Local frame of a surface site. heightM = height above the 1737.4 km sphere. */
export function siteFrame(latDeg, lonDeg, heightM = 0) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const r = MOON_R_KM + heightM / 1000;
  return {
    lat: latDeg, lon: lonDeg, heightM,
    pos: [r * cl * co, r * cl * so, r * sl],
    up: [cl * co, cl * so, sl],
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
  };
}

/** Topocentric azimuth (deg from local north, through east) & elevation (deg) of a Moon-fixed position vector. */
export function azel(target, f) {
  const x = target[0] - f.pos[0], y = target[1] - f.pos[1], z = target[2] - f.pos[2];
  const d = Math.hypot(x, y, z);
  const u = (x * f.up[0] + y * f.up[1] + z * f.up[2]) / d;
  const e = (x * f.east[0] + y * f.east[1] + z * f.east[2]) / d;
  const n = (x * f.north[0] + y * f.north[1] + z * f.north[2]) / d;
  return { az: (Math.atan2(e, n) * R2D + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, u))) * R2D, dist: d };
}

/**
 * Sample the site-independent geometry over a time window.
 * Returns flat Float64Arrays so many sites can reuse one ephemeris pass.
 */
const NODE_MS = 3 * 3600e3;

export function sampleWindow(t0ms, t1ms, stepMin) {
  const stepMs = stepMin * 60000;
  const n = Math.max(2, Math.floor((t1ms - t0ms) / stepMs) + 1);
  const t = new Float64Array(n), sun = new Float64Array(n * 3), earth = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) t[i] = t0ms + i * stepMs;
  const span = t[n - 1] - t0ms;
  if (span <= 2 * 864e5 || stepMs >= 2 * NODE_MS) {                 // short windows or coarse steps: every sample exactly
    for (let i = 0; i < n; i++) { const g = moonFixed(new Date(t[i])); sun.set(g.sun, i * 3); earth.set(g.earth, i * 3); }
    return { t, sun, earth, n, stepMin };
  }
  // Long windows: exact geometry every 3 h + quadratic (3-node Lagrange) interpolation in between.
  // Over a year the directions stay within 0.3″ of exact evaluation (tools/test-core.mjs), 3–12× faster.
  const nodes = Math.ceil(span / NODE_MS) + 2, ns = new Float64Array(nodes * 3), ne = new Float64Array(nodes * 3);
  for (let k = 0; k < nodes; k++) { const g = moonFixed(new Date(t0ms + k * NODE_MS)); ns.set(g.sun, 3 * k); ne.set(g.earth, 3 * k); }
  for (let i = 0; i < n; i++) {
    const x = (t[i] - t0ms) / NODE_MS, k = Math.max(1, Math.min(nodes - 2, Math.round(x))), u = x - k;
    const w0 = u * (u - 1) / 2, w1 = 1 - u * u, w2 = u * (u + 1) / 2, a = 3 * k - 3, b = 3 * k, c = 3 * k + 3;
    for (let d = 0; d < 3; d++) {
      sun[3 * i + d] = w0 * ns[a + d] + w1 * ns[b + d] + w2 * ns[c + d];
      earth[3 * i + d] = w0 * ne[a + d] + w1 * ne[b + d] + w2 * ne[c + d];
    }
  }
  return { t, sun, earth, n, stepMin };
}

/** Earth phase as seen from the Moon (illuminated fraction 0..1) from Moon-fixed vectors. */
export function earthPhase(sunVec, earthVec) {
  // Phase angle at Earth between directions Earth->Sun and Earth->Moon.
  const es = [sunVec[0] - earthVec[0], sunVec[1] - earthVec[1], sunVec[2] - earthVec[2]];
  const em = [-earthVec[0], -earthVec[1], -earthVec[2]];
  const c = (es[0] * em[0] + es[1] * em[1] + es[2] * em[2]) / (Math.hypot(...es) * Math.hypot(...em));
  return (1 + c) / 2;
}

export const angularRadius = (radiusKm, distKm) => Math.asin(Math.min(1, radiusKm / distKm)) * R2D;
