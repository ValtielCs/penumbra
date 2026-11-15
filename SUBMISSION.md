# Space Apps 2026 — project page draft (copy into the form, edit freely)

> Fill in the `[ … ]` placeholders. Everything on the project page must be in English.

## Project Name
Penumbra — Lunar Landing Site Navigator

## High-Level Project Summary
Penumbra is a web app that answers the two questions behind every lunar south-pole landing — *will we have power?* and
*can we talk to Earth?* — for any site and date in seconds. It shows the Sun and the Earth above the real local horizon
built from NASA LRO LOLA topography, with live GPU-rendered shadows over the polar map, one-year illumination maps that reveal
peaks of near-eternal light, a 360° horizon panorama, a 3D "astronaut's eye" view, and a timeline with time-to-sunset and
time-to-Earthset, a battery simulation and Deep Space Network coverage. Planners can slip the landing date by a day, compare scenarios side by
side, scan a whole year of landing dates across sites in one heatmap, or re-run the whole mission over the landing ellipse to see what
happens if the lander misses its target by a few hundred metres. Educators and the public get one-click lessons that make
the strangeness of the pole visible. Everything runs in the browser; the Sun and Earth elevations it computes agree with NASA/JPL
Horizons within 9 arcseconds, and its terrain-aware illumination reproduces published 20-year averages at the Connecting Ridge to within
0.3 percentage points.

