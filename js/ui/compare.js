// Compare tab: side-by-side scenario table + "When & where to land" site × date heatmap.
import { fitCanvas, fmtDate, fmtDur, fmtDay, monthName, showTip, hideTip, COLORS } from './util.js';
import { sampleWindow, siteFrame } from '../core/ephemeris.js';
import { dsnVisibility, dsnLineOfSight } from '../core/dsn.js';
import { rankLandingDays } from '../core/bestdates.js';

const tick = () => new Promise(r => setTimeout(r, 0));   // yield to the browser between heavy steps

const COLS = [
  ['sunPct', 'Sunlight', v => `${v.toFixed(1)}%`, 1],
  ['earthPct', 'Earth (DTE)', v => `${v.toFixed(1)}%`, 1],
  ['bothPct', 'Sun + Earth', v => `${v.toFixed(1)}%`, 1],
  ['longestNightH', 'Longest dark', v => fmtDur(v), -1],
  ['longestCommGapH', 'Longest comm gap', v => fmtDur(v), -1],
  ['meanPowerWm2', 'Mean power', v => `${v.toFixed(0)} W/m²`, 1],
  ['minSocPct', 'Battery low', v => (v <= 0 ? '✗ empty' : `${v.toFixed(0)}%`), 1],
  ['score', 'Score', v => `${v}`, 1],
];

