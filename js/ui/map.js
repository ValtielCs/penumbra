// South-polar map: LOLA relief with LIVE ray-marched shadows (WebGL2), mission-window illumination
// and Earth-visibility maps (GPU accumulation), sites and Sun/Earth bearings.
// Every pixel marches a ray toward the Sun (or Earth) through the DEM pyramid, using the same
// spherical geometry as js/core/horizon.js, so the map and the horizon panel always agree.
import { COLORS, fitCanvas, dragger, pinch, showTip, hideTip, fmtLat, fmtLon, fmtDeg, destination } from './util.js';
import { Dem } from '../core/dem.js';

export const LAYERS = {
  RELIEF: 0, LIVE_SUN: 1, LIVE_EARTH: 2, SUN_PCT: 3, EARTH_PCT: 4,
};

// Shared GLSL: DEM pyramid sampling + line-of-sight clearance, used by the 2D map and the 3D view.
export const TERRAIN_GLSL = `
uniform sampler2D u_l0, u_l1;
uniform vec3 u_g0, u_g1;           // (n, scale, off) per level
uniform float u_R, u_hmax;
vec3 unitFromMap(vec2 m){          // inverse polar stereographic (south)
  float t2 = dot(m, m) / (4.0 * u_R * u_R);
  return vec3(m.y / u_R, m.x / u_R, t2 - 1.0) / (1.0 + t2);
}
vec2 mapFromUnit(vec3 q){ float k = 2.0 * u_R / (1.0 - q.z); return vec2(k * q.y, k * q.x); }
float sampleLevel(sampler2D t, vec3 g, vec2 m, out bool ok){
  vec2 cr = vec2(g.z + m.x / g.y, g.z - m.y / g.y);
  ok = all(greaterThanEqual(cr, vec2(0.5))) && all(lessThan(cr, vec2(g.x - 1.5)));
#ifdef MANUAL_BILINEAR
  // GPUs without float-texture filtering (many iOS devices): exact bilinear in the shader, same as dem.js
  vec2 b = floor(cr), f = cr - b; ivec2 i = ivec2(b);
  float h00 = texelFetch(t, i, 0).r, h10 = texelFetch(t, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(t, i + ivec2(0, 1), 0).r, h11 = texelFetch(t, i + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
#else
  return texture(t, (cr + 0.5) / g.x).r;
#endif
}
float height(vec2 m, out bool ok){
  float h = sampleLevel(u_l0, u_g0, m, ok);
  if (ok) return h;
  return sampleLevel(u_l1, u_g1, m, ok);
}
float diskFrac(float d){ d = clamp(d, -1.0, 1.0); return (3.14159265 - acos(d) + d * sqrt(1.0 - d * d)) / 3.14159265; }

// Minimum angular clearance (rad) of the line of sight from P0 along dir, over the terrain.
float clearance(vec3 P0, vec3 dir, float maxT){
  float best = 1.0, t = 360.0;
  for (int i = 0; i < 420; i++){
    vec3 P = P0 + dir * t;
    float r = length(P);
    if (r > u_R + u_hmax && dot(P, dir) > 0.0) break;   // above every summit and climbing
    bool ok; vec3 q = P / r;
    float h = height(mapFromUnit(q), ok);
    if (!ok) break;
    best = min(best, (r - (u_R + h)) / t);
    if (best < -0.02) break;
    t += max(120.0, t * 0.02);
    if (t > maxT) break;
  }
  return best;
}
`;

/**
 * Float DEM textures need OES_texture_float_linear for hardware filtering. Without it (or with ?gpu=manual for
 * testing) we keep full 32-bit heights and interpolate in the shader instead of dropping to half floats,
 * whose 2–8 m height steps would bias grazing-Sun shadows.
 */
export function terrainTextureMode(gl) {
  const hw = !!gl.getExtension('OES_texture_float_linear') && !/[?&]gpu=manual\b/.test(location.search);
  return { hw, filter: hw ? gl.LINEAR : gl.NEAREST, patch: src => (hw ? src : src.replace('#version 300 es', '#version 300 es\n#define MANUAL_BILINEAR')) };
}

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_acc;
uniform vec2 u_res;                // render-target size (px)
uniform vec3 u_view;               // center x, center y (m), meters per px
uniform float u_sunR, u_obs, u_comm;
uniform vec3 u_sun;                // unit vector to the Sun (Moon-fixed)
uniform vec3 u_earth;              // Earth position, meters (Moon-fixed)
uniform int u_mode;                // 0 relief, 1 live Sun, 2 live Earth, 3/4 accumulate Sun/Earth, 5/6 show Sun%/Earth%
out vec4 o;