## Link to Project Demo
https://valtielcs.github.io/penumbra/docs/penumbra-demo-30s.mp4
[ 29.5-s video with English captions (H.264, plays in any browser). A YouTube link of the same file works too; the 7-slide deck is https://valtielcs.github.io/penumbra/docs/Penumbra-demo.pdf ]

## Link to Final Project
https://valtielcs.github.io/penumbra/  ·  source: https://github.com/ValtielCs/penumbra

## Detailed Project Description
**What it does.** Pick a curated site (Connecting Ridge, Shackleton rim and floor, de Gerlache rim, Malapert Massif,
Mons Mouton, Nobile Rim 2, IM-1/IM-2, Chandrayaan-3, SLIM, Chang'e-4, Apollo 11/17) or click anywhere on the polar map. Choose a landing
date and a mission window. Penumbra then shows:
- a **horizon panorama** with the LOLA terrain silhouette, the Sun and Earth tracks over the whole window, true angular sizes and Earth phase;
- a **live shadow map** of the south pole in which every pixel is ray-marched toward the Sun (or the Earth) on the GPU, so shadows sweep around the pole as you scrub time;
- a **timeline** of sunlight (visible fraction of the solar disk), Earth visibility and both together, plus Sun elevation vs. the terrain beneath it;
- **now metrics**: Sun/Earth elevation and azimuth, array output in W/m², time to sunset/sunrise and Earthset/Earthrise;
- **mission KPIs**: sunlight %, direct-to-Earth %, Sun+Earth %, longest darkness, longest comm gap, mean array power, battery needed to survive the longest darkness, flat vs. vertical panel;
- **mission-window maps**: sunlight % and Earth-in-view % over the whole window, averaged over 128 instants on the GPU, with the best-lit spot in view marked;
- **3D terrain and an astronaut's-eye view** with the same ray-traced shadows, the true-size Sun and the Earth with its real phase; zoomed in on
  the Earth, the DSN antennas appear on its disk, green when in line of sight and red when hidden by the lunar terrain;
- **power-system simulation** (array, load, battery; rover / CLPS lander / habitat presets): does the battery survive the window?
- **Deep Space Network coverage**: a direct-to-Earth link needs Goldstone, Madrid or Canberra to see the Moon *and* to be in line of sight of the site
  itself. Seen from the south pole Canberra sits ~0.5° above Earth's centre and Goldstone/Madrid ~0.5° below, so modelling the antennas (not Earth's
  centre) changes the answer when Earth grazes the horizon: at Mons Mouton in 2027 the link drops from 98.1% to 91.8%;
- **linked horizon and map**: hover the skyline and the map traces the ridge that blocks the Sun at that azimuth, kilometres away;
- **off-target touchdown**: one click re-runs the mission at 19 points of a ±250 m to ±5 km landing ellipse. On Connecting Ridge in March 2027
  a ±500 m ellipse spans 23–99% sunlight, and a CLPS-class battery survives at only 7 of the 19 touchdown points. Real landers do miss:
  IM-2 *Athena* came down about 250 m from its target in March 2025, inside a small crater, and its mission ended the next day.

Planners can press **±1 day** to see a schedule slip, list the **best landing dates** of the next 12 months for the chosen site,
**+ Compare** to stack scenarios, and open the **When & where** heatmap
(every site × every landing day of a year) to find viable alternatives when a date or location changes. A **Verify in JPL Horizons**
button opens the identical query in NASA's Horizons API, a **Share link** reopens the exact scenario (including the comparison),
CSV export hands the time series to other tools, and a printable one-page **mission brief** goes to a review board. A 45-second guided tour and eight one-click lessons serve educators and the public.

**Try these scenarios (one click each).** Earth from Connecting Ridge: https://valtielcs.github.io/penumbra/#site=c1&start=2027-01-08T00:00&days=7&t=2027-01-15T00:00&vm=eye&look=earth ·
a year of sunlight around Shackleton: https://valtielcs.github.io/penumbra/#site=c1&start=2027-01-01T00:00&days=365.25&layer=3&mv=-6,-4,70 ·
missing the target by 500 m: https://valtielcs.github.io/penumbra/#site=c1&start=2027-03-01T00:00&days=14&t=2027-03-08T12:00&ellipse=0.5 ·
when to land on Mons Mouton: https://valtielcs.github.io/penumbra/#site=mou&start=2027-03-01T00:00&days=14&best=1 ·
which DSN antenna keeps the link: https://valtielcs.github.io/penumbra/#site=mou&start=2027-03-01T00:00&days=29.53&t=2027-03-24T02:00&vm=eye&look=earth

**How it works.** The Sun and Moon positions (Astronomy Engine) are rotated into the Moon-fixed Mean-Earth frame with the
IAU lunar rotation model, the same frame as LOLA and Horizons' MOON_ME. Topocentric azimuth/elevation include the Earth's parallax.
The local horizon comes from 720 great-circle rays marched through the LOLA DEM (240 m/px near the pole, 960 m/px to 75°S, up to 600 km)
with exact spherical geometry, so lunar curvature is included and no refraction is applied. Power uses the true solar disk fraction
above the terrain and a vertical Sun-tracking array. "Earth in view" means Earth's centre clears the terrain (plus an optional margin);
a direct-to-Earth link additionally needs a DSN antenna above 10° that is itself in line of sight of the site, with the Moon's elevation at
each complex from Astronomy Engine and the antenna's position from the Earth's rotation.

**Validation.** Against JPL Horizons for observers on the lunar surface (three sites, including Apollo 11 in 1969), Sun and Earth
elevations agree within 9″. The 20-year average illumination at Connecting Ridge C1/C2 is 87.7%/78.0%, against the published
88.0%/78.1% (Gläser et al. 2018). Shackleton's permanently shadowed floor correctly stays dark. Our two independent engines
(per-pixel GPU ray-marching for the maps, CPU horizon masks for the numbers) agree on lit vs shadowed in 400 of 400 test instants,
and their one-year sunlight maps agree within 0.2 percentage points at all ten terrain-modelled sites.

**Benefits.** When hardware or launch delays force a new date or site, a team can evaluate alternatives in seconds instead of
juggling Quickmap, Moon Trek and Horizons tables. The same tool explains to students why a ridge 20 km from Shackleton has 88%
sunlight while the crater floor has none.

**Tools.** HTML, CSS, JavaScript (ES modules, Canvas 2D, WebGL2), Node.js and Python for the data pipeline, Astronomy Engine (MIT).
A Node.js unit-test suite (205 checks, including synthetic terrain with analytic answers) runs in GitHub Actions; the app ships with a strict Content-Security-Policy and no third-party requests.
No build step and no server: it runs from static hosting such as GitHub Pages.

## Use of Super Intelligence (SI)
[ TEAM: edit this so it describes your process exactly. Space Apps rules: SI must not be used to come up with the idea, and its use
  must be disclosed. Keep it accurate rather than modest. Draft: ]
We used Claude (Anthropic), an AI coding assistant, extensively. Working from the challenge statement and our instructions, it wrote most
of the code (the browser app in JavaScript/WebGL and the Node.js/Python data pipeline), the unit tests, the documentation, the slide deck
and the demo video, and it proposed many of the features. [Describe your own role here: what you chose and decided, what you reviewed,
tested and presented.] We did not take any number on trust: every result is reproducible with the scripts in `tools/`, checked against
NASA/JPL Horizons and published illumination studies, and covered by unit tests that run in GitHub Actions.

## NASA Data
- **NASA LRO LOLA** polar gridded topography `LDEM_75S_240M` (PDS Geosciences Node), the source of every terrain horizon and the shadow map.
- **NASA/JPL Horizons System** (DE441, MOON_ME frame), the reference ephemerides for surface observers on the Moon, used to validate the
  in-browser ephemeris, and the in-app "Verify in JPL Horizons" link.
- **LROC / Quickmap** landing-site positions (Apollo 11/17, IM-1, IM-2); **Moon Trek** as visual cross-reference.
- **NASA Deep Space Network** antenna locations (DSS-14 Goldstone, DSS-63 Madrid, DSS-43 Canberra), DSN Telecommunications Link Design Handbook 810-005, module 301.

## Space Agency Partner Data and Other References
- ISRO, Chandrayaan-3 Vikram landing site (Shiv Shakti point); JAXA, SLIM landing site; CSA, Moon Exploration portal (context).
- Gläser, P. et al. (2018) *Illumination conditions at the lunar poles: implications for future exploration*, Planetary and Space Science (NASA NTRS 20170007365).
- Artemis III candidate site DM2 (Nobile Rim 2): multi-criteria decision-making study, arXiv:2406.19863 (Acta Astronautica, 2024).
- Bussey, D.B.J. et al. (2010) *Illumination conditions of the south pole of the Moon derived using Kaguya topography*, Icarus.
- Spaceflight Now (7 Mar 2025), *Intuitive Machines' IM-2 Moon mission ends with lander on its side*: https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/
- IAU Gazetteer of Planetary Nomenclature (USGS), feature coordinates.
- Astronomy Engine 2.1.19, Don Cross, MIT license: https://github.com/cosinekitty/astronomy
