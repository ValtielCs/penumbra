const A = require('../vendor/astronomy.js');
const t0 = Date.UTC(2026, 0, 1);
const N = 8766;
let s = 0;
const st = performance.now();
for (let i = 0; i < N; i++) {
  const d = new Date(t0 + i * 3600e3);
  const m = A.GeoMoon(d);
  const sun = A.GeoVector(A.Body.Sun, d, true);
  const ax = A.RotationAxis(A.Body.Moon, d);
  s += m.x + sun.x + ax.spin;
}
console.log('per eval ms', ((performance.now() - st) / N).toFixed(4), 'total s', ((performance.now() - st) / 1000).toFixed(2));
const d = new Date(Date.UTC(2026, 10, 15));
console.log('RotationAxis(Moon)', A.RotationAxis(A.Body.Moon, d));
console.log('Libration', A.Libration(d));