export class Compare {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.items = [];
    this.hmCanvas = document.getElementById('heatmap');
    const yearSel = document.getElementById('hm-year');
    const y0 = new Date().getUTCFullYear();
    for (let y = y0; y <= y0 + 6; y++) yearSel.add(new Option(String(y), y));
    for (const id of ['hm-year', 'hm-dur', 'hm-metric']) document.getElementById(id).onchange = () => { if (id === 'hm-year') this.yearTouched = true; this.drawHeatmap(); };
    document.getElementById('btn-compare-clear').onclick = () => { this.items = []; this.renderTable(); this.onChange?.(); };
    this.hmCanvas.addEventListener('pointermove', e => this.hmHover(e));
    this.hmCanvas.addEventListener('pointerleave', hideTip);
    this.hmCanvas.addEventListener('click', e => this.hmClick(e));
  }

  add(sc) { this.items.push({ ...sc, ...this.analyzeScenario(sc) }); if (this.visible) this.renderTable(); }
  show() {
    this.visible = true;
    // follow the year of the scenario being planned until the user picks one explicitly
    const sel = document.getElementById('hm-year'), y = String(this.getYear?.());
    if (!this.yearTouched && [...sel.options].some(o => o.value === y)) sel.value = y;
    this.renderTable(); this.drawHeatmap();
  }
  redraw() { if (this.visible) { this.renderTable(); this.drawHeatmap(); } }

  renderTable() {
    const el = document.getElementById('compare-table');
    if (!this.items.length) {
      el.innerHTML = '<div class="empty">No scenarios yet. In the Plan tab choose a site and date, then press “+ Compare”. Try the same site one day later (schedule slip) or a neighbouring ridge.</div>';
      return;
    }
    const best = {};
    for (const [k, , , dir] of COLS) best[k] = this.items.reduce((b, it) => (dir > 0 ? Math.max(b, it.M[k]) : Math.min(b, it.M[k])), dir > 0 ? -Infinity : Infinity);
    el.innerHTML = `<table><thead><tr><th>Scenario</th><th>Landing (UTC)</th><th>Window</th><th>Array</th>${COLS.map(c => `<th>${c[1]}</th>`).join('')}<th style="text-align:left">Sun / Earth timeline</th><th></th></tr></thead>
      <tbody>${this.items.map((it, i) => `<tr data-i="${i}"><td>${it.site.name}</td><td>${fmtDate(it.startMs)}</td><td>${fmtDur(it.durDays * 24)}</td><td>${this.HEIGHTS[it.heightIdx]} m</td>
        ${COLS.map(([k, , f]) => `<td class="${it.M[k] === best[k] && this.items.length > 1 ? 'best' : ''}">${f(it.M[k])}</td>`).join('')}
        <td><canvas class="strip" data-i="${i}"></canvas></td><td><button class="btn tiny" data-del="${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('tbody tr').forEach(tr => tr.onclick = e => {
      if (e.target.dataset.del != null) { this.items.splice(+e.target.dataset.del, 1); this.renderTable(); this.onChange?.(); return; }
      this.openScenario(this.items[+tr.dataset.i]);
    });
    el.querySelectorAll('canvas.strip').forEach(c => this.drawStrip(c, this.items[+c.dataset.i].S));
  }

  drawStrip(canvas, S) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.fillStyle = '#121a2e'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor(x / w * S.n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * S.n));
      let sf = 0, ev = 0;
      for (let i = i0; i < i1; i++) { sf += S.sunFrac[i]; ev += S.earthVis[i]; }
      sf /= (i1 - i0); ev /= (i1 - i0);
      ctx.fillStyle = `rgba(255,194,75,${sf})`; ctx.fillRect(x, 0, 1, h / 2 - 1);
      ctx.fillStyle = `rgba(77,163,255,${ev})`; ctx.fillRect(x, h / 2 + 1, 1, h / 2 - 1);
    }
  }

  // ---------------------------------------------------------------- heatmap
  heatmapSites() {
    return this.sites.filter(s => s.terrain);
  }

  /**
   * Progressive heatmap: one site per tick, so opening the tab never freezes the page (each row is a full year
   * of hourly geometry); rows appear as they are ready. A newer request (year, window, power) cancels an older one.
   */
  async ensureHeatmap() {
    const year = +document.getElementById('hm-year').value, D = +document.getElementById('hm-dur').value;
    const power = this.getPower?.();
    const key = `${year}|${D}|${JSON.stringify(power)}`;
    if (this.hmData?.key === key) return;                              // done, or being computed
    const token = (this.hmToken = (this.hmToken ?? 0) + 1);
    const t0 = Date.UTC(year, 0, 1), days = (Date.UTC(year + 1, 0, 1) - t0) / 864e5, sites = this.heatmapSites();
    this.hmData = { key, year, D, t0, days, rows: [], total: sites.length, done: false };
    this.paintHeatmap();
    await tick();
    const win = sampleWindow(t0, t0 + (days + D) * 864e5, 60);         // one ephemeris pass shared by every site
    const vis = dsnVisibility(win);                                     // Moon elevation at the DSN complexes, shared too
    for (const site of sites) {
      await tick();
      if (token !== this.hmToken) return;                              // superseded by newer settings
      const hz = this.horizonFor(site), link = dsnLineOfSight(win, siteFrame(site.lat, site.lon, hz.siteM), hz.mask, vis, 0).any;
      const cells = rankLandingDays({ site, hz, startMs: t0, days, durDays: D, power, win, link }).map(c => c.m);
      this.hmData.rows.push({ site, cells });
      this.paintHeatmap();
    }
    this.hmData.done = true;
    this.paintHeatmap();
  }

  horizonFor(site) {
    this._hz ??= new Map();
    if (!this._hz.has(site.id)) this._hz.set(site.id, this.analyzeScenario({ site, startMs: Date.UTC(2026, 0, 1), durDays: 1, heightIdx: 1, commDeg: 0 }).hz);
    return this._hz.get(site.id);
  }

  drawHeatmap() {
    if (!this.visible) return;
    this.ensureHeatmap();
    this.paintHeatmap();
  }

  paintHeatmap() {
    const data = this.hmData;
    if (!this.visible || !data) return;
    const metric = document.getElementById('hm-metric').value;
    this.hmCanvas.style.height = `${26 + data.total * 32 + 10}px`;
    const { ctx, w, h } = fitCanvas(this.hmCanvas);
    const L = 190, T = 26, B = 8, rowH = Math.min(34, (h - T - B) / data.total);
    this.layout = { L, T, rowH, cw: (w - L - 8) / data.days, data };
    ctx.fillStyle = '#060912'; ctx.fillRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    this.heatmapSites().forEach((site, ri) => {
      const y = T + ri * rowH, r = data.rows[ri];
      ctx.fillStyle = r ? COLORS.text : COLORS.muted; ctx.textAlign = 'right';
      ctx.fillText(site.name, L - 8, y + rowH / 2);
      if (!r) { ctx.fillStyle = '#0e1426'; ctx.fillRect(L, y + 1, w - L - 8, rowH - 2); return; }
      r.cells.forEach((m, d) => {
        ctx.fillStyle = colorFor(metric, m[metric]);
        ctx.fillRect(L + d * this.layout.cw, y + 1, Math.ceil(this.layout.cw), rowH - 2);
      });
    });
    ctx.fillStyle = COLORS.muted; ctx.textAlign = 'left';
    for (let mth = 0; mth < 12; mth++) {
      const d = (Date.UTC(data.year, mth, 1) - data.t0) / 864e5, x = L + d * this.layout.cw;
      ctx.fillText(monthName(mth), x + 2, 12);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x, T - 4, 1, data.total * rowH + 4); ctx.fillStyle = COLORS.muted;
    }
    document.getElementById('hm-foot').textContent = data.done
      ? `${data.rows.length} terrain-modelled sites × ${data.days} landing dates in ${data.year}, ${data.D}-day missions, array 2 m. ` +
        'Hover a cell for details · click to open it in Plan. Score = js/core/score.js.'
      : `Computing a year of hourly Sun & Earth geometry for every site… ${data.rows.length}/${data.total}`;
  }

  cellAt(e) {
    const l = this.layout; if (!l) return null;
    const r = this.hmCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const ri = Math.floor((y - l.T) / l.rowH), d = Math.floor((x - l.L) / l.cw);
    if (ri < 0 || ri >= l.data.rows.length || d < 0 || d >= l.data.days) return null;
    return { row: l.data.rows[ri], d, m: l.data.rows[ri].cells[d], start: l.data.t0 + d * 864e5 };
  }
  hmHover(e) {
    const c = this.cellAt(e);
    if (!c) return hideTip();
    const m = c.m;
    showTip(`<b>${c.row.site.name}</b><br>Landing ${fmtDay(c.start)} ${new Date(c.start).getUTCFullYear()}, ${this.layout.data.D}-day mission<br>` +
      `Sunlight <b>${m.sunPct.toFixed(0)}%</b> · Earth <b>${m.earthPct.toFixed(0)}%</b> · both <b>${m.bothPct.toFixed(0)}%</b>` +
      (m.dsnPct != null ? ` · DSN link <b>${m.dsnPct.toFixed(0)}%</b>` : '') + '<br>' +
      `Longest dark <b>${fmtDur(m.longestNightH)}</b> · comm gap <b>${fmtDur(m.longestCommGapH)}</b><br>` +
      (m.minSocPct != null ? `Battery ${m.survives ? `lowest <b>${m.minSocPct.toFixed(0)}%</b>` : '<b style="color:#ff6b6b">runs empty</b>'}<br>` : '') +
      `Score <b>${m.score}</b>`, e.clientX, e.clientY);
  }
  hmClick(e) {
    const c = this.cellAt(e);
    if (c) this.openScenario({ site: c.row.site, startMs: c.start, durDays: this.layout.data.D, heightIdx: 1, commDeg: 0 });
  }
}

// Perceptual ramps: dark navy -> amber/blue/green -> near white
function colorFor(metric, v) {
  const t = Math.max(0, Math.min(1, v / 100));
  const ramps = { sunPct: [[14, 18, 34], [168, 110, 20], [255, 214, 120]], earthPct: [[14, 18, 34], [30, 90, 170], [150, 205, 255]],
    dsnPct: [[14, 18, 34], [20, 110, 150], [140, 235, 245]],
    bothPct: [[14, 18, 34], [25, 120, 80], [140, 240, 190]], score: [[14, 18, 34], [120, 70, 160], [255, 200, 90]],
    minSocPct: [[120, 30, 40], [200, 140, 40], [60, 210, 130]] };
  const [a, b, c] = ramps[metric] ?? ramps.score;
  const mix = (p, q, f) => p.map((x, i) => Math.round(x + (q[i] - x) * f));
  const rgb = t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2);
  return `rgb(${rgb})`;
}
