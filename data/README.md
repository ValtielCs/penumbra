# Penumbra data files

Everything the app loads at run time. All of it is derived from public NASA data with the scripts in [`../tools`](../tools)
and can be rebuilt from scratch (see "Rebuild" below).

## `dem/` — NASA LRO LOLA terrain pyramid (3.6 MB)

Source: LRO LOLA gridded polar topography **LDEM_75S_240M** (PDS Geosciences Node, `lro-l-lola-3-rdr-v1`), heights in the
Moon-fixed Mean-Earth/Polar-Axis frame relative to a 1737.4 km sphere. Built by `tools/build-dem.mjs`.

| File | Contents |
|---|---|
| `dem.json` | metadata: `radiusM` (1 737 400), `dnToMeters` (0.5), `minM`/`maxM` (−7764.5 / 7024.5 m), `projection`, `encoding`, and one entry per `levels[]` item: `file`, `n` (grid size), `scale` (m/px), `off` (pixel of the pole), `latLimit` (outer latitude) |
| `l0.bin.gz` | level 0: 1520 × 1520 px at 240 m/px, the original resolution, down to 84°S |
| `l1.bin.gz` | level 1: 953 × 953 px at 960 m/px (4 × 4 averages), down to 75°S |

Projection (polar stereographic, south): `rho = 2R·tan(π/4 + lat/2)`, `x = rho·sin(lon)`, `y = rho·cos(lon)`,
`col = off + x/scale`, `row = off − y/scale`. Encoding of each level: int16 little-endian heights in 0.5 m units, per-row delta
(first sample against 0), byte planes (all low bytes, then all high bytes), gzip. The browser decodes it with the native
`DecompressionStream` (`js/core/dem.js`); `tools/test-core.mjs` checks the decoder against the encoder.

## `sites.json` — curated landing sites with 20-year statistics

Built by `tools/build-sites.mjs` from the site list in that script (each entry cites its source).

| Field | Meaning |
|---|---|
| `id`, `name`, `group`, `kind` | identifier, display name, list group, short category |
| `lat`, `lon` | planetocentric latitude, east-positive longitude (deg); massifs marked `refine: 'summit'` are moved to the highest DEM point nearby |
| `note`, `source` | why the site matters; where its coordinates come from |
| `date` | landing time (UTC) for mission sites, used when the site is opened |
| `terrain` | true inside the 75°S–90°S terrain model (otherwise a smooth-sphere horizon is used) |
| `groundM` | DEM height at the site (m above 1737.4 km) |
| `longTerm` | `period` 2025–2044, `heightM` 2: `sunPct`, `earthPct`, `longestNightH` from 2-hourly samples over 20 years |

## `validation.json` — accuracy checks shown in the "Data & validation" tab

| Check `id` | Produced by | What it compares |
|---|---|---|
| `subpoints` | `tools/validate-horizons.mjs` | sub-solar and sub-Earth directions on the Moon vs NASA/JPL Horizons, one year at 6-h steps |
| `c1`, `im2`, `a11` | `tools/validate-horizons.mjs` | Sun and Earth azimuth/elevation for surface observers on the Moon vs JPL Horizons (`CENTER='coord@301'`), including the 1969 Apollo 11 landing |
| `gpu` | `tools/validate-gpu.js` (browser console) | GPU per-pixel shadows vs the CPU horizon engine: one-year window averages and instant-by-instant lit/shadowed at every terrain-modelled site |

## Rebuild

```bash
# 1. LOLA DEM (29 MB) -> raw/lola/ldem_75s_240m.img (+ .lbl) from
#    https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/
node tools/build-dem.mjs raw/lola/ldem_75s_240m.img data/dem
node tools/build-sites.mjs
bash tools/fetch-horizons.sh raw/horizons            # JPL Horizons API tables
node tools/validate-horizons.mjs raw/horizons data/validation.json
node tools/check-illumination.mjs data/dem            # 20-year illumination vs Gläser et al. (2018)
node tools/test-core.mjs                              # unit tests of the geometry/physics core
```
