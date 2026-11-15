// 3D surface view: LOLA terrain around the site, lit by the real Sun with ray-marched shadows
// (same GLSL as the 2D map), the far skyline from the horizon mask, and a physically placed sky:
// true-size Sun, Earth with its real phase, stars. Orbit mode or "eye level" (astronaut's view).
import { TERRAIN_GLSL, terrainTextureMode } from './map.js';
import { Dem } from '../core/dem.js';
import { fitCanvas, dragger, pinch, COLORS } from './util.js';

const D2R = Math.PI / 180, R_KM = 1737.4;
const HALF_KM = 24, STEP_KM = 0.24, RING_KM = 36;

// ---------- shaders ----------
const SKY_VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.9999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform vec3 u_camR, u_camU, u_camF; uniform float u_tanHalf;
uniform vec3 u_sunDir, u_earthDir; uniform float u_sunR, u_earthR;
out vec4 o;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main(){
  vec2 ndc = gl_FragCoord.xy / u_res * 2.0 - 1.0;
  vec3 d = normalize(u_camF + ndc.x * (u_res.x / u_res.y) * u_tanHalf * u_camR + ndc.y * u_tanHalf * u_camU);
  vec3 col = vec3(0.0);
  vec3 q = floor(d * 420.0); float h = hash(q);
  if (h > 0.9986) col += vec3(0.55 + 0.45 * fract(h * 37.0)) * (0.5 + 0.5 * fract(h * 91.0));
  float as = acos(clamp(dot(d, u_sunDir), -1.0, 1.0));
  col += vec3(1.0, 0.86, 0.62) * 0.22 * exp(-as / (u_sunR * 7.0));
  if (as < u_sunR) col = vec3(4.0, 3.8, 3.4);
  float ae = acos(clamp(dot(d, u_earthDir), -1.0, 1.0));
  if (ae < u_earthR) {
    vec3 t = normalize(d - u_earthDir * dot(d, u_earthDir) + 1e-6);
    float s = clamp(sin(ae) / sin(u_earthR), 0.0, 1.0);
    vec3 n = t * s - u_earthDir * sqrt(1.0 - s * s);              // surface normal facing us
    float lam = dot(n, u_sunDir);
    float cloud = smoothstep(0.55, 0.8, noise(n * 6.0 + 3.1) * 0.65 + noise(n * 17.0) * 0.35);
    float land = smoothstep(0.58, 0.66, noise(n * 2.3 + 11.0));
    vec3 surf = mix(mix(vec3(0.05, 0.16, 0.45), vec3(0.32, 0.36, 0.2), land), vec3(0.95), cloud);
    col = surf * max(0.0, lam) * 1.6 + vec3(0.2, 0.4, 1.0) * pow(s, 8.0) * max(0.0, lam + 0.25) * 0.6 + vec3(0.004, 0.006, 0.012);
  }
  o = vec4(col / (1.0 + col), 1.0);
}`;

const TER_VS = `#version 300 es
in vec3 a_pos; in vec2 a_grad; in vec2 a_map;
uniform mat4 u_mvp; uniform float u_ve;
out vec3 v_n; out vec2 v_map; out float v_dist;
void main(){
  vec3 p = vec3(a_pos.xy, a_pos.z * u_ve);
  gl_Position = u_mvp * vec4(p, 1.0);
  v_n = normalize(vec3(-u_ve * a_grad.x, -u_ve * a_grad.y, 1.0));
  v_map = a_map; v_dist = length(a_pos.xy);
}`;
const TER_FS = `#version 300 es
precision highp float;
${TERRAIN_GLSL}
uniform vec3 u_sunMF, u_sunDir; uniform float u_sunR, u_terrain, u_hiSite;
in vec3 v_n; in vec2 v_map; in float v_dist;
out vec4 o;
void main(){
  if (u_hiSite > 0.5 && v_dist > ${(HALF_KM * 0.985).toFixed(2)}) discard;   // round 'island' in orbit view
  float f = 1.0;
  if (u_terrain > 0.5) {
    bool ok; float h = height(v_map, ok);
    vec3 P0 = unitFromMap(v_map) * (u_R + h + 1.5);
    f = ok ? diskFrac(clearance(P0, u_sunMF, 240000.0) / u_sunR) : 1.0;
  } else f = clamp((asin(clamp(u_sunDir.z, -1.0, 1.0)) + u_sunR) / (2.0 * u_sunR), 0.0, 1.0);
  vec3 nn = normalize(v_n);
  float lam = max(0.0, dot(nn, u_sunDir));
  float grain = 0.88 + 0.24 * fract(sin(dot(floor(v_map / 60.0), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 albedo = vec3(0.62, 0.60, 0.57) * grain;
  vec3 lit = albedo * (0.42 + 2.6 * lam) * f;                       // lit ground reads as lit even under grazing light
  vec3 col = lit + albedo * (0.035 + 0.03 * nn.z);                  // faint fill (earthshine, scattered light)
  col = pow(col / (1.0 + col), vec3(0.8));
  col = mix(col, vec3(0.02, 0.025, 0.04), smoothstep(${(HALF_KM * 0.8).toFixed(1)}, ${(HALF_KM * 1.42).toFixed(1)}, v_dist) * 0.35);
  float ring = u_hiSite * (1.0 - smoothstep(0.0, 0.25, v_dist));    // site marker glow
  o = vec4(col + vec3(0.9, 0.9, 1.0) * ring * 0.6, 1.0);
}`;

const RING_VS = `#version 300 es
in vec3 a_pos; uniform mat4 u_mvp; uniform float u_ve; out float v_top;
void main(){ gl_Position = u_mvp * vec4(a_pos.xy, a_pos.z * u_ve, 1.0); v_top = float(gl_VertexID % 2); }`;
const RING_FS = `#version 300 es
precision highp float; in float v_top; out vec4 o;
void main(){ o = vec4(mix(vec3(0.015, 0.018, 0.03), vec3(0.11, 0.115, 0.13), v_top), 1.0); }`;

// ---------- small matrix helpers (column-major) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, f, up) {               // f = unit forward
  const r = norm(cross(f, up)), u = cross(r, f);
  return { m: [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1], r, u, f };
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const dirENU = (az, el) => [Math.cos(el * D2R) * Math.sin(az * D2R), Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R)];

export class Surface3D {
  constructor(canvas, overlay, dem) {
    this.canvas = canvas; this.overlay = overlay; this.dem = dem;
    this.mode = 'orbit'; this.ve = 2; this.yaw = 0; this.pitch = 22; this.dist = 38; this.fov = 55;
    this.eyeYaw = 0; this.eyePitch = 2;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) return;
    this.sky = this.program(SKY_VS, SKY_FS);
    const tm = terrainTextureMode(gl);
    this.ter = this.program(TER_VS, tm.patch(TER_FS));
    this.ringP = this.program(RING_VS, RING_FS);
    if (!this.sky || !this.ter || !this.ringP) { this.gl = null; return; }
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // DEM textures for the shadow ray-march (same pyramid as the 2D map)
    gl.useProgram(this.ter.p);
    dem.levels.forEach((L, i) => {
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, L.n, L.n, 0, gl.RED, gl.FLOAT, L.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tm.filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tm.filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    });
    const [L0, L1] = dem.levels, U = n => gl.getUniformLocation(this.ter.p, n);
    gl.uniform1i(U('u_l0'), 0); gl.uniform1i(U('u_l1'), 1);
    gl.uniform3f(U('u_g0'), L0.n, L0.scale, L0.off); gl.uniform3f(U('u_g1'), L1.n, L1.scale, L1.off);
    gl.uniform1f(U('u_R'), dem.R); gl.uniform1f(U('u_hmax'), dem.maxM);
    // interaction
    let s0 = null;
    const pz = pinch(overlay, {                                         // two fingers: orbit distance / eye zoom
      onPinch: f => {
        if (this.mode === 'orbit') this.dist = Math.max(2, Math.min(90, this.dist / f));
        else this.fov = Math.max(5, Math.min(90, this.fov / f));
        this.render();
      },
    });
    dragger(overlay, {
      gesture: pz,
      onStart: () => { s0 = { yaw: this.yaw, pitch: this.pitch, eyeYaw: this.eyeYaw, eyePitch: this.eyePitch }; },
      onDrag: (dx, dy) => {
        if (this.mode === 'orbit') { this.yaw = s0.yaw - dx * 0.35; this.pitch = Math.max(3, Math.min(85, s0.pitch + dy * 0.25)); }
        else { this.eyeYaw = s0.eyeYaw - dx * this.fov / this.w; this.eyePitch = Math.max(-20, Math.min(60, s0.eyePitch + dy * this.fov / this.h)); }
        this.render();
      },
    });
    overlay.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.mode === 'orbit') this.dist = Math.max(2, Math.min(90, this.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
      else this.fov = Math.max(5, Math.min(90, this.fov * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      this.render();
    }, { passive: false });
    new ResizeObserver(() => this.render()).observe(overlay);
  }

  program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
    const u = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = gl.getUniformLocation(p, n))) });
    return { p, u };
  }

  /** Build the terrain mesh (±24 km at 240 m) and the far-skyline ring for a site. */
  setSite(site, hz, obsM) {
    if (!this.gl) return;
    const key = `${site.lat},${site.lon},${obsM}`;
    this.obsM = obsM; this.hz = hz; this.site = site;
    this.terrain = hz.terrain;
    if (this.meshKey === key) return;
    this.meshKey = key;
    const gl = this.gl, n = Math.round(2 * HALF_KM / STEP_KM) + 1;
    const c = Dem.toXY(site.lat, site.lon);
    // local east / north unit vectors in the map plane (polar stereographic is conformal, scale ≈ 1 here)
    const cl = Math.max(0.01, Math.cos(site.lat * D2R));
    const pn = Dem.toXY(site.lat + 0.01, site.lon), pe = Dem.toXY(site.lat, site.lon + 0.01 / cl);
    const nv = norm([pn.x - c.x, pn.y - c.y, 0]), ev = norm([pe.x - c.x, pe.y - c.y, 0]);
    const ground = this.terrain ? hz.groundM : 0;
    const Z = new Float32Array(n * n), MX = new Float32Array(n * n), MY = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -HALF_KM + i * STEP_KM, y = -HALF_KM + j * STEP_KM, k = j * n + i;
      const mx = c.x + (x * ev[0] + y * nv[0]) * 1000, my = c.y + (x * ev[1] + y * nv[1]) * 1000;
      let h = this.terrain ? this.dem.heightAtMap(mx, my) : ground;
      if (!(h === h)) h = ground;
      Z[k] = (h - ground) / 1000 - (x * x + y * y) / (2 * R_KM);    // includes the curvature drop
      MX[k] = mx; MY[k] = my;
    }
    const data = new Float32Array(n * n * 7);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, o = k * 7;
      const gx = (Z[j * n + Math.min(n - 1, i + 1)] - Z[j * n + Math.max(0, i - 1)]) / (STEP_KM * (Math.min(n - 1, i + 1) - Math.max(0, i - 1)));
      const gy = (Z[Math.min(n - 1, j + 1) * n + i] - Z[Math.max(0, j - 1) * n + i]) / (STEP_KM * (Math.min(n - 1, j + 1) - Math.max(0, j - 1)));
      data.set([-HALF_KM + i * STEP_KM, -HALF_KM + j * STEP_KM, Z[k], gx, gy, MX[k], MY[k]], o);
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx.set([a, b, d, b, e, d], q); q += 6;
    }
    if (this.mesh) { gl.deleteBuffer(this.mesh.vb); gl.deleteBuffer(this.mesh.ib); gl.deleteVertexArray(this.mesh.vao); }
    if (this.ring) { gl.deleteBuffer(this.ring.rb); gl.deleteVertexArray(this.ring.vao); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = name => gl.getAttribLocation(this.ter.p, name);
    [['a_pos', 3, 0], ['a_grad', 2, 3], ['a_map', 2, 5]].forEach(([nm, size, off]) => { const l = loc(nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 28, off * 4); });
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.mesh = { vao, vb, ib, count: idx.length };
    // far skyline: the horizon mask as a backdrop ring (what lies beyond the mesh)
    const nAz = hz.nAz, ring = new Float32Array((nAz + 1) * 6);
    for (let k = 0; k <= nAz; k++) {
      const az = (k % nAz) / nAz * 2 * Math.PI, el = this.terrain ? hz.mask[k % nAz] * D2R : 0;
      const x = RING_KM * Math.sin(az), y = RING_KM * Math.cos(az);
      ring.set([x, y, -4, x, y, RING_KM * Math.tan(el) + obsM / 1000], k * 6);
    }
    const rvao = gl.createVertexArray(); gl.bindVertexArray(rvao);
    const rb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, rb); gl.bufferData(gl.ARRAY_BUFFER, ring, gl.STATIC_DRAW);
    const rl = gl.getAttribLocation(this.ringP.p, 'a_pos'); gl.enableVertexAttribArray(rl); gl.vertexAttribPointer(rl, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.ring = { vao: rvao, rb, count: (nAz + 1) * 2 };
  }

  /** b = { sunAz, sunEl, earthAz, earthEl, sunR, earthR (deg), sunMF (Moon-fixed unit vector) } */
  setBodies(b) { this.b = b; }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'eye' && this.b) { this.eyeYaw = this.b.sunAz; this.eyePitch = 0.6; this.fov = 24; }
    if (mode === 'orbit' && this.b) { this.yaw = this.b.sunAz + 135; this.pitch = 26; this.dist = 34; }
    this.render();
  }
  lookAt(target) {
    if (!this.b) return;
    const earth = target === 'earth';
    this.eyeYaw = earth ? this.b.earthAz : this.b.sunAz;
    if (earth) { this.fov = Math.min(this.fov, 8); this.eyePitch = Math.max(-20, Math.min(60, this.b.earthEl - 2.5)); }   // antennas readable, skyline in frame
    this.render();
  }
  setExaggeration(ve) { this.ve = ve; this.render(); }

  render() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.draw());
  }

  draw() {
    if (!this.overlay.offsetParent) return;                         // hidden: skip the GPU work
    const gl = this.gl;
    const { ctx, w, h } = fitCanvas(this.overlay);
    this.w = w; this.h = h;
    ctx.clearRect(0, 0, w, h);                                       // labels are redrawn every frame
    if (!gl || !this.mesh || !this.b) { ctx.fillStyle = '#8a96b2'; ctx.fillText(gl ? 'Loading 3D…' : '3D view needs WebGL2', 12, 20); return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (this.quality ?? 1), W = Math.round(w * dpr), H = Math.round(h * dpr);
    const t0 = performance.now();
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    const b = this.b, ve = this.mode === 'eye' ? 1 : this.ve;
    let eye, fwd;
    if (this.mode === 'orbit') {
      const yr = this.yaw * D2R, pr = this.pitch * D2R;
      eye = [this.dist * Math.cos(pr) * Math.sin(yr), this.dist * Math.cos(pr) * Math.cos(yr), this.dist * Math.sin(pr)];
      fwd = norm(eye.map(v => -v));
    } else {
      eye = [0, 0, (this.obsM + 1.8) / 1000];
      fwd = dirENU(this.eyeYaw, this.eyePitch);
    }
    const fov = (this.mode === 'eye' ? this.fov : 50) * D2R;
    const view = lookAt(eye, fwd, [0, 0, 1]);
    const proj = perspective(fov, W / H, this.mode === 'eye' ? 0.0005 : 0.05, 400);
    const mvp = mul(proj, view.m);
    const sunDir = dirENU(b.sunAz, b.sunEl), earthDir = dirENU(b.earthAz, b.earthEl);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const sl = gl.getAttribLocation(this.sky.p, 'p'); gl.enableVertexAttribArray(sl); gl.vertexAttribPointer(sl, 2, gl.FLOAT, false, 0, 0);
    const su = this.sky.u;
    gl.uniform2f(su.u_res, W, H); gl.uniform3fv(su.u_camR, view.r); gl.uniform3fv(su.u_camU, view.u); gl.uniform3fv(su.u_camF, view.f);
    gl.uniform1f(su.u_tanHalf, Math.tan(fov / 2)); gl.uniform3fv(su.u_sunDir, sunDir); gl.uniform3fv(su.u_earthDir, earthDir);
    gl.uniform1f(su.u_sunR, b.sunR * D2R); gl.uniform1f(su.u_earthR, b.earthR * D2R);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(sl);
    // skyline ring + terrain
    gl.enable(gl.DEPTH_TEST);
    if (this.mode === 'eye') {
      gl.useProgram(this.ringP.p);
      gl.uniformMatrix4fv(this.ringP.u.u_mvp, false, mvp); gl.uniform1f(this.ringP.u.u_ve, ve);
      gl.bindVertexArray(this.ring.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ring.count);
    }
    gl.useProgram(this.ter.p);
    const tu = this.ter.u;
    gl.uniformMatrix4fv(tu.u_mvp, false, mvp); gl.uniform1f(tu.u_ve, ve);
    gl.uniform3fv(tu.u_sunMF, b.sunMF); gl.uniform3fv(tu.u_sunDir, sunDir);
    gl.uniform1f(tu.u_sunR, b.sunR * D2R); gl.uniform1f(tu.u_terrain, this.terrain ? 1 : 0); gl.uniform1f(tu.u_hiSite, this.mode === 'orbit' ? 1 : 0);
    gl.bindVertexArray(this.mesh.vao); gl.drawElements(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    if ((this._probe = (this._probe ?? 0) + 1) <= 3) {                     // adaptive quality for slow GPUs
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      const ms = performance.now() - t0;
      if (ms > 70 && (this.quality ?? 1) > 0.5) { this.quality = ms > 160 ? 0.5 : 0.7; this._probe = 0; }
    }
    this.drawLabels(ctx, w, h, mvp, sunDir, earthDir);
  }

  drawLabels(ctx, w, h, mvp, sunDir, earthDir) {
    const proj = (v, wv) => {
      const x = mvp[0] * v[0] + mvp[4] * v[1] + mvp[8] * v[2] + mvp[12] * wv, y = mvp[1] * v[0] + mvp[5] * v[1] + mvp[9] * v[2] + mvp[13] * wv;
      const ww = mvp[3] * v[0] + mvp[7] * v[1] + mvp[11] * v[2] + mvp[15] * wv;
      if (ww <= 0) return null;
      return { x: (x / ww * 0.5 + 0.5) * w, y: (1 - (y / ww * 0.5 + 0.5)) * h };
    };
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const tag = (p, text, color, dy = -16) => {
      if (!p || p.x < 0 || p.x > w || p.y < 0 || p.y > h) return;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(5,7,13,.7)'; ctx.fillRect(p.x - tw / 2 - 4, p.y + dy - 9, tw + 8, 18);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, p.x, p.y + dy);
    };
    const b = this.b, pxPerDeg = h / (this.mode === 'eye' ? this.fov : 50);   // keep labels clear of the true-size disks
    tag(proj(sunDir, 0), `Sun ${b.sunEl >= 0 ? '+' : ''}${b.sunEl.toFixed(2)}°`, COLORS.sun, -Math.max(22, b.sunR * pxPerDeg + 16));
    tag(proj(earthDir, 0), `Earth ${b.earthEl >= 0 ? '+' : ''}${b.earthEl.toFixed(1)}°`, COLORS.earth, -Math.max(26, b.earthR * pxPerDeg + 16));
    // DSN antennas on Earth's disk (only those on the hemisphere facing the Moon), once the disk is big enough to read
    if (this.mode === 'eye' && b.dsn && b.earthR * pxPerDeg >= 18) {
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
      for (const st of b.dsn) {
        if (st.moonEl < 0) continue;                                          // on the far side of Earth
        const p = proj(dirENU(st.az, st.el), 0);
        if (!p || p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
        const color = st.link ? COLORS.both : st.moonEl >= 10 ? COLORS.bad : '#8a96b2';
        ctx.fillStyle = color; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.stroke(); ctx.fill();
        const text = `${st.name} ${st.link ? '· link' : st.moonEl >= 10 ? '· behind lunar terrain' : '· Moon below 10°'}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(5,7,13,.72)'; ctx.fillRect(p.x + 7, p.y - 8, tw + 6, 16);
        ctx.fillStyle = color; ctx.fillText(text, p.x + 10, p.y + 1);
      }
    }
    for (const [az, lab] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) tag(proj(dirENU(az, this.mode === 'eye' ? -0.6 : -6), 0), lab, '#c3cbe0', 0);
    if (this.mode === 'orbit') tag(proj([0, 0, 0.05], 1), this.site?.name ?? 'Site', '#ffffff', -14);
    ctx.textAlign = 'right'; ctx.fillStyle = '#8a96b2';
    ctx.fillText(this.mode === 'eye' ? `eye level, ${this.obsM} m + 1.8 m · FOV ${this.fov.toFixed(0)}° · drag to look, scroll to zoom` :
      `±${HALF_KM} km of LOLA terrain · vertical ×${this.ve} · drag to orbit, scroll to zoom`, w - 8, h - 12);
  }
}
