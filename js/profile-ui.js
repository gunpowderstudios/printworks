/*
 * Printworks printer profile UI (v1.7)
 * One profile, shared by the PDF preflight and the typography print checks. Saved in this browser only.
 * Any change fires a "printworks:profile" event so each checker can re-evaluate instantly.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const $ = s => document.querySelector(s);
  const NUM = ['minText', 'lightMin', 'multiInkMin', 'reverseMin', 'safeMm', 'bleedMm', 'minPpi', 'maxInk'];

  function render() {
    const p = PW.printcheck.loadProfile();
    for (const k of NUM) { const el = $('#pf_' + k); if (el) el.value = p[k]; }
    const rgb = $('#pf_allowRgb'); if (rgb) rgb.checked = !!p.allowRgb;
    const spot = $('#pf_allowSpot'); if (spot) spot.checked = !!p.allowSpot;
    summary(p);
  }
  function read() {
    const raw = {}; for (const k of NUM) { const el = $('#pf_' + k); raw[k] = el ? el.value : ''; }
    const rgb = $('#pf_allowRgb'); raw.allowRgb = rgb ? rgb.checked : false;
    const spot = $('#pf_allowSpot'); raw.allowSpot = spot ? spot.checked : false;
    return PW.printcheck.sanitize(raw);
  }
  function summary(p) {
    const el = $('#profileSummary'); if (!el) return; p = p || PW.printcheck.loadProfile();
    el.textContent = `Bleed ${p.bleedMm} mm · ${p.minPpi} ppi · RGB ${p.allowRgb ? 'accepted' : 'flagged'} · spot ${p.allowSpot ? 'accepted' : 'flagged'} · ink ${p.maxInk}% · text from ${p.minText} pt`;
  }
  function changed() {
    const p = read(); PW.printcheck.saveProfile(p); summary(p);
    document.dispatchEvent(new CustomEvent('printworks:profile', { detail: p }));
  }
  function setFileNote(text) { const el = $('#pfFile'); if (el) el.textContent = text || ''; }

  function init() {
    if (!$('#profileSection')) return;
    render();
    document.querySelectorAll('.pf-in').forEach(el => { el.oninput = changed; el.onchange = changed; });
    const reset = $('#pfReset');
    if (reset) reset.onclick = () => { PW.printcheck.saveProfile(PW.printcheck.DEFAULT_PROFILE); render(); document.dispatchEvent(new CustomEvent('printworks:profile', { detail: PW.printcheck.loadProfile() })); };
  }
  document.addEventListener('DOMContentLoaded', init);
  PW.profileUI = { render, setFileNote, summary };
})(typeof window !== 'undefined' ? window : globalThis);
