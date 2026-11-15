// Quick sanity check of the LOLA polar stereographic DEM orientation.
// Usage: node tools/inspect-dem.mjs raw/lola/ldem_75s_240m.img
import { readFileSync } from 'node:fs';
const path = process.argv[2];
const buf = readFileSync(path);
const N = 3812, SCALE = 240, OFF = 1905.5, R = 1737400;
const dem = new Int16Array(buf.buffer, buf.byteOffset, N * N);
const h = (line, samp) => dem[line * N + samp] * 0.5;
// lat/lon -> (line, sample), assuming x = rho*sin(lon), y = rho*cos(lon), line = OFF - y/scale
function ll2px(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const rho = 2 * R * Math.tan(Math.PI / 4 + lat / 2);
  const x = rho * Math.sin(lon), y = rho * Math.cos(lon);
  return { samp: OFF + x / SCALE, line: OFF - y / SCALE };
}
let max = -1e9, maxI = 0, min = 1e9, minI = 0;
for (let i = 0; i < dem.length; i++) { if (dem[i] > max) { max = dem[i]; maxI = i; } if (dem[i] < min) { min = dem[i]; minI = i; } }
function px2ll(line, samp) {
  const x = (samp - OFF) * SCALE, y = (OFF - line) * SCALE;
  const rho = Math.hypot(x, y);
  const lat = -(90 - 2 * Math.atan(rho / (2 * R)) * 180 / Math.PI);
  const lon = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  return { lat: lat.toFixed(3), lon: lon.toFixed(2) };
}
console.log('max', max * 0.5, 'm at', px2ll(Math.floor(maxI / N), maxI % N));
console.log('min', min * 0.5, 'm at', px2ll(Math.floor(minI / N), minI % N));
const probes = {
  'Shackleton center (89.67S,129.78E)': [-89.67, 129.78],
  'Mons Mouton (84.6S,31.0E)': [-84.6, 31.0],
  'Malapert Mtn (86S,0E)': [-86.0, 0.0],
  'Haworth center (87.45S,355E)': [-87.45, 355.0],
  'Nobile center (85.25S,53.3E)': [-85.25, 53.3],
  'de Gerlache center (88.5S,272.9E)': [-88.5, 272.9],
  'Connecting ridge C1 (89.44S,222.83E)': [-89.44, 222.83],
  'Pole': [-90, 0],
};
for (const [name, [la, lo]] of Object.entries(probes)) {
  const p = ll2px(la, lo);
  console.log(name.padEnd(40), 'line', p.line.toFixed(1), 'samp', p.samp.toFixed(1), 'h =', h(Math.round(p.line), Math.round(p.samp)), 'm');
}
// Mirror test: same probes with lon negated (would indicate flipped east/west)
console.log('--- mirrored (lon -> -lon) ---');
for (const [name, [la, lo]] of Object.entries(probes)) {
  const p = ll2px(la, -lo);
  console.log(name.padEnd(40), 'h =', h(Math.round(p.line), Math.round(p.samp)), 'm');
}
