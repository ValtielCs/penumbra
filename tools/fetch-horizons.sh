#!/usr/bin/env bash
# Fetch reference ephemerides from NASA/JPL Horizons API for validation.
# Output: raw/horizons/*.txt (raw API text responses)
set -euo pipefail
OUT="${1:-raw/horizons}"
mkdir -p "$OUT"
API="https://ssd.jpl.nasa.gov/api/horizons.api"
q() { # name, then key=value pairs
  local name="$1"; shift
  local url="$API?format=text&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'&TIME_DIGITS='MINUTES'"
  for kv in "$@"; do url="$url&$kv"; done
  curl.exe -sS --retry 3 "$url" -o "$OUT/$name.txt"
  echo "$name: $(grep -c '^ [0-9]' "$OUT/$name.txt" || true) rows"
}
# 1) Sub-Earth and sub-solar points on the Moon (MOON_ME), one year, 6-hour steps
q subpoints_2026_2027 "COMMAND='301'" "CENTER='500@399'" "START_TIME='2026-11-14'" "STOP_TIME='2027-11-14'" "STEP_SIZE='6h'" "QUANTITIES='14,15,19,20'"
# 2) Topocentric AZ/EL from Connecting Ridge C1 (Glaser et al. 2018), one month, 2-hour steps
SITE="SITE_COORD='222.83,-89.44,1.9505'"
q c1_sun   "COMMAND='10'"  "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='2026-11-14'" "STOP_TIME='2026-12-14'" "STEP_SIZE='2h'" "QUANTITIES='4,20'"
q c1_earth "COMMAND='399'" "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='2026-11-14'" "STOP_TIME='2026-12-14'" "STEP_SIZE='2h'" "QUANTITIES='4,20'"
# 3) Apollo 11 landing site on landing day (historic date check)
SITE="SITE_COORD='23.47297,0.67408,-1.9'"
q a11_sun   "COMMAND='10'"  "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='1969-07-20%2020:00'" "STOP_TIME='1969-07-22%2020:00'" "STEP_SIZE='1h'" "QUANTITIES='4,20'"
q a11_earth "COMMAND='399'" "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='1969-07-20%2020:00'" "STOP_TIME='1969-07-22%2020:00'" "STEP_SIZE='1h'" "QUANTITIES='4,20'"
# 4) Mons Mouton (IM-2 intended site, LROC), one month, 2-hour steps
SITE="SITE_COORD='29.13,-84.78,5.0'"
q im2_sun   "COMMAND='10'"  "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='2027-03-01'" "STOP_TIME='2027-04-01'" "STEP_SIZE='2h'" "QUANTITIES='4,20'"
q im2_earth "COMMAND='399'" "CENTER='coord@301'" "COORD_TYPE='GEODETIC'" "$SITE" "START_TIME='2027-03-01'" "STOP_TIME='2027-04-01'" "STEP_SIZE='2h'" "QUANTITIES='4,20'"
