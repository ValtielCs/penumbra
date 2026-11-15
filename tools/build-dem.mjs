// Build the browser DEM pyramid from the LOLA polar stereographic GDR.
// Input : LDEM_75S_240M.IMG (PDS3, 3812x3812 LSB int16, 0.5 m/DN, ref radius 1737.4 km, MOON_ME)
// Output: data/dem/l0.bin.gz  — 84°S..pole at native 240 m/px (near field, crisp horizons)
//         data/dem/l1.bin.gz  — 75°S..pole box-averaged to 960 m/px (far field)
//         data/dem/dem.json   — grid metadata used by js/core/dem.js
// Usage : node tools/build-dem.mjs raw/lola/ldem_75s_240m.img data/dem
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const [, , src = 'raw/lola/ldem_75s_240m.img', outDir = 'data/dem'] = process.argv;
const N = 3812, OFF = 1905.5, SCALE = 240, R = 1737400;
const buf = readFileSync(src);
if (buf.length !== N * N * 2) throw new Error(`Unexpected size ${buf.length}`);
const src16 = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
mkdirSync(outDir, { recursive: true });

const rhoAt = latDeg => 2 * R * Math.tan(Math.PI / 4 + (latDeg * Math.PI / 180) / 2);
// Encoding: per-row delta (first sample vs 0) -> split low/high byte planes -> gzip.
// Heights are smooth, so deltas are small and the high-byte plane is almost all 0x00/0xFF:
// ~40% smaller than plain gzip. Decoded by decodeLevel() in js/core/dem.js.
function encode(a, n) {
  const d = new Int16Array(a.length);
  for (let r = 0; r < n; r++) { let prev = 0; for (let c = 0; c < n; c++) { const i = r * n + c; d[i] = a[i] - prev; prev = a[i]; } }
  const b = new Uint8Array(d.buffer), h = a.length, out = Buffer.alloc(h * 2);
  for (let i = 0; i < h; i++) { out[i] = b[2 * i]; out[h + i] = b[2 * i + 1]; }
  return gzipSync(out, { level: 9 });
}
const levels = [];
let minDN = Infinity, maxDN = -Infinity;
for (const v of src16) { if (v < minDN) minDN = v; if (v > maxDN) maxDN = v; }

// L0: native-resolution crop down to 84°S
{
  const half = Math.ceil(rhoAt(-84) / SCALE) + 1;        // pixels from pole to edge
  const n = half * 2;
  const start = OFF - (n - 1) / 2;                       // integer because OFF is x.5 and n even
  const out = new Int16Array(n * n);
  for (let r = 0; r < n; r++) out.set(src16.subarray((start + r) * N + start, (start + r) * N + start + n), r * n);
  writeFileSync(join(outDir, 'l0.bin.gz'), encode(out, n));
  levels.push({ file: 'l0.bin.gz', n, scale: SCALE, off: (n - 1) / 2, latLimit: -84 });
}
// L1: 4x4 box average of the full 75°S grid
{
  const f = 4, n = Math.floor(N / f);
  const out = new Int16Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let s = 0;
    for (let i = 0; i < f; i++) for (let j = 0; j < f; j++) s += src16[(r * f + i) * N + c * f + j];
    out[r * n + c] = Math.round(s / (f * f));
  }
  writeFileSync(join(outDir, 'l1.bin.gz'), encode(out, n));
  levels.push({ file: 'l1.bin.gz', n, scale: SCALE * f, off: (OFF - (f - 1) / 2) / f, latLimit: -75 });
}
const meta = {
  source: 'LRO LOLA GDR LDEM_75S_240M (PDS Geosciences Node), polar stereographic, MOON_ME (DE421)',
  encoding: 'int16 LE, per-row delta, byte-plane shuffle (lo then hi), gzip', radiusM: R, dnToMeters: 0.5, minM: minDN * 0.5, maxM: maxDN * 0.5,
  projection: 'x = rho*sin(lon), y = rho*cos(lon), rho = 2R*tan(pi/4 + lat/2); col = off + x/scale; row = off - y/scale',
  levels,
};
writeFileSync(join(outDir, 'dem.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
