/*
 * Printworks colour maths (v1.7). Shared by the IDML model and the PDF preflight.
 * Everything here is an ON-SCREEN APPROXIMATION for swatches. It never changes a colour in any file.
 * CMYK -> RGB interpolates between the usual process-ink corner colours (no ICC profile involved).
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const CMY_CORNERS = { '000': [255, 255, 255], '100': [0, 174, 239], '010': [236, 0, 140], '001': [255, 242, 0],
    '110': [46, 49, 146], '101': [0, 166, 81], '011': [237, 28, 36], '111': [58, 53, 54] };
  function cmykToRgb(c, m, y, k) {
    c = clamp01(c); m = clamp01(m); y = clamp01(y); k = clamp01(k);
    const out = [0, 0, 0];
    for (const key in CMY_CORNERS) {
      const w = (key[0] === '1' ? c : 1 - c) * (key[1] === '1' ? m : 1 - m) * (key[2] === '1' ? y : 1 - y);
      for (let i = 0; i < 3; i++) out[i] += w * CMY_CORNERS[key][i];
    }
    const kk = 1 - k * (1 - 35 / 255);
    return out.map(v => Math.round(v * kk));
  }
  // CIE Lab (D50, as used in print) -> sRGB, rounded.
  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const f = t => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29));
    const X = 0.9642 * f(fx), Y = f(fy), Z = 0.8249 * f(fz); // D50 white
    const r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z, g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z, bl = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
    const gam = u => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055);
    return [r, g, bl].map(u => Math.round(255 * clamp01(gam(u))));
  }
  const hex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  PW.colour = { cmykToRgb, labToRgb, hex, clamp01 };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.colour;
})(typeof window !== 'undefined' ? window : globalThis);
