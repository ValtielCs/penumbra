// Great-circle navigation on the lunar sphere. Azimuth is measured from local north through east,
// the same convention as the horizon rays in core/horizon.js.

const D2R = Math.PI / 180, MOON_KM = 1737.4;

/** Point reached from (lat, lon) after `distKm` along the great circle leaving at azimuth `azDeg`. */
export function destination(latDeg, lonDeg, azDeg, distKm) {
  const d = distKm / MOON_KM, a = azDeg * D2R, p1 = latDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(a));
  const l2 = lonDeg * D2R + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D2R, lon: ((l2 / D2R) % 360 + 360) % 360 };
}

/** Initial azimuth (deg) and great-circle distance (km) from point 1 to point 2. */
export function bearingTo(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const az = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D2R + 360) % 360;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;   // haversine: exact at short range
  return { az, distKm: 2 * MOON_KM * Math.asin(Math.min(1, Math.sqrt(h))) };
}
