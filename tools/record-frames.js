// Dev tool: render the hero animation frames inside the running app and POST them to tools/serve.py.
// Paste into the browser console on http://127.0.0.1:8787/#site=c1&start=2027-03-01T00:00&days=29.53&h=2
// (or run via automation), then: node tools/make-webp-anim.mjs docs/_frames docs/penumbra-hero.webp
(async () => {
  const P = window.penumbra, map = P.map, N = 72, W = 800, H = 600;
  const S0 = P.current.S, t0 = S0.t[0], t1 = S0.t[S0.n - 1];
  // zoomed map around Shackleton & the Connecting Ridge
  Object.assign(map, { cx: -4000, cy: -2500, mpp: 105, userView: true });
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  const pano = document.getElementById('panorama'), mapGL = document.getElementById('map-gl'), mapOv = document.getElementById('map');
  for (let k = 0; k < N; k++) {
    P.setTime(t0 + (t1 - t0) * k / N);
    map.draw(false);                                   // synchronous: works even when the tab is hidden
    const S = P.current.S, M = P.current.M, i = M.now.i;
    g.fillStyle = '#05070d'; g.fillRect(0, 0, W, H);
    // map (square crop, top) — GL layer + overlay labels
    const side = 420, mx = (W - side) / 2;
    g.drawImage(mapGL, mx, 8, side, side); g.drawImage(mapOv, mx, 8, side, side);
    // panorama strip (bottom)
    g.drawImage(pano, 0, 0, pano.width, pano.height, 8, side + 16, W - 16, H - side - 24);
    // captions
    g.font = '600 20px Segoe UI, system-ui, sans-serif'; g.fillStyle = '#e6ebf5'; g.textBaseline = 'top';
    g.fillText('Penumbra', 14, 14);
    g.font = '13px Segoe UI, system-ui, sans-serif'; g.fillStyle = '#8a96b2';
    g.fillText('Lunar south pole · one lunar day', 14, 40);
    g.fillText('NASA LOLA terrain, ray-traced live', 14, 58);
    const d = new Date(S.t[i]);
    g.font = '15px Consolas, monospace'; g.fillStyle = '#e6ebf5';
    g.fillText(d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', W - 214, 14);
    g.fillStyle = '#ffc24b'; g.fillText(`Sun   ${S.sunEl[i] >= 0 ? '+' : ''}${S.sunEl[i].toFixed(2)}°  ${S.sunFrac[i] >= 0.5 ? 'lit' : 'dark'}`, W - 214, 36);
    g.fillStyle = '#4da3ff'; g.fillText(`Earth ${S.earthEl[i] >= 0 ? '+' : ''}${S.earthEl[i].toFixed(1)}°  ${S.earthVis[i] ? 'in view' : 'hidden'}`, W - 214, 56);
    const blob = await new Promise(r => out.toBlob(r, 'image/webp', 0.78));
    await fetch(`/__save/frame-${String(k).padStart(3, '0')}.webp`, { method: 'POST', body: blob });
  }
  return `saved ${N} frames`;
})();
