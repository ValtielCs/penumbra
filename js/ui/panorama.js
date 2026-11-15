// 360° horizon panorama: LOLA terrain silhouette + Sun & Earth tracks over the mission window.
import { COLORS, fitCanvas, fmtDur, fmtDeg, wrap180, showTip, hideTip, dragger } from './util.js';
import { horizonAt } from '../core/horizon.js';

const AZ_LABELS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

export class Panorama {
  constructor(canvas, foot) {
    this.canvas = canvas; this.foot = foot;
    this.centerAz = null;      // null = auto (follow Earth's mean azimuth)
    this.follow = false;
    this.data = null;
    let startAz = 0;
    dragger(canvas, {
      onStart: () => { startAz = this.currentCenter(); },
      onDrag: dx => { this.centerAz = (startAz - dx * 360 / this.w + 360) % 360; this.follow = false; document.getElementById('chk-follow').checked = false; this.draw(); },
      onHover: e => this.hover(e),
      onLeave: () => { hideTip(); this.onHoverAz?.(null); },
    });
  }

  /** Mark a direction in the sky (e.g. the point under the map cursor): { az, el, text } or null. */
  setMarker(m) { this.marker = m; this.draw(); }

  currentCenter() {
    const d = this.data;
    if (!d) return 0;
    if (this.follow) return d.S.sunAz[d.now.i];
    if (this.centerAz != null) return this.centerAz;
    // Polar sites: Earth hugs the horizon and barely moves -> center on its mean azimuth.
    // Elsewhere (Earth high in the sky, or never up on the far side) -> center on the Sun mid-window.
    if (d.earthMin < -15 || d.earthMin > 20) return d.S.sunAz[Math.floor(d.S.n / 2)];
    let sx = 0, sy = 0;
    for (let i = 0; i < d.S.n; i += 4) { const a = d.S.earthAz[i] * Math.PI / 180; sx += Math.cos(a); sy += Math.sin(a); }
    return (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
  }

  /** d = { S, hz, now, sunR, earthR, earthPhase, sunPhaseAngleScreen? , M } */
  set(d) {
    let earthMin = 90, earthMax = -90, sunMin = 90, sunMax = -90;
    for (let i = 0; i < d.S.n; i++) {
      const e = d.S.earthEl[i], s = d.S.sunEl[i];
      if (e < earthMin) earthMin = e; if (e > earthMax) earthMax = e;
      if (s < sunMin) sunMin = s; if (s > sunMax) sunMax = s;
    }
    let mMin = Infinity, mMax = -Infinity;
    for (const v of d.hz.mask) { if (v < mMin) mMin = v; if (v > mMax) mMax = v; }
    if (!d.hz.terrain) { mMin = 0; mMax = 0; }
    this.data = { ...d, earthMin, earthMax, sunMin, sunMax, mMin, mMax };
    // Elevation range: keep the terrain and both tracks, but never let a far-below Earth flatten everything.
    let lo = Math.min(mMin, sunMin, earthMin > -15 ? earthMin : Infinity) - 0.6;
    let hi = Math.max(mMax, sunMax, earthMin > -15 ? earthMax : -Infinity) + 0.9;
    lo = Math.max(-12, lo); hi = Math.min(90, Math.max(hi, lo + 3));
    this.lo = lo; this.hi = hi;
    this.draw();
  }

  x(az) { return this.w / 2 + wrap180(az - this.cAz) * this.w / 360; }
  y(el) { return this.top + (this.hi - el) / (this.hi - this.lo) * this.ph; }

  draw() {
    const d = this.data;
    if (!d || !this.canvas.offsetParent) return;
    const { ctx, w, h } = fitCanvas(this.canvas);
    this.w = w; this.h = h; this.top = 14; this.ph = h - 14 - 24;
    this.cAz = this.currentCenter();
    const { S, hz, now } = d;
    const pxDegX = w / 360, pxDegY = this.ph / (this.hi - this.lo);
    this.ve = pxDegY / pxDegX;

    // sky
    const sky = ctx.createLinearGradient(0, this.top, 0, this.top + this.ph);
    sky.addColorStop(0, '#04060c'); sky.addColorStop(1, '#0d1430');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // grid lines (labels are drawn last, on top of the terrain)
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const step = niceStep((this.hi - this.lo) / 6);
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    for (let el = Math.ceil(this.lo / step) * step; el <= this.hi; el += step) {
      const y = Math.round(this.y(el)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let az = 0; az < 360; az += 15) {
      const x = Math.round(this.x(az)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, this.top); ctx.lineTo(x, this.top + this.ph); ctx.stroke();
    }

    // 0° smooth-Moon horizon
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(200,210,235,.45)';
    const y0 = this.y(0); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke(); ctx.setLineDash([]);

    // tracks (drawn under the terrain so blocked parts disappear behind ridges)
    this.track(ctx, S.n, i => S.sunAz[i], i => S.sunEl[i], i => S.sunFrac[i] >= 0.5, COLORS.sun, COLORS.sunDim, S, now.i);
    this.track(ctx, S.n, i => S.earthAz[i], i => S.earthEl[i], i => S.earthVis[i] === 1, COLORS.earth, COLORS.earthDim, S, now.i);

    // current bodies
    const sunPx = clamp(d.sunR * pxDegY, 4, 46), earthPx = clamp(d.earthR * pxDegY, 6, 70);
    const sx = this.x(S.sunAz[now.i]), sy = this.y(S.sunEl[now.i]);
    const ex = this.x(S.earthAz[now.i]), ey = this.y(S.earthEl[now.i]);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sunPx * 4);
    glow.addColorStop(0, 'rgba(255,214,120,.55)'); glow.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, sunPx * 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(sx, sy, sunPx, 0, 7); ctx.fill();
    if (S.earthEl[now.i] >= this.lo - earthPx / pxDegY) drawEarth(ctx, ex, ey, earthPx, d.earthPhase, Math.atan2(sy - ey, wrapDx(sx - ex, w)));

    // terrain silhouette
    const ground = ctx.createLinearGradient(0, this.top, 0, h);
    ground.addColorStop(0, '#6b7486'); ground.addColorStop(1, '#232838');
    const bottom = this.top + this.ph;
    ctx.fillStyle = ground; ctx.globalAlpha = 0.93;
    ctx.beginPath(); ctx.moveTo(0, bottom);
    for (let px = 0; px <= w; px += 1) {
      const az = this.cAz - 180 + px * 360 / w;
      ctx.lineTo(px, Math.min(bottom, this.y(hz.terrain ? horizonAt(hz.mask, az) : 0)));
    }
    ctx.lineTo(w, bottom); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#aab3c5'; ctx.lineWidth = 1.2; ctx.stroke();

    // linked cursor from the polar map: where that spot appears in this sky
    if (this.marker) {
      const m = this.marker, mx = this.x(m.az), my = this.y(Math.max(this.lo, Math.min(this.hi, m.el)));
      ctx.save();
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, this.top); ctx.lineTo(mx, this.top + this.ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 4, 0, 7); ctx.stroke(); ctx.fill();
      ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
      label(ctx, mx + 8, this.top + 12, m.text, '#ffffff', w);
      ctx.restore();
    }

    // axis labels on top of everything
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
    for (let el = Math.ceil(this.lo / step) * step; el <= this.hi; el += step) {
      const y = this.y(el);
      ctx.fillStyle = 'rgba(5,7,13,.55)'; ctx.fillRect(2, y - 15, 34, 14);
      ctx.fillStyle = '#c3cbe0'; ctx.fillText(`${+el.toFixed(2)}°`, 5, y - 8);
    }
    ctx.textAlign = 'center';
    for (let az = 0; az < 360; az += 45) {
      const x = this.x(az);
      if (x < 16 || x > w - 16) continue;
      ctx.fillStyle = AZ_LABELS[az] ? COLORS.text : COLORS.muted;
      ctx.fillText(AZ_LABELS[az] ?? `${az}°`, x, h - 10);
    }

    // Earth below the frame (far side) -> arrow hint
    if (S.earthEl[now.i] < this.lo) {
      ctx.fillStyle = COLORS.earth; ctx.textAlign = 'center';
      ctx.fillText(`▼ Earth ${Math.abs(S.earthEl[now.i]).toFixed(0)}° below the horizon`, ex, this.top + this.ph - 10);
    }

    // labels next to the bodies
    ctx.textAlign = 'left'; ctx.font = '12px system-ui, sans-serif';
    label(ctx, sx + sunPx + 6, sy - 8, `Sun ${fmtDeg(S.sunEl[now.i])} · ${(S.sunFrac[now.i] * 100).toFixed(0)}% of disk`, COLORS.sun, w);
    if (S.earthEl[now.i] >= this.lo) label(ctx, ex + earthPx + 6, ey + 8, `Earth ${fmtDeg(S.earthEl[now.i])} · ${S.earthVis[now.i] ? 'in view' : 'blocked'}`, COLORS.earth, w);

    // corner info
    ctx.textAlign = 'right'; ctx.fillStyle = COLORS.muted; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`vertical exaggeration ×${this.ve.toFixed(this.ve < 10 ? 1 : 0)} · drag to look around`, w - 6, this.top + 6);
    const terrainNote = hz.terrain ? `Horizon from LOLA terrain (${hz.nAz} azimuths, ray-marched up to 600 km)` : 'Outside the 75°S terrain model: smooth-sphere horizon (0°)';
    this.foot.textContent = `${terrainNote}. Bright track = visible, faint = behind terrain. Dots mark each day of the window.`;
  }

  track(ctx, n, azf, elf, visf, on, off, S, iNow) {
    const w = this.w;
    for (const pass of [false, true]) {
      ctx.strokeStyle = pass ? on : off; ctx.lineWidth = pass ? 2.2 : 1.4;
      ctx.beginPath();
      let px = null, py = null;
      for (let i = 0; i < n; i++) {
        const x = this.x(azf(i)), y = this.y(elf(i)), v = visf(i);
        if (px !== null && Math.abs(x - px) < w / 2 && v === pass) { ctx.moveTo(px, py); ctx.lineTo(x, y); }
        px = x; py = y;
      }
      ctx.stroke();
    }
    // day markers
    const perDay = Math.round(1440 / S.stepMin);
    ctx.fillStyle = on;
    for (let i = perDay; i < n; i += perDay) { ctx.beginPath(); ctx.arc(this.x(azf(i)), this.y(elf(i)), 2.2, 0, 7); ctx.fill(); }
  }

  hover(e) {
    const d = this.data;
    if (!d) return;
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const az = ((this.cAz - 180 + mx * 360 / this.w) % 360 + 360) % 360;
    const k = Math.round(az / 360 * d.hz.nAz) % d.hz.nAz;
    const hzEl = d.hz.terrain ? horizonAt(d.hz.mask, az) : 0;
    const dist = d.hz.terrain ? d.hz.dist[k] : null;
    showTip(`Azimuth <b>${az.toFixed(1)}°</b><br>Terrain horizon <b>${fmtDeg(hzEl)}</b>${dist ? `<br>set by terrain <b>${dist.toFixed(dist < 10 ? 1 : 0)} km</b> away<br><span style="color:#8a96b2">traced on the polar map</span>` : ''}`, e.clientX, e.clientY);
    this.onHoverAz?.(dist ? az : null, dist, hzEl);
  }
}

function drawEarth(ctx, x, y, r, phase, sunAngle) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#0d2040'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.rotate(sunAngle);
  const k = Math.max(0, Math.min(1, phase)), rx = r * (2 * k - 1);
  const g = ctx.createRadialGradient(r * 0.3, -r * 0.2, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#9fd0ff'); g.addColorStop(1, '#2f7fd6');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, Math.abs(rx), r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(77,163,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
}

function label(ctx, x, y, text, color, w) {
  const tw = ctx.measureText(text).width;
  if (x + tw > w - 4) x = x - tw - 40;
  ctx.fillStyle = 'rgba(5,7,13,.7)'; ctx.fillRect(x - 3, y - 9, tw + 6, 18);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapDx = (dx, w) => (dx > w / 2 ? dx - w : dx < -w / 2 ? dx + w : dx);
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
export { fmtDur };
