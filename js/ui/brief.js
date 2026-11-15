// Mission brief: a printable one-page summary of the scenario on screen, for planners and mission reviews.
// Opens as a static page in a new tab (no scripts, so it also works under the app's CSP); Ctrl/⌘+P saves it as PDF.
import { fmtDate, fmtDur, fmtLat, fmtLon } from './util.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function periods(rs, S, label) {
  if (!rs.length) return `<p class="muted">No ${label} in this window.</p>`;
  const h = S.stepMin / 60;
  const rows = [...rs].sort((a, b) => (b.i1 - b.i0) - (a.i1 - a.i0)).slice(0, 10).sort((a, b) => a.start - b.start);
  return `<table><thead><tr><th>From (UTC)</th><th>To (UTC)</th><th>Duration</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
    <td>${fmtDate(r.start)}</td><td>${fmtDate(r.end)}</td><td>${fmtDur((r.i1 - r.i0 + 1) * h)}</td>
    <td class="muted">${r.openStart ? 'already under way at landing' : ''}${r.openStart && r.openEnd ? '; ' : ''}${r.openEnd ? 'continues after the window' : ''}</td></tr>`).join('')}</tbody></table>
    ${rs.length > rows.length ? `<p class="muted">${rows.length} longest of ${rs.length} shown.</p>` : ''}`;
}

/** Build the brief and open it; returns false if the browser blocked the new tab (the caller then offers a download). */
export function openBrief(b) {
  const { site, sc, M, S, hz, dsn, disp, images, url } = b;
  const P = sc.power, B = M.battery;
  const kpi = (v, k) => `<div class="kpi"><b>${v}</b>${k}</div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Penumbra mission brief — ${esc(site.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font: 12px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif; color: #14161c; margin: 0 auto; max-width: 920px; padding: 18px; }
  h1 { font-size: 22px; margin: 0 0 2px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; margin: 16px 0 6px; border-bottom: 1px solid #ccd; padding-bottom: 3px; }
  .muted { color: #667; } table { border-collapse: collapse; width: 100%; } td, th { padding: 3px 6px; border-bottom: 1px solid #e4e6ec; text-align: left; vertical-align: top; }
  th { font-weight: 600; color: #445; } .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .kpi { border: 1px solid #d8dbe4; border-radius: 6px; padding: 5px 8px; color: #556; font-size: 11px; } .kpi b { display: block; font-size: 16px; color: #14161c; }
  img { display: block; width: 100%; border-radius: 6px; border: 1px solid #ccd; } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  .hint { background: #fff8db; border: 1px solid #ecd47a; padding: 6px 10px; border-radius: 6px; } .ok { color: #137a3f; font-weight: 600; } .bad { color: #b42318; font-weight: 600; }
  a { color: #1d4ed8; word-break: break-all; } @media print { .hint { display: none; } body { padding: 0; } h2 { break-after: avoid; } .two, table, img { break-inside: avoid; } }
</style></head><body>
<p class="hint">Print it, or save it as a PDF, with Ctrl+P (⌘P on a Mac).</p>
<h1>Mission brief — ${esc(site.name)}</h1>
<p class="muted">${fmtLat(site.lat)}, ${fmtLon(site.lon)}${hz.terrain ? ` · ground ${hz.groundM.toFixed(0)} m above the 1737.4 km sphere` : ' · outside the LOLA terrain model (smooth-sphere horizon)'} ·
  generated ${fmtDate(Date.now())} by Penumbra, Lunar Landing Site Navigator (NASA Space Apps 2026)</p>
<h2>Scenario</h2>
<table><tbody>
  <tr><th>Landing</th><td>${fmtDate(sc.startMs)}</td><th>Mission window</th><td>${fmtDur(sc.durDays * 24)}</td></tr>
  <tr><th>Array / antenna height</th><td>${sc.heightM} m above ground</td><th>Direct-to-Earth margin</th><td>${sc.commDeg}° above terrain</td></tr>
  <tr><th>Power system</th><td colspan="3">${P.areaM2} m² vertical Sun-tracking array × ${P.effPct}% (≈ ${(B.peakW / 1000).toFixed(1)} kW peak), ${P.loadW} W load, ${P.capKWh} kWh battery, full at landing</td></tr>
</tbody></table>
<h2>Mission window results</h2>
<div class="kpis">
  ${kpi(`${M.sunPct.toFixed(1)}%`, 'Sunlight (visible solar disk)')}${kpi(`${M.earthPct.toFixed(1)}%`, 'Earth in view (DTE line of sight)')}
  ${kpi(`${M.bothPct.toFixed(1)}%`, 'Sun and Earth together')}${kpi(dsn ? `${dsn.link.toFixed(1)}%` : '—', 'Full DTE link incl. a DSN antenna ≥ 10°')}
  ${kpi(fmtDur(M.longestNightH), 'Longest darkness')}${kpi(fmtDur(M.longestCommGapH), 'Longest loss of Earth')}
  ${kpi(`${M.meanPowerWm2.toFixed(0)} W/m²`, 'Mean array output')}${kpi(`<span class="${B.survives ? 'ok' : 'bad'}">${B.survives ? `survives (min ${B.minSocPct.toFixed(0)}%)` : 'runs empty'}</span>`, B.survives ? 'Battery' : `Battery: empty from ${fmtDate(B.firstEmpty)}`)}
</div>
${dsn ? `<p class="muted">Deep Space Network contact (antenna above 10° and in line of sight of the site): ${dsn.per.map(d => `${d.name} ${d.pct.toFixed(0)}%`).join(' · ')} of the window. With the line of sight to Earth's centre instead of the antennas the full link would be ${dsn.centre.toFixed(1)}%.</p>` : ''}
${site.longTerm ? `<p class="muted">Long-term baseline at this site (${esc(site.longTerm.period)}, 2 m): Sun ${site.longTerm.sunPct}% · Earth ${site.longTerm.earthPct}%.</p>` : ''}
<h2>Horizon, map and timeline</h2>
${images.horizon ? `<img src="${images.horizon}" alt="Horizon view">` : ''}
<div class="two" style="margin-top:8px">${images.map ? `<img src="${images.map}" alt="Polar map">` : '<div></div>'}${images.timeline ? `<img src="${images.timeline}" alt="Timeline">` : ''}</div>
<h2>Darkness (Sun's center below the terrain)</h2>
${periods(M.nights, S, 'darkness')}
<h2>Loss of direct-to-Earth line of sight</h2>
${periods(M.gaps, S, 'loss of Earth')}
${disp ? `<h2>Landing ellipse ±${disp.rKm < 1 ? `${(disp.rKm * 1000).toFixed(0)} m` : `${disp.rKm} km`} (19 touchdown points)</h2>
<p>Sunlight ${disp.sun[0].toFixed(0)}–${disp.sun[1].toFixed(0)}% · Earth in view ${disp.earth[0].toFixed(0)}–${disp.earth[1].toFixed(0)}% ·
  longest darkness ${fmtDur(disp.night[0])}–${fmtDur(disp.night[1])} · battery survives at ${disp.survive} of ${disp.pts.length} points.</p>` : ''}
<h2>Method and data</h2>
<p>Terrain: NASA LRO LOLA LDEM_75S_240M (PDS Geosciences Node). Horizon: 720 great-circle rays ray-marched up to 600 km with exact lunar
  curvature. Sun and Earth: Astronomy Engine with the IAU lunar rotation model, validated against NASA/JPL Horizons (≤ 9″ in elevation);
  20-year illumination at Connecting Ridge C1/C2 within 0.3 points of Gläser et al. (2018). Power assumes a clean, vertical, Sun-tracking array;
  direct-to-Earth is a geometric line of sight to Earth's center (no link budget).</p>
<p>Reopen this exact scenario: <a href="${esc(url)}">${esc(url)}</a></p>
</body></html>`;
  const href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  const w = window.open(href, '_blank');
  if (w) return true;
  const a = document.createElement('a');                               // pop-up blocked: download the file instead
  a.href = href; a.download = `penumbra-brief-${site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
  document.body.append(a); a.click(); a.remove();
  return false;
}
