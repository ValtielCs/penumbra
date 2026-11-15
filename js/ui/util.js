// Small UI helpers shared by the canvas views.

export const COLORS = {
  sun: '#ffc24b', sunDim: 'rgba(255,194,75,0.28)', earth: '#4da3ff', earthDim: 'rgba(77,163,255,0.28)',
  both: '#39d98a', bad: '#ff6b6b', terrain: '#5d6678', grid: 'rgba(138,150,178,0.16)', text: '#e6ebf5', muted: '#8a96b2',
};

/** Size a canvas to its CSS box × devicePixelRatio. Returns a ctx already scaled to CSS pixels. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

export function fmtDur(hours) {
  if (hours == null || !isFinite(hours)) return '—';
  const sign = hours < 0 ? '−' : '';
  hours = Math.abs(hours);
  if (hours < 1) return `${sign}${Math.round(hours * 60)} min`;
  if (hours < 48) { const h = Math.floor(hours), m = Math.round((hours - h) * 60); return `${sign}${h} h${m ? ` ${m} min` : ''}`; }
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return `${sign}${d} d${h ? ` ${h} h` : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(ms, withTime = true) {
  const d = new Date(ms);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withTime ? `${s}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC` : s;
}
export const fmtDay = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const monthName = i => MONTHS[i];
export const fmtDeg = (x, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}°`;
export const fmtLat = lat => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}`;
export const fmtLon = lon => `${(((lon % 360) + 360) % 360).toFixed(2)}°E`;
export const wrap180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; };

export { destination, bearingTo } from '../core/geo.js';

/** "UTC" value for <input type=datetime-local> and back (we treat the input as UTC). */
export const toInputUTC = ms => new Date(ms).toISOString().slice(0, 16);
export const fromInputUTC = s => {             // tolerant: "2027-03-01", "…T06:30", "…T06:30:00", "…Z"
  if (!s) return NaN;
  let v = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += 'T00:00';
  if (/T\d{2}:\d{2}$/.test(v)) v += ':00';
  return Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}Z`);
};

const tip = () => document.getElementById('tooltip');
export function showTip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 14);
  const top = y + r.height + 18 > window.innerHeight ? y - r.height - 10 : y + 14;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}
export const hideTip = () => { tip().hidden = true; };

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

/**
 * Two-finger pinch on touch screens: onPinch(factor, clientX, clientY), factor > 1 when the fingers spread.
 * Returns a state object; `busy()` is true during a pinch and just after it (so drags/clicks are ignored).
 */
export function pinch(el, { onPinch, onEnd }) {
  const pts = new Map(), st = { active: false, endedAt: -1e9, busy: () => st.active || performance.now() - st.endedAt < 350 };
  el.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size >= 2) st.active = true; });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const [a0, b0] = [...pts.values()];
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size !== 2) return;
    const [a1, b1] = [...pts.values()];
    const d0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]), d1 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]);
    if (d0 > 8 && d1 > 8) onPinch(d1 / d0, (a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2);
  });
  const up = e => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size === 0 && st.active) { st.active = false; st.endedAt = performance.now(); onEnd?.(); }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return st;
}

/** Pointer drag helper: calls onDrag(dx, dy, e) and onClick(e) if the pointer barely moved. `gesture` = a pinch() state. */
export function dragger(el, { onStart, onDrag, onEnd, onClick, onHover, onLeave, gesture }) {
  let down = null;
  el.addEventListener('pointerdown', e => {
    down = { x: e.clientX, y: e.clientY, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone (or synthetic) */ }
    onStart?.(e);
  });
  el.addEventListener('pointermove', e => {
    if (down && gesture?.busy()) { down.moved = true; return; }            // a pinch owns the gesture
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
      if (down.moved) onDrag?.(dx, dy, e);
    } else onHover?.(e);
  });
  el.addEventListener('pointerup', e => { if (down && !down.moved) onClick?.(e); if (down) onEnd?.(e); down = null; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerleave', e => { if (!down) onLeave?.(e); });
}
