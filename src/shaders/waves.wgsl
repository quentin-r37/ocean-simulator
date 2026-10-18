// Incoming swell, shared by the simulation (wave-maker zone) and the far-field ocean.
// Waves travel towards -z (from the open sea onto the beach).

fn waveComp(p: vec2f, t: f32, a: f32, period: f32, ang: f32, c: f32, ph: f32) -> f32 {
  let w = 6.2831853 / period;
  let k = w / c;
  let dir = vec2f(sin(ang), -cos(ang));
  let th = k * dot(dir, p) - w * t + ph;
  // Slightly peaked crests / flat troughs (2nd-order Stokes-like correction).
  return a * (sin(th) - 0.18 * cos(2.0 * th));
}

fn waveEta(p: vec2f, t: f32, amp: f32, period: f32, depth: f32) -> f32 {
  let c = sqrt(9.81 * max(depth, 0.25));
  // Wave groups: sets of bigger waves every few periods.
  let grp = 0.62 + 0.38 * sin(6.2831853 * t / (period * 6.7) + 0.4 * sin(t * 0.021));
  var e = waveComp(p, t, 1.0, period, 0.0, c, 0.0);
  e += waveComp(p, t, 0.45, period * 0.71, 0.33, c, 1.3);
  e += waveComp(p, t, 0.30, period * 1.33, -0.27, c, 2.9);
  return amp * grp * e * 0.62;
}
