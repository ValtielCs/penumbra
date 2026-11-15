// LOLA DEM pyramid: decoding, loading and sampling in the polar stereographic grid.
// Projection (from the PDS label): rho = 2R·tan(π/4 + lat/2), x = rho·sin(lon), y = rho·cos(lon),
// col = off + x/scale, row = off − y/scale. Heights in meters above the 1737.4 km sphere.

const D2R = Math.PI / 180;

/** Undo build-dem.mjs encoding: byte-plane unshuffle + per-row prefix sum -> Float32 meters. */
export function decodeLevel(bytes, n, dnToMeters = 0.5) {
  const h = n * n, out = new Float32Array(h);
  for (let r = 0; r < n; r++) {
    let acc = 0;
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      let d = bytes[i] | (bytes[h + i] << 8);
      if (d & 0x8000) d -= 0x10000;
      acc = (acc + d) << 16 >> 16;           // int16 wrap-around, same as the encoder
      out[i] = acc * dnToMeters;
    }
  }
  return out;
}

async function gunzipBrowser(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;   // server already removed gzip
  const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

export class Dem {
  constructor(meta, arrays) {
    this.meta = meta;
    this.R = meta.radiusM;
    this.maxM = meta.maxM;
    this.levels = meta.levels.map((l, i) => ({ ...l, data: arrays[i], k: 2 * this.R / l.scale, sinLim: Math.sin(l.latLimit * D2R) }));
    this.outerSin = this.levels[this.levels.length - 1].sinLim;
  }

  static async load(baseUrl, onProgress) {
    const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r; };
    const meta = await (await get(`${baseUrl}/dem.json`)).json();
    // download every level in parallel (index.html also preloads them), decode one after the other
    const bufs = meta.levels.map(l => get(`${baseUrl}/${l.file}`).then(r => r.arrayBuffer()));
    bufs.forEach(p => p.catch(() => {}));                    // a failure is reported once, by the await below
    const arrays = [];
    for (const [i, l] of meta.levels.entries()) {
      onProgress?.(`Loading LOLA terrain ${i + 1}/${meta.levels.length}…`);
      arrays.push(decodeLevel(await gunzipBrowser(await bufs[i]), l.n, meta.dnToMeters));
    }
    return new Dem(meta, arrays);
  }

  /** Is a latitude covered by terrain data? */
  covers(latDeg) { return Math.sin(latDeg * D2R) < this.outerSin - 1e-9; }

  /**
   * Height (m) at a unit vector p = (px, py, pz) in the Moon-fixed frame (z = north).
   * Bilinear sample from the finest level that contains the point; NaN outside the pyramid.
   */
  sampleUnit(px, py, pz) {
    if (pz > this.outerSin) return NaN;
    const q = 1 / (1 - pz);
    for (let li = 0; li < this.levels.length; li++) {
      const L = this.levels[li];
      if (pz > L.sinLim) continue;
      const col = L.off + L.k * py * q, row = L.off - L.k * px * q;
      const n = L.n;
      if (col < 0 || row < 0 || col >= n - 1 || row >= n - 1) continue;
      const c0 = col | 0, r0 = row | 0, fc = col - c0, fr = row - r0, i = r0 * n + c0, d = L.data;
      return (d[i] * (1 - fc) + d[i + 1] * fc) * (1 - fr) + (d[i + n] * (1 - fc) + d[i + n + 1] * fc) * fr;
    }
    return NaN;
  }

  /** Height (m) at polar stereographic map coordinates (meters). */
  heightAtMap(X, Y) {
    const R = this.R, t2 = (X * X + Y * Y) / (4 * R * R), d = 1 + t2;
    return this.sampleUnit(Y / R / d, X / R / d, (t2 - 1) / d);
  }

  heightAt(latDeg, lonDeg) {
    const la = latDeg * D2R, lo = lonDeg * D2R;
    return this.sampleUnit(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  }

  /** Polar stereographic map coordinates (meters) <-> lat/lon (deg, east-positive). */
  static toXY(latDeg, lonDeg, R = 1737400) {
    const rho = 2 * R * Math.tan(Math.PI / 4 + (latDeg * D2R) / 2);
    return { x: rho * Math.sin(lonDeg * D2R), y: rho * Math.cos(lonDeg * D2R) };
  }
  static toLatLon(x, y, R = 1737400) {
    const rho = Math.hypot(x, y);
    return { lat: 2 * Math.atan(rho / (2 * R)) / D2R - 90, lon: ((Math.atan2(x, y) / D2R) + 360) % 360 };
  }
}
