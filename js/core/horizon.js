// Terrain horizon mask from the LOLA DEM pyramid.
//
// For each azimuth we march along the great circle leaving the site and keep the maximum
// elevation angle of the terrain, using exact spherical geometry (no flat-Moon approximation):
//   site S = (R + hs)·u,  terrain P = (R + h)·(cosθ·u + sinθ·d)
//   tan(elev) = ((R + h)·cosθ − (R + hs)) / ((R + h)·sinθ)
// Curvature of the Moon is therefore built in: there is no atmosphere, so the geometric
// line of sight IS the horizon (no refraction term).

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/**
 * @param {import('./dem.js').Dem} dem
 * @param {number} latDeg  site latitude (planetocentric, deg)
 * @param {number} lonDeg  site longitude (east-positive, deg)
 * @param {number} obsHeightM observer (solar array / antenna) height above ground, m
 * @param {number} nAz number of azimuth bins over 360° (bin k is centered at k·360/nAz)
 */
export function computeHorizon(dem, latDeg, lonDeg, obsHeightM = 2, nAz = 720, minDistPx = 1.5) {
  const mask = new Float32Array(nAz);
  const dist = new Float32Array(nAz);   // distance (km) of the horizon-defining terrain point
  if (!dem || !dem.covers(latDeg)) return { mask, dist, terrain: false, groundM: 0, siteM: obsHeightM, nAz };

  const R = dem.R, la = latDeg * D2R, lo = lonDeg * D2R;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const ux = cl * co, uy = cl * so, uz = sl;               // up
  const ex = -so, ey = co;                                 // east (ez = 0)
  const nx = -sl * co, ny = -sl * so, nz = cl;             // north
  const groundM = dem.sampleUnit(ux, uy, uz);
  const Rs = R + groundM + obsHeightM;
  const Rmax = R + dem.maxM;
  const near = dem.levels[0].scale * 0.5;                  // half a native pixel
  // Terrain closer than ~1.5 native pixels is not resolved by the DEM: on sharp ridges the
  // bilinear surface makes a neighbouring cell look a few meters higher than the site and
  // casts a spurious shadow. Start the march beyond it (common practice in LOLA illumination studies).
  const sMin = dem.levels[0].scale * minDistPx;
  const sMax = 600e3;

  for (let k = 0; k < nAz; k++) {
    const a = (k / nAz) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    const dx = ca * nx + sa * ex, dy = ca * ny + sa * ey, dz = ca * nz;
    let best = -Infinity, bestS = 0, s = sMin;
    while (s < sMax) {
      const th = s / R, c = Math.cos(th), sn = Math.sin(th);
      const h = dem.sampleUnit(c * ux + sn * dx, c * uy + sn * dy, c * uz + sn * dz);
      if (h !== h) break;                                   // NaN: left the DEM
      const Rt = R + h;
      const t = (Rt * c - Rs) / (Rt * sn);
      if (t > best) { best = t; bestS = s; }
      // Even the highest summit on the map can no longer rise above `best` beyond here, so stop marching this azimuth.
      // That bound, (Rmax·cosθ − Rs)/(Rmax·sinθ), only decreases with θ when Rmax ≥ Rs, or beyond cosθ = Rmax/Rs when the
      // observer is above every summit (then it first rises to the summits' geometric horizon) — check both.
      if ((Rmax * c - Rs) < best * Rmax * sn && (Rmax >= Rs || c < Rmax / Rs)) break;
      s += Math.max(near, s * 0.005);
    }
    mask[k] = best === -Infinity ? 0 : Math.atan(best) * R2D;
    dist[k] = bestS / 1000;
  }
  return { mask, dist, terrain: true, groundM, siteM: groundM + obsHeightM, nAz };
}

/** Horizon elevation (deg) at an arbitrary azimuth, linear interpolation between bins. */
export function horizonAt(mask, azDeg) {
  const n = mask.length, x = (((azDeg % 360) + 360) % 360) * n / 360;
  const i = Math.floor(x) % n, f = x - Math.floor(x);
  return mask[i] * (1 - f) + mask[(i + 1) % n] * f;
}

/** Fraction (0..1) of a disk of angular radius `rDeg` whose center is `dDeg` above a locally flat horizon. */
export function diskFractionAbove(dDeg, rDeg) {
  const d = dDeg / rDeg;
  if (d >= 1) return 1;
  if (d <= -1) return 0;
  return (Math.PI - Math.acos(d) + d * Math.sqrt(1 - d * d)) / Math.PI;
}
