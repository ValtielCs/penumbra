// Mission-window timeline: sunlight fraction, Earth visibility, both, and Sun elevation vs terrain.
import { COLORS, fitCanvas, fmtDate, fmtDay, fmtDeg, showTip, hideTip, dragger, monthName } from './util.js';

const LEFT = 92, RIGHT = 10;

export class Timeline {
  constructor(canvas, onScrub) {
    this.canvas = canvas; this.onScrub = onScrub;
    const scrub = e => {
      if (!this.S) return;
      const r = canvas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left - LEFT) / (this.w - LEFT - RIGHT)));
      this.onScrub(this.S.t[0] + f * (this.S.t[this.S.n - 1] - this.S.t[0]));
    };
    dragger(canvas, { onDrag: (dx, dy, e) => scrub(e), onClick: scrub, onHover: e => this.hover(e), onLeave: hideTip });
  }

  set(S, M, tNow) { this.S = S; this.M = M; this.tNow = tNow; this.draw(); }

  xOf(t) { const S = this.S; return LEFT + (t - S.t[0]) / (S.t[S.n - 1] - S.t[0]) * (this.w - LEFT - RIGHT); }

  draw() {
    const S = this.S;
    if (!S || !this.canvas.offsetParent) return;
    const { ctx, w, h } = fitCanvas(this.canvas);
    this.w = w; this.h = h;
    ctx.fillStyle = '#060912'; ctx.fillRect(0, 0, w, h);
    const W = w - LEFT - RIGHT;
    const rows = { sun: [6, 34], earth: [46, 18], both: [70, 10], batt: [86, 22], elev: [116, h - 116 - 26] };
    this.rows = rows;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = COLORS.muted; ctx.textAlign = 'right';
    ctx.fillText('Sunlight', LEFT - 8, rows.sun[0] + rows.sun[1] / 2);
    ctx.fillText('Earth (DTE)', LEFT - 8, rows.earth[0] + rows.earth[1] / 2);
    ctx.fillText('Sun + Earth', LEFT - 8, rows.both[0] + rows.both[1] / 2);
    ctx.fillText('Battery', LEFT - 8, rows.batt[0] + rows.batt[1] / 2);
    ctx.fillText('Sun elev.', LEFT - 8, rows.elev[0] + 10);
    ctx.fillStyle = '#9aa6c0'; ctx.fillText('vs terrain', LEFT - 8, rows.elev[0] + 24);

    // per-pixel aggregation (fast even for a 1-year window)
    const cols = Math.max(1, Math.floor(W));
    for (let c = 0; c < cols; c++) {
      const i0 = Math.floor(c / cols * S.n), i1 = Math.max(i0 + 1, Math.floor((c + 1) / cols * S.n));
      let sf = 0, ev = 0, bo = 0, ed = 0;
      for (let i = i0; i < i1; i++) { sf += S.sunFrac[i]; ev += S.earthVis[i]; bo += (S.sunFrac[i] >= 0.5 && S.earthVis[i]) ? 1 : 0; ed += S.dsnLos ? S.dsnLos.any[i] : (S.earthVis[i] && (!S.dsn || S.dsn.any[i]) ? 1 : 0); }
      const k = i1 - i0, x = LEFT + c;
      sf /= k; ev /= k; bo /= k; ed /= k;
      ctx.fillStyle = '#121a2e'; ctx.fillRect(x, rows.sun[0], 1, rows.sun[1]);
      ctx.fillStyle = COLORS.sun; ctx.fillRect(x, rows.sun[0] + rows.sun[1] * (1 - sf), 1, rows.sun[1] * sf);
      // bright = Earth in view AND a DSN antenna sees the Moon; faint = Earth in view but no ground station
      ctx.fillStyle = ed > 0 ? `rgba(77,163,255,${0.25 + 0.75 * ed})` : ev > 0 ? 'rgba(77,163,255,.16)' : '#121a2e'; ctx.fillRect(x, rows.earth[0], 1, rows.earth[1]);
      ctx.fillStyle = bo > 0 ? `rgba(57,217,138,${0.25 + 0.75 * bo})` : '#121a2e'; ctx.fillRect(x, rows.both[0], 1, rows.both[1]);
    }

    // battery state of charge (power-system simulation)
    const soc = this.M?.battery?.soc;
    if (soc) {
      const [by, bh] = rows.batt;
      ctx.fillStyle = '#0b1020'; ctx.fillRect(LEFT, by, W, bh);
      ctx.beginPath(); ctx.moveTo(LEFT, by + bh);
      for (let c = 0; c < cols; c++) {
        const i0 = Math.floor(c / cols * S.n), i1 = Math.max(i0 + 1, Math.floor((c + 1) / cols * S.n));
        let mn = 1; for (let i = i0; i < i1; i++) if (soc[i] < mn) mn = soc[i];
        ctx.lineTo(LEFT + c, by + bh * (1 - mn));
      }
      ctx.lineTo(LEFT + cols, by + bh); ctx.closePath();
      ctx.fillStyle = this.M.battery.survives ? 'rgba(57,217,138,.55)' : 'rgba(255,107,107,.6)'; ctx.fill();
      for (let c = 0; c < cols; c++) {                                  // mark empty-battery stretches
        const i0 = Math.floor(c / cols * S.n), i1 = Math.max(i0 + 1, Math.floor((c + 1) / cols * S.n));
        for (let i = i0; i < i1; i++) if (soc[i] <= 0) { ctx.fillStyle = COLORS.bad; ctx.fillRect(LEFT + c, by + bh - 3, 1, 3); break; }
      }
    }

    // elevation panel: Sun elevation and the terrain horizon under the Sun
    const [ey, eh] = rows.elev;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < S.n; i++) { lo = Math.min(lo, S.sunEl[i], S.sunHz[i]); hi = Math.max(hi, S.sunEl[i], S.sunHz[i]); }
    lo -= 0.2; hi += 0.2;
    const yE = v => ey + (hi - v) / (hi - lo) * eh;
    ctx.fillStyle = '#0b1020'; ctx.fillRect(LEFT, ey, W, eh);
    if (lo < 0 && hi > 0) { ctx.strokeStyle = 'rgba(200,210,235,.25)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(LEFT, yE(0)); ctx.lineTo(LEFT + W, yE(0)); ctx.stroke(); ctx.setLineDash([]); }
    const step = Math.max(1, Math.floor(S.n / (W * 2)));
    // clearance fill
    ctx.fillStyle = 'rgba(255,194,75,.18)';
    for (let i = 0; i < S.n - step; i += step) {
      if (S.sunEl[i] > S.sunHz[i]) {
        const x0 = this.xOf(S.t[i]), x1 = this.xOf(S.t[i + step]);
        ctx.fillRect(x0, yE(S.sunEl[i]), Math.max(1, x1 - x0), yE(S.sunHz[i]) - yE(S.sunEl[i]));
      }
    }
    line(ctx, S, step, i => this.xOf(S.t[i]), i => yE(S.sunHz[i]), '#8d97ab', 1.2);
    line(ctx, S, step, i => this.xOf(S.t[i]), i => yE(S.sunEl[i]), COLORS.sun, 1.6);
    ctx.fillStyle = COLORS.muted; ctx.textAlign = 'left';
    ctx.fillText(`${hi.toFixed(1)}°`, LEFT + 3, ey + 8); ctx.fillText(`${lo.toFixed(1)}°`, LEFT + 3, ey + eh - 8);

    // time axis
    const span = S.t[S.n - 1] - S.t[0], day = 864e5;
    ctx.strokeStyle = 'rgba(138,150,178,.18)'; ctx.fillStyle = COLORS.muted; ctx.textAlign = 'center';
    const ticks = [];
    if (span <= 40 * day) {
      const every = span <= 4 * day ? 0.25 : span <= 16 * day ? 1 : 2;
      for (let t = Math.ceil(S.t[0] / (every * day)) * every * day; t <= S.t[S.n - 1]; t += every * day) ticks.push([t, every < 1 ? `${new Date(t).getUTCHours()}h` : fmtDay(t)]);
    } else {
      const d0 = new Date(S.t[0]);
      for (let m = 0; m < 14; m++) { const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1); if (t >= S.t[0] && t <= S.t[S.n - 1]) ticks.push([t, monthName(new Date(t).getUTCMonth())]); }
    }
    for (const [t, lab] of ticks) {
      const x = Math.round(this.xOf(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, rows.sun[0]); ctx.lineTo(x, ey + eh); ctx.stroke();
      ctx.fillText(lab, x, h - 12);
    }

    // now cursor
    const xn = this.xOf(this.tNow);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xn, 2); ctx.lineTo(xn, ey + eh + 2); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(xn - 5, 0); ctx.lineTo(xn + 5, 0); ctx.lineTo(xn, 6); ctx.fill();
  }

  hover(e) {
    const S = this.S;
    if (!S) return;
    const r = this.canvas.getBoundingClientRect();
    const f = (e.clientX - r.left - LEFT) / (this.w - LEFT - RIGHT);
    if (f < 0 || f > 1) return hideTip();
    const i = Math.round(f * (S.n - 1));
    const soc = this.M?.battery?.soc;
    showTip(`<b>${fmtDate(S.t[i])}</b><br>Sun ${fmtDeg(S.sunEl[i])} (terrain ${fmtDeg(S.sunHz[i])}) · ${(S.sunFrac[i] * 100).toFixed(0)}% of disk<br>` +
      `Array output <b>${S.power[i].toFixed(0)} W/m²</b>${soc ? ` · battery <b>${(soc[i] * 100).toFixed(0)}%</b>` : ''}<br>Earth ${fmtDeg(S.earthEl[i])} · ${S.earthVis[i] ? 'in view' : 'blocked'}` +
      (S.dsn ? `<br>DSN (Moon elevation, contact): ${['Goldstone', 'Madrid', 'Canberra'].map((nm, k) => `${nm} <b>${S.dsn.el[k][i].toFixed(0)}°</b>${S.dsnLos?.per[k][i] ? ' ✓' : ''}`).join(' · ')}` : ''), e.clientX, e.clientY);
  }
}

function line(ctx, S, step, xf, yf, color, lw) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let i = 0; i < S.n; i += step) { const x = xf(i), y = yf(i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
}
