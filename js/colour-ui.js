/*
 * Printworks colour swatches (v1.7): shared by the PDF preflight and the IDML inspector.
 * Swatch colours are on-screen approximations. They never alter any file.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // c: { kind, rgb, rgb2, label }
  function swatch(c) {
    const kind = c.kind || 'process';
    if (kind === 'gradient') return `<span class="sw sw-grad" style="background:linear-gradient(90deg,${c.rgb || '#ccc'},${c.rgb2 || c.rgb || '#888'})" aria-hidden="true"></span>`;
    if (kind === 'registration') return '<span class="sw sw-reg" aria-hidden="true"></span>';
    const bg = c.rgb ? `background:${c.rgb}` : '';
    const cls = ['sw']; if (!c.rgb) cls.push('sw-unknown'); if (kind === 'spot') cls.push('sw-spot'); if (kind === 'rgb' || kind === 'lab') cls.push('sw-warn');
    return `<span class="${cls.join(' ')}" style="${bg}" aria-hidden="true"></span>`;
  }
  // One colour: swatch, name, small facts, optional page buttons.
  function chip(c, o) {
    o = o || {};
    const pages = c.pages || [];
    const facts = []; if (c.values) facts.push(c.values);
    if (c.cmyk && c.kind === 'cmyk' && c.tac != null) facts.push(`${c.tac}% ink`);
    if (c.tints && c.tints.length && (c.tints.length > 1 || c.tints[0] < 100)) facts.push('tints ' + c.tints.join(', ') + '%');
    if (pages.length) facts.push(`${pages.length} page${pages.length === 1 ? '' : 's'}`);
    if (c.sources && c.sources.length && o.sources) facts.push(c.sources.join(', '));
    const btns = o.pageButtons && pages.length ? `<span class="chip-pages">${pages.slice(0, o.pageButtons).map(p => `<button type="button" class="mini-btn" data-page="${p + 1}">p.${p + 1}</button>`).join('')}${pages.length > o.pageButtons ? `<span class="insp-note">and ${pages.length - o.pageButtons} more</span>` : ''}</span>` : '';
    return `<li class="colour-chip${c.problem ? ' is-problem' : ''}${c.hot ? ' is-hot' : ''}">${swatch(c)}<span class="chip-text"><b>${esc(c.label || c.name)}</b><span class="chip-facts">${esc(facts.join(' · '))}</span></span>${btns}</li>`;
  }
  const list = (items, o) => `<ul class="colour-list">${items.map(c => chip(c, o)).join('')}</ul>`;
  PW.colourUI = { swatch, chip, list, esc };
})(typeof window !== 'undefined' ? window : globalThis);
