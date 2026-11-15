// GPU window-average maps vs the CPU horizon engine, like for like.
// Paste into the browser console on a running Penumbra page (python tools/serve.py 8787 .).
// For every terrain-modelled site it accumulates the one-year Sunlight-% and Earth-in-view-% maps on the GPU
// (the same 128 instants the app uses), reads the pixel at the site, and evaluates the CPU engine
// (core/horizon.js + core/analysis.js) at that exact pixel centre with the same 128 instants.
// Result for data/validation.json -> checks[id = "gpu"].
(async () => {
  const eph = await import('/js/core/ephemeris.js');
  const ana = await import('/js/core/analysis.js');
  const hzm = await import('/js/core/horizon.js');
  const { Dem } = await import('/js/core/dem.js');
  const map = window.penumbra.map, dem = map.dem;
  const t0 = Date.UTC(2027, 0, 1), win = eph.sampleWindow(t0, t0 + 365.25 * 864e5, 60);
  const n = 128, idx = [...Array(n)].map((_, k) => Math.round((k + 0.5) / n * (win.n - 1)));     // = PolarMap.setWindowSamples
  const sub = { n, stepMin: 60, t: Float64Array.from(idx.map(i => win.t[i])), sun: new Float64Array(n * 3), earth: new Float64Array(n * 3) };
  idx.forEach((i, k) => { sub.sun.set(win.sun.subarray(3 * i, 3 * i + 3), 3 * k); sub.earth.set(win.earth.subarray(3 * i, 3 * i + 3), 3 * k); });
  map.setWindowSamples(win, `validation|${t0}`); map.setObserverHeight(2); map.setCommMargin(0); map.setDispersion(null);
  const cpu = (lat, lon) => {
    const hz = hzm.computeHorizon(dem, lat, lon, 2, 720);
    const S = ana.analyzeSeries(sub, eph.siteFrame(lat, lon, hz.siteM), hz.mask, {});
    let s = 0, e = 0; for (let i = 0; i < n; i++) { s += S.sunFrac[i]; e += S.earthVis[i]; }
    return [100 * s / n, 100 * e / n];
  };
  const gpuAt = async (p, layer) => {
    Object.assign(map, { cx: p.x, cy: p.y, mpp: 25, layer });
    for (let k = 0; k < 400; k++) {                                   // drive the progressive accumulation directly
      map.draw(false);
      if (map.acc?.key.startsWith(`${layer}|`) && map.acc.done >= map.acc.total && map.acc.data) break;
      await new Promise(r => setTimeout(r, 5));
    }
    const A = map.acc, gx = Math.floor((map.w / 2) * A.W / map.w), gy = Math.floor((map.h / 2) * A.H / map.h);
    const off = { x: (gx + 0.5 - A.W / 2) * map.mpp / map.accScale, y: (gy + 0.5 - A.H / 2) * map.mpp / map.accScale };
    return { v: 100 * map.valueAt(map.w / 2, map.h / 2), off };
  };
  const sites = (await (await fetch('data/sites.json')).json()).sites.filter(s => s.terrain);
  const rows = [];
  for (const s of sites) {
    const p = Dem.toXY(s.lat, s.lon), gs = await gpuAt(p, 3), ge = await gpuAt(p, 4);
    const q = Dem.toLatLon(p.x + gs.off.x, p.y + gs.off.y), [cs, ce] = cpu(q.lat, q.lon), [ss, se] = cpu(s.lat, s.lon);
    rows.push({ id: s.id, name: s.name, offM: +Math.hypot(gs.off.x, gs.off.y).toFixed(1), gpuSun: +gs.v.toFixed(1), cpuSun: +cs.toFixed(1),
      gpuEarth: +ge.v.toFixed(1), cpuEarth: +ce.toFixed(1), siteSun: +ss.toFixed(1), siteEarth: +se.toFixed(1) });
  }
  console.table(rows);
  console.log(JSON.stringify(rows));

  // Instant by instant: 40 instants of 2027 per site, one GPU sample each, lit vs shadowed (≥ 50% of the solar disk).
  const N = 40, pick = [...Array(N)].map((_, k) => Math.round((k + 0.37) / N * (win.n - 1)));
  let agree = 0, total = 0, maxDiff = 0, partial = 0;
  for (const s of sites) {
    const p = Dem.toXY(s.lat, s.lon);
    Object.assign(map, { cx: p.x, cy: p.y, mpp: 25, layer: 3 });
    for (const i of pick) {
      const one = { n: 1, t: Float64Array.of(win.t[i]), sun: win.sun.slice(3 * i, 3 * i + 3), earth: win.earth.slice(3 * i, 3 * i + 3), stepMin: 60 };
      map.setWindowSamples(one, `one|${i}`);
      for (let k = 0; k < 20; k++) { map.draw(false); if (map.acc?.key.includes(`one|${i}`) && map.acc.done >= map.acc.total && map.acc.data) break; }
      const A = map.acc, gx = Math.floor((map.w / 2) * A.W / map.w), gy = Math.floor((map.h / 2) * A.H / map.h);
      const q = Dem.toLatLon(p.x + (gx + 0.5 - A.W / 2) * map.mpp / map.accScale, p.y + (gy + 0.5 - A.H / 2) * map.mpp / map.accScale);
      const gpu = map.valueAt(map.w / 2, map.h / 2), hz = hzm.computeHorizon(dem, q.lat, q.lon, 2, 720);
      const cpu = ana.analyzeSeries(one, eph.siteFrame(q.lat, q.lon, hz.siteM), hz.mask, {}).sunFrac[0];
      total++; maxDiff = Math.max(maxDiff, Math.abs(gpu - cpu)); if (cpu > 0.02 && cpu < 0.98) partial++;
      if ((gpu >= 0.5) === (cpu >= 0.5)) agree++;
    }
  }
  console.log(`instants: ${agree}/${total} agree, max disk-fraction difference ${maxDiff.toFixed(3)}, ${partial} partly hidden Suns`);
  location.reload();                                                   // restore the app state
})();
