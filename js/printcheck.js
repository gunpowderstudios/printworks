/*
 * Printworks print checks (v1.6)
 *
 * Checks the typography against your printer's rules, using the sizes, colours and frames in the IDML.
 * Optionally applies a font map first, so you see what the NEW fonts would do.
 *
 * What this can and cannot see (be honest about it in the UI):
 *   - Text size, font weight and ink colour are exact: they come straight from the file.
 *   - Distance to the trim edge is measured from the FRAME box, not from the text inside it.
 *     Measuring the real text needs the page renderer (planned).
 *
 * The profile values are only starting points. Replace them with your printer's own specs.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const MM = 72 / 25.4;
  const STORE_KEY = 'printworks.printerProfile';

  const DEFAULT_PROFILE = { minText: 5, lightMin: 8, multiInkMin: 8, reverseMin: 6, safeMm: 3 };
  const LIGHT_RE = /\b(thin|hairline|extra[- ]?light|ultra[- ]?light|light)\b/i;

  function loadProfile() {
    try { const raw = root.localStorage && root.localStorage.getItem(STORE_KEY); if (raw) return Object.assign({}, DEFAULT_PROFILE, JSON.parse(raw)); } catch (e) { /* use defaults */ }
    return Object.assign({}, DEFAULT_PROFILE);
  }
  function saveProfile(p) { try { root.localStorage && root.localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* not fatal */ } }

  function sanitize(p) {
    const out = {};
    for (const k in DEFAULT_PROFILE) { const v = Number(p && p[k]); out[k] = isFinite(v) && v >= 0 ? v : DEFAULT_PROFILE[k]; }
    return out;
  }

  function run(doc, scan, profileIn, map) {
    const profile = sanitize(profileIn); const idml = PW.idml; const fm = PW.fontmap;
    const defs = {
      small: { code: 'small-text', level: 'warn', title: 'Text below your minimum size', help: `Set smaller than ${profile.minText} pt.` },
      light: { code: 'light-weight', level: 'warn', title: 'Thin or light weights at small sizes', help: `Light, Thin or Hairline styles below ${profile.lightMin} pt can break up or fill in when printed.` },
      multi: { code: 'multi-ink', level: 'warn', title: 'Small text in more than one ink', help: `Colours made from two or more inks, below ${profile.multiInkMin} pt, can look soft if the plates are slightly off register.` },
      reversed: { code: 'reversed-out', level: 'warn', title: 'Small reversed-out text', help: `Text in Paper (no ink) below ${profile.reverseMin} pt knocks out of the background and fine strokes can fill in.` },
      edgeTrim: { code: 'frame-past-trim', level: 'info', title: 'Text frames that extend past the trim edge', help: 'Frame boxes only. The text inside may sit well within the page.' },
      edgeSafe: { code: 'frame-in-safe', level: 'info', title: 'Text frames inside the safe margin', help: `Frame boxes within ${profile.safeMm} mm of the trim edge. The text inside may sit well within the page.` },
    };
    const items = {};
    for (const k in defs) items[k] = Object.assign({ frames: 0, chars: 0, examples: [] }, defs[k]);
    const touchedPages = new Set(); let framesChecked = 0;

    for (const pg of scan.pages) {
      for (const fid of pg.frameIds) {
        const f = scan.items.get(fid); if (!f || f.hidden || !f.bbox) continue;
        const story = scan.stories.get(f.story); if (!story || !story.text.trim()) continue;
        framesChecked++;
        const snippet = story.text.replace(/\s*\n\s*/g, ' / ').slice(0, 60);
        const add = (key, detail, chars) => {
          const it = items[key]; it.frames++; it.chars += chars || 0; touchedPages.add(pg.index);
          if (it.examples.length < 10) it.examples.push({ pageIndex: pg.index, pageName: pg.name, frame: f.id, detail, text: snippet });
        };
        // --- edge proximity (frame box)
        const r = pg.rect, b = f.bbox, safePt = profile.safeMm * MM;
        const d = Math.min(b.x - r.x, r.x + r.w - (b.x + b.w), b.y - r.y, r.y + r.h - (b.y + b.h));
        if (d < -0.01) add('edgeTrim', Math.abs(d / MM).toFixed(1) + ' mm past trim');
        else if (d < safePt) add('edgeSafe', (d / MM).toFixed(1) + ' mm from trim');
        // --- per-run checks
        const agg = {};
        const bump = (key, size, n, extra) => { const a = agg[key] || (agg[key] = { chars: 0, min: Infinity, extra }); a.chars += n; a.min = Math.min(a.min, size); };
        for (const para of story.paragraphs) for (const run of para.runs) {
          const n = run.text.replace(/[\u2028\n]/g, '').length; if (!n) continue;
          const eff = idml.cascadeProps(doc.styles, para.styleId, para.local, run.charStyle, run.local);
          const size = parseFloat(eff.size); if (!isFinite(size)) continue;
          let style = eff.fontStyle || 'Regular';
          if (map && map.size && eff.font) { const t = map.get(fm.keyOf(eff.font, eff.fontStyle)); if (t) style = t.style; }
          if (size < profile.minText) bump('small', size, n);
          if (LIGHT_RE.test(style) && size < profile.lightMin) bump('light', size, n, style);
          if (eff.fill) {
            const sw = idml.resolveSwatch(doc.swatches, eff.fill);
            if (sw.reversed && size < profile.reverseMin) bump('reversed', size, n);
            else if (sw.inks >= 2 && sw.kind !== 'registration' && size < profile.multiInkMin) bump('multi', size, n, sw.name + ', ' + sw.inks + ' inks');
          }
        }
        for (const key in agg) add(key, fmtPt(agg[key].min) + ' pt' + (agg[key].extra ? ' · ' + agg[key].extra : ''), agg[key].chars);
      }
    }
    const list = Object.values(items);
    return { profile, usedFontMap: !!(map && map.size), framesChecked, pagesAffected: touchedPages.size,
      problems: list.filter(i => i.frames && i.level === 'warn'), notes: list.filter(i => i.frames && i.level === 'info'),
      clear: list.filter(i => !i.frames).map(i => i.title) };
  }
  const fmtPt = n => (Math.round(n * 10) / 10).toString();

  PW.printcheck = { DEFAULT_PROFILE, loadProfile, saveProfile, sanitize, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.printcheck;
})(typeof window !== 'undefined' ? window : globalThis);