${TERRAIN_GLSL}
// 5-stop perceptual ramps (inferno-like for sunlight, glacier blues for Earth visibility)
vec3 ramp5(float v, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){
  v = clamp(v, 0.0, 1.0) * 4.0;
  return v < 1.0 ? mix(a, b, v) : v < 2.0 ? mix(b, c, v - 1.0) : v < 3.0 ? mix(c, d, v - 2.0) : mix(d, e, v - 3.0);
}
vec3 inferno(float v){ return ramp5(v, vec3(0.03, 0.02, 0.09), vec3(0.32, 0.06, 0.43), vec3(0.73, 0.21, 0.33), vec3(0.98, 0.55, 0.04), vec3(0.99, 0.96, 0.62)); }
vec3 glacier(float v){ return ramp5(v, vec3(0.03, 0.03, 0.10), vec3(0.09, 0.15, 0.38), vec3(0.10, 0.38, 0.66), vec3(0.30, 0.68, 0.92), vec3(0.82, 0.96, 1.0)); }

void main(){
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 m = vec2(u_view.x + (px.x - 0.5 * u_res.x) * u_view.z, u_view.y - (px.y - 0.5 * u_res.y) * u_view.z);
  bool ok; float h = height(m, ok);
  bool accum = (u_mode == 3 || u_mode == 4);
  if (!ok) { o = accum ? vec4(0.0) : vec4(0.02, 0.03, 0.05, 1.0); return; }
  vec3 up = unitFromMap(m);
  vec3 P0 = up * (u_R + h + u_obs);
  if (accum) {                     // one time-sample of a mission-window average (additive blending)
    float f;
    if (u_mode == 3) f = diskFrac(clearance(P0, u_sun, 220000.0) / u_sunR);
    else f = clearance(P0, normalize(u_earth - P0), 220000.0) > u_comm ? 1.0 : 0.0;
    o = vec4(f, 0.0, 0.0, 1.0); return;
  }
  // local relief normal from finite differences (1 texel of the active level)
  float d = (abs(m.x) < u_g0.y * (u_g0.z - 2.0) && abs(m.y) < u_g0.y * (u_g0.z - 2.0)) ? u_g0.y : u_g1.y;
  bool k1; float hx1 = height(m + vec2(d, 0.0), k1), hx0 = height(m - vec2(d, 0.0), k1);
  float hy1 = height(m + vec2(0.0, d), k1), hy0 = height(m - vec2(0.0, d), k1);
  vec3 ex = normalize(unitFromMap(m + vec2(d, 0.0)) - unitFromMap(m - vec2(d, 0.0)));
  vec3 ey = normalize(unitFromMap(m + vec2(0.0, d)) - unitFromMap(m - vec2(0.0, d)));
  vec3 nrm = normalize(up * (2.0 * d) - ex * (hx1 - hx0) - ey * (hy1 - hy0));
  vec3 fixedL = normalize(up * 0.6 - ex * 0.55 + ey * 0.6);
  float relief = clamp(0.25 + 0.95 * dot(nrm, fixedL), 0.0, 1.2);
  vec3 base = vec3(0.56, 0.58, 0.62) * (0.30 + 0.70 * relief);
  if (u_mode == 0) { o = vec4(base, 1.0); return; }
  if (u_mode == 5 || u_mode == 6) {
    vec4 a = texture(u_acc, gl_FragCoord.xy / u_res);
    if (a.a <= 0.0) { o = vec4(base * 0.5, 1.0); return; }
    float v = clamp(a.r / a.a, 0.0, 1.0);
    vec3 col = u_mode == 5 ? inferno(v) : glacier(v);
    o = vec4(col * (0.55 + 0.45 * relief), 1.0); return;
  }
  if (u_mode == 1) {
    float c = clearance(P0, u_sun, 260000.0);
    float f = diskFrac(c / u_sunR);
    float inc = max(0.0, dot(nrm, u_sun));
    vec3 lit = vec3(1.0, 0.86, 0.60) * (0.38 + 0.62 * relief) * (0.85 + 0.6 * inc);
    vec3 dark = vec3(0.10, 0.13, 0.22) * (0.45 + 0.55 * relief);
    o = vec4(mix(dark, lit, f), 1.0);
  } else {
    vec3 dir = normalize(u_earth - P0);
    float c = clearance(P0, dir, 260000.0);
    float f = smoothstep(u_comm - 0.0004, u_comm + 0.0004, c);
    vec3 vis = vec3(0.42, 0.68, 1.0) * (0.35 + 0.65 * relief);
    vec3 dark = vec3(0.08, 0.09, 0.14) * (0.45 + 0.55 * relief);
    o = vec4(mix(dark, vis, f), 1.0);
  }
}`;

// 128 instants keep the time-sampling noise of a 1-year average near ±3 points; one accumulation
// pixel per CSS pixel keeps ridge crests resolved once you zoom in (crests are only ~300 m wide).
const ACC_SAMPLES = 128, ACC_SCALE = 1, ACC_MAX = 900;

export class PolarMap {
  constructor(glCanvas, overlay, note, dem, onPick) {
    this.glCanvas = glCanvas; this.overlay = overlay; this.note = note; this.dem = dem; this.onPick = onPick;
    this.sites = []; this.selected = null; this.sun = null; this.earth = null;
    this.layer = LAYERS.LIVE_SUN; this.obs = 2; this.commRad = 0;
    this.samples = null; this.acc = null; this.best = null;
    this.reset(false);
    this.gl = this.initGL();
    if (!this.gl) this.relief = this.buildReliefFallback();
    let start = null;
    // two-finger pinch zooms about the fingers' midpoint (phones, tablets)
    const pz = pinch(overlay, {
      onPinch: (f, x, y) => {
        const r = overlay.getBoundingClientRect(), mx = x - r.left - r.width / 2, my = y - r.top - r.height / 2;
        const before = { x: this.cx + mx * this.mpp, y: this.cy - my * this.mpp };
        this.mpp = Math.max(10, Math.min(1600, this.mpp / f));
        this.cx = before.x - mx * this.mpp; this.cy = before.y + my * this.mpp; this.userView = true; this.render(true);
      },
      onEnd: () => { this.render(); this.onViewChange?.(); },
    });
    dragger(overlay, {
      gesture: pz,
      onStart: () => { start = { cx: this.cx, cy: this.cy }; },
      onDrag: (dx, dy) => { this.cx = start.cx - dx * this.mpp; this.cy = start.cy + dy * this.mpp; this.userView = true; this.render(true); },
      onEnd: () => { this.render(); this.onViewChange?.(); },
      onClick: e => {
        if (this.best && Math.hypot(e.offsetX - this.best.sx, e.offsetY - this.best.sy) < 14) return this.onPick(this.best.lat, this.best.lon);
        const ll = this.eventLatLon(e); if (ll && this.dem.covers(ll.lat)) this.onPick(ll.lat, ll.lon);
      },
      onHover: e => this.hover(e),
      onLeave: () => { hideTip(); this.onHoverPoint?.(null); },
    });
    // keyboard: arrows pan (Shift = faster), +/− zoom, 0 resets, Enter analyses the spot under the centre crosshair
    overlay.addEventListener('keydown', e => {
      const step = Math.min(this.w || 500, this.h || 500) * (e.shiftKey ? 0.3 : 0.1) * this.mpp;
      const pan = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (pan) { this.cx += pan[0]; this.cy += pan[1]; }
      else if (e.key === '+' || e.key === '=') this.mpp = Math.max(10, this.mpp / 1.25);
      else if (e.key === '-' || e.key === '_') this.mpp = Math.min(1600, this.mpp * 1.25);
      else if (e.key === '0') return this.reset();
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const ll = Dem.toLatLon(this.cx, this.cy);
        if (this.dem.covers(ll.lat)) this.onPick(ll.lat, ll.lon);
        return;
      } else return;
      e.preventDefault(); this.userView = true; this.render(); this.onViewChange?.();
    });
    overlay.addEventListener('focus', () => this.redrawOverlay());
    overlay.addEventListener('blur', () => this.redrawOverlay());
    overlay.addEventListener('wheel', e => {
      e.preventDefault();
      const r = overlay.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const before = { x: this.cx + mx * this.mpp, y: this.cy - my * this.mpp };
      this.mpp = Math.max(10, Math.min(1600, this.mpp * (e.deltaY > 0 ? 1.18 : 1 / 1.18)));
      this.cx = before.x - mx * this.mpp; this.cy = before.y + my * this.mpp; this.userView = true;
      clearTimeout(this._wt); this.render(true); this._wt = setTimeout(() => { this.render(); this.onViewChange?.(); }, 150);
    }, { passive: false });
    new ResizeObserver(() => this.render()).observe(overlay);
    // GPU resets (driver updates, laptops switching GPUs, too many tabs) lose every WebGL resource: rebuild them
    glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.acc = null; this.render(); });
    glCanvas.addEventListener('webglcontextrestored', () => {
      this.lost = false; this.acc = null; this.best = null; this._probe = 0;
      this.gl = this.initGL();
      this.render();
    });
  }

  reset(draw = true) {
    const r = this.overlay.getBoundingClientRect();
    this.cx = 0; this.cy = 0; this.userView = false;
    this.mpp = 2 * 186000 / Math.max(200, Math.min(r.width || 560, r.height || 560));
    if (draw) { this.render(); this.onViewChange?.(); }
  }

  focus(lat, lon) {
    if (!this.dem.covers(lat)) { this.cx = 0; this.cy = 0; return; }       // keep the pole in view
    const p = Dem.toXY(lat, lon);
    const half = Math.min(this.w || 560, this.h || 560) * this.mpp / 2;
    // pan only if the site would be off-screen
    if (Math.abs(p.x - this.cx) > half * 0.9 || Math.abs(p.y - this.cy) > half * 0.9) { this.cx = p.x * 0.6; this.cy = p.y * 0.6; }
  }

  setSites(sites) { this.sites = sites; }
  setSelected(site) { this.selected = site; this.probe = null; }
  /** Landing-ellipse result from core/dispersion.js (touchdown points colored by sunlight), or null. */
  setDispersion(d) { this.disp = d; this.redrawOverlay(); }

  /** Trace one azimuth of the site's horizon (from the panorama cursor): { az, distKm, el } or null. */
  setProbe(p) {
    const same = p && this.probe && Math.abs(p.az - this.probe.az) < 0.05;
    if (same || (!p && !this.probe)) return;
    this.probe = p;
    cancelAnimationFrame(this._ovRaf);
    this._ovRaf = requestAnimationFrame(() => this.redrawOverlay());
  }

  /** Repaint only the 2D overlay (labels, bearings, probe) without re-running the GPU ray-march. */
  redrawOverlay() {
    if (!this.gl || !this.w || !this.overlay.offsetParent) return this.gl ? undefined : this.render();
    const { ctx, w, h } = fitCanvas(this.overlay);
    ctx.clearRect(0, 0, w, h);
    this.drawOverlay(ctx, w, h, this.accumulating && this.acc && this.acc.done < this.acc.total);
  }
  setBodies(sunUnit, earthKm, sunRDeg) { this.sun = sunUnit; this.earth = earthKm; this.sunR = sunRDeg; }
  setLayer(layer) { this.layer = layer; this.render(); }
  setObserverHeight(h) { this.obs = h; }
  setCommMargin(deg) { this.commRad = deg * Math.PI / 180; }
  get accumulating() { return this.layer === LAYERS.SUN_PCT || this.layer === LAYERS.EARTH_PCT; }

  /** Evenly spaced Sun/Earth geometry over the mission window, for the window-average layers. */
  setWindowSamples(win, key) {
    if (this.samples?.key === key) return;
    const sun = [], earth = [], n = Math.min(ACC_SAMPLES, win.n);
    for (let k = 0; k < n; k++) {
      const i = Math.round((k + 0.5) / n * (win.n - 1));
      const s = [win.sun[3 * i], win.sun[3 * i + 1], win.sun[3 * i + 2]], l = Math.hypot(...s);
      sun.push(s.map(v => v / l));
      earth.push([win.earth[3 * i] * 1000, win.earth[3 * i + 1] * 1000, win.earth[3 * i + 2] * 1000]);
    }
    this.samples = { sun, earth, key, t0: win.t[0], t1: win.t[win.n - 1] };
  }

  initGL() {
    const gl = this.glCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const tm = terrainTextureMode(gl);
    this.texMode = tm.hw ? 'hardware' : 'shader';
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, tm.patch(FS)]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.levelTex = this.dem.levels.map((L, i) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, L.n, L.n, 0, gl.RED, gl.FLOAT, L.data);   // full float precision everywhere
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tm.filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tm.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    });
    const U = n => gl.getUniformLocation(prog, n);
    this.u = Object.fromEntries(['u_l0', 'u_l1', 'u_acc', 'u_g0', 'u_g1', 'u_res', 'u_view', 'u_R', 'u_hmax', 'u_sun', 'u_earth', 'u_mode', 'u_sunR', 'u_obs', 'u_comm'].map(n => [n, U(n)]));
    gl.uniform1i(this.u.u_l0, 0); gl.uniform1i(this.u.u_l1, 1); gl.uniform1i(this.u.u_acc, 2);
    const [L0, L1] = this.dem.levels;
    gl.uniform3f(this.u.u_g0, L0.n, L0.scale, L0.off); gl.uniform3f(this.u.u_g1, L1.n, L1.scale, L1.off);
    gl.uniform1f(this.u.u_R, this.dem.R); gl.uniform1f(this.u.u_hmax, this.dem.maxM);
    this.prog = prog;
    return gl;
  }

  // CPU fallback: static relief images per level (used only when WebGL2 is unavailable).
  buildReliefFallback() {
    return this.dem.levels.map(L => {
      const c = document.createElement('canvas'); c.width = L.n; c.height = L.n;
      const g = c.getContext('2d'), img = g.createImageData(L.n, L.n), d = L.data, n = L.n;
      for (let r = 1; r < n - 1; r++) for (let q = 1; q < n - 1; q++) {
        const i = r * n + q, dx = (d[i + 1] - d[i - 1]) / (2 * L.scale), dy = (d[i - n] - d[i + n]) / (2 * L.scale);
        const v = Math.max(0, Math.min(1, 0.55 + (-dx * 0.55 + dy * 0.6) * 1.6)) * 200 + 25;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v * 1.05; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c;
    });
  }

  render(fast = false) {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.draw(fast));
  }

  setCommon(gl, W, H, mpp) {
    gl.viewport(0, 0, W, H);
    gl.uniform2f(this.u.u_res, W, H);
    gl.uniform3f(this.u.u_view, this.cx, this.cy, mpp);
    gl.uniform1f(this.u.u_sunR, (this.sunR ?? 0.267) * Math.PI / 180);
    gl.uniform1f(this.u.u_obs, this.obs);
    gl.uniform1f(this.u.u_comm, this.commRad);
  }

  /** Progressive GPU accumulation of a window-average layer; returns true when complete. */
  accumulate(gl, w, h) {
    const sc = Math.min(ACC_SCALE, ACC_MAX / Math.max(w, h));
    const W = Math.max(32, Math.round(w * sc)), H = Math.max(32, Math.round(h * sc));
    this.accScale = W / w;
    const key = `${this.layer}|${this.samples?.key}|${this.cx.toFixed(0)},${this.cy.toFixed(0)},${this.mpp.toFixed(3)}|${W}x${H}|${this.obs}|${this.commRad}`;
    if (!this.acc || this.acc.key !== key) {
      if (!this.acc || this.acc.W !== W || this.acc.H !== H) {
        if (this.acc) { gl.deleteTexture(this.acc.tex); gl.deleteFramebuffer(this.acc.fbo); }
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        this.acc = { tex, fbo, W, H };
      }
      Object.assign(this.acc, { key, done: 0, total: this.samples.sun.length });
      this.best = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.acc.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    const A = this.acc;
    if (A.done < A.total) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);   // never sample the target we draw into
      this.setCommon(gl, W, H, this.mpp / this.accScale);
      gl.uniform1i(this.u.u_mode, this.layer === LAYERS.SUN_PCT ? 3 : 4);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      // Adaptive batch: grow while frames stay fast, shrink when the GPU pushes back (slow laptops).
      const now = performance.now(), dt = this._lastAcc ? now - this._lastAcc : 16;
      this._lastAcc = now;
      this.batch = Math.max(2, Math.min(48, Math.round((this.batch ?? 6) * (dt < 25 ? 2 : dt > 70 ? 0.5 : 1))));
      for (let k = 0; k < this.batch && A.done < A.total; k++, A.done++) {
        const s = this.samples.sun[A.done], e = this.samples.earth[A.done];
        gl.uniform3f(this.u.u_sun, s[0], s[1], s[2]); gl.uniform3f(this.u.u_earth, e[0], e[1], e[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (A.done >= A.total) { this.findBest(gl); this._lastAcc = 0; }
    }
    return A.done >= A.total;
  }

  /** Brightest (or best-connected) spot in view, read back from the accumulation target. */
  findBest(gl) {
    const A = this.acc, buf = new Float32Array(A.W * A.H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fbo);
    gl.readPixels(0, 0, A.W, A.H, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    A.data = buf;
    let bi = -1, bv = -1;
    for (let i = 0; i < A.W * A.H; i++) { const a = buf[4 * i + 3]; if (a > 0) { const v = buf[4 * i] / a; if (v > bv) { bv = v; bi = i; } } }
    if (bi < 0) return;
    const gx = bi % A.W, gy = Math.floor(bi / A.W);                        // GL origin is bottom-left
    const mx = this.cx + (gx + 0.5 - A.W / 2) * (this.mpp / this.accScale), my = this.cy + (gy + 0.5 - A.H / 2) * (this.mpp / this.accScale);
    const ll = Dem.toLatLon(mx, my);
    this.best = { ...ll, v: bv };
  }

  valueAt(sx, sy) {
    const A = this.acc;
    if (!A?.data || A.done < A.total) return null;
    const gx = Math.floor(sx * A.W / this.w), gy = Math.floor((this.h - sy) * A.H / this.h);
    if (gx < 0 || gy < 0 || gx >= A.W || gy >= A.H) return null;
    const i = gy * A.W + gx, a = A.data[4 * i + 3];
    return a > 0 ? A.data[4 * i] / a : null;
  }

  draw(fast) {
    if (!this.overlay.offsetParent) return;                         // hidden tab: nothing to draw
    const { ctx, w, h } = fitCanvas(this.overlay);
    this.w = w; this.h = h;
    let pending = false;
    if (this.lost) {                                                // between webglcontextlost and ...restored
      ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, w, h);
      this.note.textContent = 'The GPU was reset by the browser — restoring the map…';
      return;
    }
    if (this.gl) {
      // adaptive quality: slow GPUs (laptops) automatically render the ray-marched map at lower resolution
      const gl = this.gl, s = fast ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5) * (this.quality ?? 1);
      const W = Math.round(w * s), H = Math.round(h * s);
      if (this.glCanvas.width !== W || this.glCanvas.height !== H) { this.glCanvas.width = W; this.glCanvas.height = H; }
      let mode = this.layer;
      if (this.accumulating) {
        if (!this.floatTargets || !this.samples) mode = LAYERS.LIVE_SUN;
        else if (fast) mode = LAYERS.RELIEF;                                   // keep panning smooth; recompute after
        else { pending = !this.accumulate(gl, w, h); mode = this.layer === LAYERS.SUN_PCT ? 5 : 6; }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.setCommon(gl, W, H, this.mpp / s);
      const sun = this.sun ?? [0, 0, -1], e = this.earth ?? [384400, 0, 0];
      gl.uniform3f(this.u.u_sun, sun[0], sun[1], sun[2]);
      gl.uniform3f(this.u.u_earth, e[0] * 1000, e[1] * 1000, e[2] * 1000);
      gl.uniform1i(this.u.u_mode, mode);
      if (mode >= 5) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.acc.tex); }
      const t0 = performance.now();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!fast && (this._probe = (this._probe ?? 0) + 1) <= 4 && (mode === 1 || mode === 2)) {   // probe the first live frames
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));                    // waits for the GPU
        const ms = performance.now() - t0;
        if (ms > 60 && (this.quality ?? 1) > 0.5) { this.quality = ms > 150 ? 0.5 : 0.7; this._probe = 0; this.render(); }
      }
    } else {
      ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, w, h);
      [...this.dem.levels].reverse().forEach((L, ri) => {
        const img = this.relief[this.dem.levels.length - 1 - ri];
        const size = L.n * L.scale / this.mpp;
        const x0 = w / 2 + (-L.off * L.scale - 0.5 * L.scale - this.cx) / this.mpp;
        const y0 = h / 2 - (L.off * L.scale + 0.5 * L.scale - this.cy) / this.mpp;
        ctx.drawImage(img, x0, y0, size, size);
      });
    }
    if (this.gl) ctx.clearRect(0, 0, w, h);
    this.drawOverlay(ctx, w, h, pending);
    if (pending) this.render();
  }

  toScreen(lat, lon) {
    const p = Dem.toXY(lat, lon);
    return { x: this.w / 2 + (p.x - this.cx) / this.mpp, y: this.h / 2 - (p.y - this.cy) / this.mpp };
  }

  eventLatLon(e) {
    const r = this.overlay.getBoundingClientRect();
    const x = this.cx + (e.clientX - r.left - r.width / 2) * this.mpp, y = this.cy - (e.clientY - r.top - r.height / 2) * this.mpp;
    return Dem.toLatLon(x, y);
  }

  drawOverlay(ctx, w, h, pending) {
    ctx.save();
    ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif';
    // graticule: latitude circles and meridians
    ctx.strokeStyle = 'rgba(180,195,230,.18)'; ctx.fillStyle = 'rgba(200,210,235,.6)';
    const pole = this.toScreen(-90, 0);
    for (const lat of [-89, -88, -87, -86, -85, -84, -82, -80, -78, -76]) {
      const r = Math.hypot(Dem.toXY(lat, 0).x, Dem.toXY(lat, 0).y) / this.mpp;
      ctx.beginPath(); ctx.arc(pole.x, pole.y, r, 0, 7); ctx.stroke();
      ctx.fillText(`${-lat}°S`, pole.x + 3, pole.y - r - 4);
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const p = this.toScreen(-75, lon);
      ctx.beginPath(); ctx.moveTo(pole.x, pole.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      const q = this.toScreen(-84.6, lon);
      ctx.fillText(lon === 0 ? '0° (toward Earth)' : `${lon}°E`, q.x + 3, q.y);
    }
    // sites: dots always, labels greedily placed (selected first) so they never overlap
    const visible = this.sites.filter(s => this.dem.covers(s.lat)).map(s => ({ s, p: this.toScreen(s.lat, s.lon), sel: this.selected?.id === s.id }))
      .filter(v => v.p.x > -20 && v.p.y > -20 && v.p.x < w + 20 && v.p.y < h + 20)
      .sort((a, b) => b.sel - a.sel);
    const boxes = [];
    for (const { s, p, sel } of visible) {
      ctx.fillStyle = sel ? '#fff' : 'rgba(255,255,255,.85)';
      ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, sel ? 5 : 3.5, 0, 7); ctx.stroke(); ctx.fill();
      ctx.font = sel ? '600 12px system-ui, sans-serif' : '11px system-ui, sans-serif';
      const tw = ctx.measureText(s.name).width;
      const spots = [[p.x + 8, p.y - 7], [p.x + 8, p.y + 9], [p.x - 8 - tw, p.y - 7], [p.x - 8 - tw, p.y + 9]];
      const spot = spots.find(([x, y]) => !boxes.some(b => x < b[2] && x + tw > b[0] && y - 7 < b[3] && y + 7 > b[1]));
      if (!spot) continue;
      boxes.push([spot[0] - 2, spot[1] - 8, spot[0] + tw + 2, spot[1] + 8]);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,13,.85)';
      ctx.strokeText(s.name, spot[0], spot[1]); ctx.fillText(s.name, spot[0], spot[1]);
    }
    // selected site: ring + bearings to Sun and Earth
    if (this.selected && this.dem.covers(this.selected.lat)) {
      const p = this.toScreen(this.selected.lat, this.selected.lon);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke();
      if (!this.accumulating) {
        const bearing = (az, len, color, label) => {
          if (az == null) return;
          // azimuth is measured from local north = away from the pole along the meridian
          const lat = this.selected.lat * Math.PI / 180;
          const n = Dem.toXY(this.selected.lat + 0.05, this.selected.lon), c = Dem.toXY(this.selected.lat, this.selected.lon);
          const e = Dem.toXY(this.selected.lat, this.selected.lon + 0.05 / Math.max(0.01, Math.cos(lat)));
          const nv = norm(n.x - c.x, n.y - c.y), ev = norm(e.x - c.x, e.y - c.y);
          const a = az * Math.PI / 180, vx = Math.cos(a) * nv[0] + Math.sin(a) * ev[0], vy = Math.cos(a) * nv[1] + Math.sin(a) * ev[1];
          ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
          const x1 = p.x + vx * len, y1 = p.y - vy * len;
          ctx.beginPath(); ctx.moveTo(p.x + vx * 13, p.y - vy * 13); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.beginPath(); ctx.arc(x1, y1, 4, 0, 7); ctx.fill();
          ctx.font = '11px system-ui, sans-serif'; ctx.fillText(label, x1 + 6, y1 + 4);
        };
        bearing(this.sunAz, 60, COLORS.sun, 'Sun');
        bearing(this.earthAz, 44, COLORS.earth, 'Earth');
      }
      // landing ellipse: every touchdown point colored by its sunlight over the window
      if (this.disp) {
        const d = this.disp, rPx = d.rKm * 1000 / this.mpp, dot = Math.max(3, Math.min(7, rPx * 0.13));
        ctx.save();
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p.x, p.y, rPx, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        for (const q of d.pts) {
          const v = this.toScreen(q.lat, q.lon);
          ctx.fillStyle = sunRamp(q.M.sunPct / 100); ctx.strokeStyle = q === d.best ? '#ffffff' : q === d.worst ? COLORS.bad : 'rgba(5,7,13,.9)';
          ctx.lineWidth = q === d.best || q === d.worst ? 2.5 : 1.5;
          ctx.beginPath(); ctx.arc(v.x, v.y, q.target ? dot + 1 : dot, 0, 7); ctx.fill(); ctx.stroke();
        }
        const lab = `Landing ellipse ±${d.rKm < 1 ? `${(d.rKm * 1000).toFixed(0)} m` : `${d.rKm} km`}: sunlight ${d.sun[0].toFixed(0)}–${d.sun[1].toFixed(0)}%`;
        ctx.font = '600 12px system-ui, sans-serif';
        const tw = ctx.measureText(lab).width, lx = Math.max(6, Math.min(w - tw - 6, p.x - tw / 2)), ly = Math.max(16, p.y - rPx - 10);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,13,.9)'; ctx.fillStyle = '#fff';
        ctx.strokeText(lab, lx, ly); ctx.fillText(lab, lx, ly);
        ctx.restore();
      }
      // horizon probe: the great circle from the site to the terrain that sets the horizon at this azimuth
      if (this.probe) {
        const { az, distKm, el } = this.probe, s = this.selected, N = 48;
        ctx.save();
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(5,7,13,.65)';
        const path = () => { ctx.beginPath(); for (let k = 0; k <= N; k++) { const q = destination(s.lat, s.lon, az, distKm * k / N), v = this.toScreen(q.lat, q.lon); k ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); } };
        path(); ctx.stroke();
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#ffffff'; ctx.setLineDash([6, 4]); path(); ctx.stroke(); ctx.setLineDash([]);
        const end = destination(s.lat, s.lon, az, distKm), q = this.toScreen(end.lat, end.lon);
        const ex = Math.max(10, Math.min(w - 10, q.x)), ey = Math.max(10, Math.min(h - 10, q.y));
        ctx.fillStyle = COLORS.sun; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ex, ey, 6, 0, 7); ctx.stroke(); ctx.fill();
        const text = `Horizon at ${az.toFixed(0)}°: ${fmtDeg(el)}, set by this terrain ${distKm.toFixed(distKm < 10 ? 1 : 0)} km away`;
        ctx.font = '600 12px system-ui, sans-serif';
        const tw = ctx.measureText(text).width, lx = Math.max(6, Math.min(w - tw - 6, ex + 10)), ly = ey < 40 ? ey + 20 : ey - 12;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,13,.9)'; ctx.fillStyle = '#fff';
        ctx.strokeText(text, lx, ly); ctx.fillText(text, lx, ly);
        ctx.restore();
      }
    }
    // best spot in view (window-average layers)
    if (this.accumulating && this.best && !pending) {
      const p = this.toScreen(this.best.lat, this.best.lon);
      this.best.sx = p.x; this.best.sy = p.y;
      star(ctx, p.x, p.y, 9, '#ffffff');
      const label = `Best in view: ${(this.best.v * 100).toFixed(0)}% — click`;
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width, lx = Math.min(w - tw - 8, p.x + 12);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,13,.9)'; ctx.fillStyle = '#fff';
      ctx.strokeText(label, lx, p.y + 4); ctx.fillText(label, lx, p.y + 4);
    }
    // legend for window-average layers
    if (this.accumulating) {
      const isSun = this.layer === LAYERS.SUN_PCT, x0 = 12, y0 = 12, bw = 150;
      const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
      (isSun ? ['#08051a', '#520f6e', '#ba3654', '#fa8c0a', '#fcf59e'] : ['#08081a', '#172661', '#1a61a8', '#4dadeb', '#d1f5ff']).forEach((c, i) => g.addColorStop(i / 4, c));
      const pxKm = this.mpp / (this.accScale || 1) / 1000;
      ctx.fillStyle = 'rgba(5,7,13,.78)'; ctx.fillRect(x0 - 6, y0 - 6, bw + 12, 54);
      ctx.fillStyle = g; ctx.fillRect(x0, y0 + 14, bw, 8);
      ctx.fillStyle = '#e6ebf5'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(isSun ? 'Sunlight over mission window' : 'Earth in view over window', x0, y0 + 6);
      ctx.fillStyle = '#8a96b2'; ctx.fillText('0%', x0, y0 + 32); ctx.textAlign = 'right'; ctx.fillText('100%', x0 + bw, y0 + 32);
      ctx.textAlign = 'left'; ctx.fillText(`pixel ≈ ${pxKm < 1 ? `${(pxKm * 1000).toFixed(0)} m` : `${pxKm.toFixed(1)} km`}${pxKm > 0.25 ? ' · zoom in for ridges' : ''}`, x0, y0 + 44);
    }
    // keyboard focus: crosshair marks the spot Enter would analyse
    if (this.overlay.matches(':focus-visible')) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(w / 2 - 10, h / 2); ctx.lineTo(w / 2 + 10, h / 2); ctx.moveTo(w / 2, h / 2 - 10); ctx.lineTo(w / 2, h / 2 + 10); ctx.stroke();
    }
    // scale bar
    const km = niceKm(this.mpp * 120 / 1000), len = km * 1000 / this.mpp;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillRect(w - 16 - len, h - 18, len, 3);
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`${km} km`, w - 16, h - 24);
    ctx.restore();
    const A = this.acc;
    const modeText = !this.gl ? 'Static relief (WebGL2 unavailable)'
      : this.accumulating && !this.floatTargets ? 'Window-average layers need float render targets (not available on this GPU) — showing live sunlight'
      : this.accumulating && pending ? `Computing ${this.layer === LAYERS.SUN_PCT ? 'sunlight' : 'Earth visibility'} over the mission window on the GPU… ${A ? A.done : 0}/${A ? A.total : ACC_SAMPLES}`
      : this.layer === LAYERS.SUN_PCT ? `Average sunlight over the mission window (${A?.total ?? ACC_SAMPLES} instants, GPU) · hover for %`
      : this.layer === LAYERS.EARTH_PCT ? `Share of the window with Earth in view (${A?.total ?? ACC_SAMPLES} instants, GPU) · hover for %`
      : this.layer === LAYERS.LIVE_SUN ? 'Live sunlight: every pixel ray-marched toward the Sun'
      : this.layer === LAYERS.LIVE_EARTH ? 'Live Earth visibility: blue = direct-to-Earth line of sight' : 'Shaded relief';
    const outside = this.selected && !this.dem.covers(this.selected.lat);
    this.note.textContent = outside
      ? `${this.selected.name} is outside the 75°S–90°S LOLA terrain model — its horizon is treated as a smooth sphere`
      : `${modeText} · scroll to zoom, drag to pan, click to pick a site`;
  }

  setBearings(sunAz, earthAz) { this.sunAz = sunAz; this.earthAz = earthAz; }

  hover(e) {
    const ll = this.eventLatLon(e);
    if (!ll || !this.dem.covers(ll.lat)) { this.onHoverPoint?.(null); return hideTip(); }
    const h = this.dem.heightAt(ll.lat, ll.lon);
    const r = this.overlay.getBoundingClientRect();
    const v = this.accumulating ? this.valueAt(e.clientX - r.left, e.clientY - r.top) : null;
    const pct = v == null ? '' : `<br>${this.layer === LAYERS.SUN_PCT ? 'Sunlight' : 'Earth in view'} over window <b>${(v * 100).toFixed(0)}%</b>`;
    const seen = this.onHoverPoint?.({ ...ll, h }) ?? '';                // where this spot sits in the selected site's sky
    showTip(`${fmtLat(ll.lat)}, ${fmtLon(ll.lon)}<br>Elevation <b>${h.toFixed(0)} m</b>${pct}${seen}<br><span style="color:#8a96b2">click to analyse this spot</span>`, e.clientX, e.clientY);
  }
}

function star(ctx, x, y, r, color) {
  ctx.save(); ctx.translate(x, y); ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fillStyle = color; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill(); ctx.restore();
}
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
// same 5 stops as the GPU 'inferno' ramp used by the sunlight-% layer
const INFERNO = [[8, 5, 26], [82, 15, 110], [186, 54, 84], [250, 140, 10], [252, 245, 158]];
function sunRamp(v) {
  const x = Math.max(0, Math.min(1, v)) * 4, i = Math.min(3, Math.floor(x)), f = x - i, a = INFERNO[i], b = INFERNO[i + 1];
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * f)).join(',')})`;
}
function niceKm(x) { for (const v of [1, 2, 5, 10, 20, 25, 50, 100, 200]) if (v >= x) return v; return 500; }
