// Mission score: one number (0–100) that ranks site × date scenarios in the Compare tab
// and colors the "When & where to land" heatmap.
//
// Input `m` (all over the mission window):
//   m.sunPct           average fraction of the solar disk above the terrain, %   (power)
//   m.earthPct         time with Earth's center above the terrain (+margin), %   (direct-to-Earth comms)
//   m.bothPct          time with Sun AND Earth available together, %             (power + downlink)
//   m.longestNightH    longest continuous darkness, hours                        (battery / survival)
//   m.longestCommGapH  longest continuous loss of Earth, hours                   (operations blackout)
//   m.meanPowerWm2     mean output of a vertical Sun-tracking array, W/m²
//   m.minSocPct        lowest battery charge in the window, % (Power system panel; 0 = ran empty)
//   m.survives         true if the battery never ran empty
//
// This is a mission-design policy, not physics: a solar-powered rover that must survive the
// night weighs `longestNightH` heavily; a relay-equipped lander barely cares about `earthPct`.

export function scoreScenario(m) {
  // TODO(team): replace this baseline with your mission's priorities (5–10 lines).
  // Baseline: geometric mean of power and comms availability, so a site with no
  // Sun or no Earth scores 0 no matter how good the other one is.
  return Math.round(Math.sqrt(Math.max(0, m.sunPct) * Math.max(0, m.earthPct)));
}
