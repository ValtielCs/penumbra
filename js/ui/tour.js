// First-visit guided tour: spotlight + short captions, keyboard friendly (→/Enter next, ← back, Esc close).

const STEPS = [
  { sel: null, title: 'Will we have power? Can we call home?',
    text: 'Penumbra answers both for any lunar landing site and date in seconds, using NASA LRO LOLA terrain and Sun/Earth ephemerides validated against NASA/JPL Horizons. 8 quick stops, about 45 seconds.' },
  { sel: '.side .card:first-child', title: '1 · Pick a landing site',
    text: 'Artemis III candidate regions, CLPS and partner-agency landings, Apollo for contrast, or any coordinates. The yellow and blue bars show 20-year averages of sunlight and Earth visibility.' },
  { sel: '.panorama-card', title: '2 · The real horizon',
    text: 'The skyline is ray-marched from LOLA terrain. At the pole the Sun (yellow) circles just above it and the Earth (blue) bobs up and down. Try “3D terrain” or “Astronaut’s eye”.' },
  { sel: '.map-card', title: '3 · Live shadows on your GPU',
    text: 'Every pixel traces a ray toward the Sun. Switch the layer to “Sunlight % over mission window” to reveal peaks of near-eternal light and permanently shadowed craters. Click anywhere to analyse that spot.' },
  { sel: '.metrics-card', title: '4 · Is it viable?',
    text: 'Time to sunset and Earthset, array output, longest darkness, comm gaps, and a battery simulation. Tune the power system in the Scenario panel.' },
  { sel: '#disp', title: '5 · Miss the target?',
    text: 'Landers come down hundreds of metres off target. One click re-runs the whole mission at 19 touchdown points of the landing ellipse and maps the spread on the polar map.' },
  { sel: '.timeline-card', title: '6 · Scrub through time',
    text: 'Drag, use ← → (Shift = 1 day), or press ▶ Play. Bright blue means the Earth is in view AND a Deep Space Network antenna can see the Moon.' },
  { sel: '#btn-slip-plus', title: '7 · The launch slipped?',
    text: 'Move the landing by a day, or open “Best landing dates” for the five best days of the next 12 months. “+ Compare” stacks scenarios; the Compare tab scans every site × every day of a year.' },
  { sel: '#btn-horizons', title: '8 · Trust, but verify',
    text: 'Opens the identical Sun query in NASA/JPL Horizons. Data & validation shows how closely we match Horizons and published illumination studies.' },
];

export function startTour(force = false) {
  try { if (!force && localStorage.getItem('penumbra-tour-done')) return; } catch { /* storage blocked: still show */ }
  let k = 0;
  const shade = document.createElement('div'); shade.className = 'tour-shade';
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  const card = document.createElement('div'); card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  document.body.append(shade, spot, card);
  const close = () => {
    shade.remove(); spot.remove(); card.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', show);
    try { localStorage.setItem('penumbra-tour-done', '1'); } catch { /* ignore */ }
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (k > 0) { k--; show(); } }
  };
  const next = () => { if (k < STEPS.length - 1) { k++; show(); } else close(); };
  function show() {
    const s = STEPS[k], el = s.sel && document.querySelector(s.sel);
    card.innerHTML = `<div class="tour-step">${k === 0 ? 'Welcome' : `${k} / ${STEPS.length - 1}`}</div><h3>${s.title}</h3><p>${s.text}</p>
      <div class="tour-btns"><button class="btn ghost" data-a="skip">${k === 0 ? 'Skip' : 'Close'}</button>
      ${k > 0 ? '<button class="btn" data-a="back">Back</button>' : ''}<button class="btn primary" data-a="next">${k === 0 ? 'Start the tour →' : k === STEPS.length - 1 ? 'Done' : 'Next →'}</button></div>`;
    card.querySelector('[data-a=next]').onclick = next;
    card.querySelector('[data-a=skip]').onclick = close;
    card.querySelector('[data-a=back]')?.addEventListener('click', () => { k--; show(); });
    if (!el) {
      spot.style.display = 'none'; shade.style.display = 'block';
      Object.assign(card.style, { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' });
    } else {
      el.scrollIntoView({ block: 'center', behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
      const r = el.getBoundingClientRect(), pad = 6;
      shade.style.display = 'none'; spot.style.display = 'block';
      Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
      const cw = Math.min(360, window.innerWidth - 24), below = r.bottom + 14 + 190 < window.innerHeight;
      const left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left));
      const top = below ? r.bottom + 14 : Math.max(12, r.top - 14 - card.offsetHeight);
      Object.assign(card.style, { left: `${left}px`, top: `${top}px`, transform: 'none', width: `${cw}px` });
      if (!below) requestAnimationFrame(() => { card.style.top = `${Math.max(12, r.top - 14 - card.offsetHeight)}px`; });
    }
    card.querySelector('[data-a=next]').focus();
  }
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', show);
  show();
}
