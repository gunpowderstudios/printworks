/*
 * Printworks PDF preflight UI (v1.7)
 * Reads a PDF with PW.preflight, shows findings against the shared printer profile, and re-evaluates
 * instantly whenever the profile changes. Works on a PDF on its own, or alongside an IDML.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => Number(n).toLocaleString();
  const LABEL = { error: 'problem', warn: 'check', info: 'note', pass: 'ok' };
  const MM = 72 / 25.4;

  let facts = null, result = null, runId = 0, fileInfo = null, thumbToken = 0;

  function reset() {
    runId++; facts = null; result = null; fileInfo = null; thumbToken++;
    const sec = $('#preflightSection'); if (sec) sec.classList.add('hidden');
    const body = $('#pfBody'); if (body) body.innerHTML = '';
  }

  async function start(bytes, file) {
    const my = ++runId; facts = null; result = null; fileInfo = { name: file ? file.name : 'PDF', size: bytes.length };
    const sec = $('#preflightSection'), body = $('#pfBody'); if (!sec || !body) return;
    sec.classList.remove('hidden');
    body.innerHTML = '<div class="insp-progress"><span id="pfProgressLabel">Reading the PDF…</span><progress id="pfProgress" max="100" value="0"></progress></div>';
    if (!root.PDFLib) { body.innerHTML = '<p class="insp-note insp-warn">The PDF checker library could not be loaded (it comes from a CDN). Check your connection and reload the page.</p>'; return; }
    try {
      const f = await PW.preflight.extract(bytes, { onProgress: p => { const el = $('#pfProgress'); if (el && my === runId) { el.value = Math.round(p * 100); $('#pfProgressLabel').textContent = 'Checking pages… ' + Math.round(p * 100) + '%'; } } });
      if (my !== runId) return;
      if (f.error) { body.innerHTML = `<p class="insp-note insp-warn">${esc(f.message)}</p>`; return; }
      facts = f; render();
    } catch (err) {
      if (my !== runId) return;
      console.error(err);
      body.innerHTML = `<p class="insp-note insp-warn">This PDF could not be read: ${esc(err.message)}. It may be damaged, or not a standard PDF.</p>`;
    }
  }

  function idmlInfo() {
    try {
      if (typeof state === 'undefined' || !state.scan) return null;
      const r = state.scan.report; const b = r.prefs && r.prefs.bleed && r.prefs.bleed.top != null ? r.prefs.bleed.top : 0;
      return { pageCount: state.scan.pages.length, pageSizes: r.pageSizes.map(s => ({ widthPt: s.widthPt, heightPt: s.heightPt, count: s.count })), bleedPt: b };
    } catch (e) { return null; }
  }

  /* ---- colours used, in the spirit of a separations list */
  function coloursHtml(res, profile) {
    const CU = PW.colourUI;
    const cols = res.colours.map(c => Object.assign({}, c, { hot: c.kind === 'cmyk' && c.tac != null && profile.maxInk > 0 && c.tac > profile.maxInk + 0.5 }));
    const of = f => cols.filter(f);
    const spot = of(c => c.kind === 'spot'), reg = of(c => c.kind === 'registration'), bad = of(c => c.kind === 'rgb' || c.kind === 'lab');
    const grads = of(c => c.kind === 'gradient'), gray = of(c => c.kind === 'gray');
    const cmyk = of(c => c.kind === 'cmyk').sort((a, b) => (b.hot - a.hot) || b.pages.length - a.pages.length || b.uses - a.uses);
    const group = (title, note, inner) => inner ? `<div class="pf-cgroup"><h4>${title}${note ? ` <span class="insp-note">${note}</span>` : ''}</h4>${inner}</div>` : '';
    const shown = cmyk.slice(0, 16), more = cmyk.slice(16);
    const imgRows = res.imageColour.map(x => `<li class="pf-imgrow${x.family === 'RGB' || x.family === 'Lab' ? ' is-problem' : ''}"><b>${esc(x.family === 'Spot' ? 'Spot / DeviceN' : x.family)}</b><span>${num(x.placements)} placement${x.placements === 1 ? '' : 's'} of ${num(x.images)} image${x.images === 1 ? '' : 's'} · ${num(x.pages.length)} page${x.pages.length === 1 ? '' : 's'}</span></li>`).join('');
    const blend = res.blend; const blendTxt = blend.rgb ? `RGB on ${num(blend.rgb)} page${blend.rgb === 1 ? '' : 's'}` : blend.cmyk ? `CMYK on ${num(blend.cmyk)} page${blend.cmyk === 1 ? '' : 's'}` : 'not set';
    return `<section class="pf-colours"><h3>Colours used</h3>
      <p class="insp-note">Every colour actually painted in text and artwork, listed the way a separations check would. Swatches are on-screen approximations; the printed colour depends on the press and paper.</p>
      ${group('Spot colours', 'print as their own plates', spot.length ? CU.list(spot, { pageButtons: 8 }) : '')}
      ${group('Registration', 'prints on every plate', reg.length ? CU.list(reg, { pageButtons: 8 }) : '')}
      ${group('RGB and Lab', 'not print colours', bad.length ? CU.list(bad.map(c => Object.assign({}, c, { problem: !profile.allowRgb })), { pageButtons: 8 }) : '')}
      ${group('Gradients', '', grads.length ? CU.list(grads.map(c => Object.assign({}, c, { problem: c.family === 'RGB' && !profile.allowRgb })), { pageButtons: 6 }) : '')}
      ${group(`CMYK builds (${num(cmyk.length)})`, profile.maxInk ? `over ${profile.maxInk}% total ink are marked` : '', cmyk.length ? CU.list(shown, { pageButtons: 0 }) + (more.length ? `<details class="pf-more"><summary>${num(more.length)} more builds</summary>${CU.list(more, { pageButtons: 0 })}</details>` : '') : '')}
      ${group('Grays', '', gray.length ? CU.list(gray, { pageButtons: 0 }) : '')}
      ${group('Images', 'by colour space', imgRows ? `<ul class="pf-imglist">${imgRows}</ul>` : '')}
      <p class="insp-note">Page blending space: <b>${esc(blendTxt)}</b>. Image ink and image content are not measured.</p></section>`;
  }
  function pageMapHtml(res, count) {
    const f = res.pageFlags; if (!f.some(x => x.rgb || x.spot || x.reg)) return '<section class="pf-map"><h3>Page map</h3><p class="insp-note">No page has spot colour, registration or RGB on it.</p></section>';
    const cell = (x, i) => { const cls = x.reg ? 'pm-reg' : x.rgb ? 'pm-rgb' : x.spot ? 'pm-spot' : ''; const why = [x.spot && 'spot colour', x.rgb && 'RGB', x.reg && 'registration colour'].filter(Boolean).join(', '); return `<button type="button" class="pm ${cls}" data-page="${i + 1}" title="Page ${i + 1}${why ? ': ' + why : ''}">${i + 1}</button>`; };
    return `<section class="pf-map"><h3>Page map</h3><p class="insp-note">Every page at a glance. Click a page to open it.</p>
      <div class="pm-legend"><span class="pm pm-spot">spot</span><span class="pm pm-rgb">RGB</span><span class="pm pm-reg">registration</span><span class="pm">clear</span></div>
      <div class="pm-grid">${f.map(cell).join('')}</div></section>`;
  }

  function render() {
    if (!facts) return;
    const profile = PW.printcheck.loadProfile();
    result = PW.preflight.evaluate(facts, profile, idmlInfo());
    const s = result.summary; const body = $('#pfBody');
    const verdict = s.error ? { cls: 'bad', head: `${s.error} problem${s.error === 1 ? '' : 's'} to fix before this goes to print`, sub: s.warn ? `plus ${s.warn} thing${s.warn === 1 ? '' : 's'} to check.` : '' }
      : s.warn ? { cls: 'warn', head: `${s.warn} thing${s.warn === 1 ? '' : 's'} to check`, sub: 'Nothing blocking was found, but these may matter to your printer.' }
        : { cls: 'ok', head: 'Nothing found with these settings', sub: 'That is not a guarantee. Your printer\u2019s own preflight has the final word.' };
    const media = facts.pages[0] ? (facts.pages[0].trim || facts.pages[0].media) : null;
    const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const real = facts.placements.filter(p => !p.mask && !p.softMask);
    const facts_ = [fact('Pages', num(facts.pageCount) + (media ? ' · ' + (media.w / MM).toFixed(1) + ' × ' + (media.h / MM).toFixed(1) + ' mm' : '')),
      fact('Fonts', num(new Set(facts.fonts.map(f => f.name)).size)), fact('Images', num(facts.images.filter(i => !i.mask).length) + ' (' + num(real.length) + ' placed)'),
      fact('Colours', num(facts.colours.length) + (facts.spots.length ? ' · ' + num(facts.spots.length) + ' spot' : '')),
      fact('File', (fileInfo.size / 1e6).toFixed(1) + ' MB' + (facts.meta.version ? ' · PDF ' + esc(facts.meta.version) : '')),
      facts.meta.producer ? fact('Made with', esc(facts.meta.producer)) : ''].join('');
    const item = f => {
      const pages = f.pages.length ? `<div class="pf-pages">${f.pages.slice(0, 14).map(p => `<button type="button" class="mini-btn" data-page="${p + 1}">p.${p + 1}</button>`).join('')}${f.pages.length > 14 ? `<span class="insp-note">…and ${num(f.pages.length - 14)} more</span>` : ''}</div>` : '';
      const thumbs = (f.level === 'error' || f.level === 'warn') && f.pages.length ? `<div class="pf-thumbs" data-pages="${f.pages.slice(0, 3).join(',')}"></div>` : '';
      return `<li class="pf-item pf-${f.level}"><div class="pc-head"><span class="lvl lvl-${f.level}">${LABEL[f.level]}</span><b>${esc(f.title)}</b>${f.pages.length ? `<span class="pc-count">${num(f.pages.length)} page${f.pages.length === 1 ? '' : 's'}</span>` : ''}</div><p class="insp-note">${esc(f.detail)}</p>${pages}${thumbs}</li>`;
    };
    const attention = result.findings.filter(f => f.level !== 'pass'), passed = result.findings.filter(f => f.level === 'pass');
    body.innerHTML = `<div class="pf-verdict pf-v-${verdict.cls}"><h3>${esc(verdict.head)}</h3><p>${esc(verdict.sub)}</p></div>
      <dl class="insp-facts pf-facts">${facts_}</dl>
      ${attention.length ? `<ul class="pf-list">${attention.map(item).join('')}</ul>` : ''}
      ${coloursHtml(result, profile)}
      ${pageMapHtml(result, facts.pageCount)}
      ${passed.length ? `<details class="pf-passed"><summary>${passed.length} check${passed.length === 1 ? '' : 's'} passed</summary><ul class="pf-list">${passed.map(item).join('')}</ul></details>` : ''}
      <p class="insp-note"><b>Checked:</b> page size, trim and bleed boxes, font embedding, image colour and resolution, RGB in text and artwork, spot colours, PDF/X. <b>Not checked:</b> total ink coverage, overprint and trapping, transparency flattening, and how the images actually look. Your printer\u2019s own preflight has the final word.</p>
      <div class="insp-actions"><button id="pfCopyBtn" class="ghost" type="button">Copy summary</button> <button id="pfJsonBtn" class="ghost" type="button">Download report (JSON)</button></div>`;
    body.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { if (typeof state !== 'undefined' && state.pdfDoc && typeof openPdfPage === 'function') openPdfPage(Number(b.dataset.page)); });
    $('#pfCopyBtn').onclick = copySummary; $('#pfJsonBtn').onclick = downloadJson;
    drawThumbs();
  }

  // Small page images next to each problem, drawn with PDF.js when it is available.
  async function drawThumbs() {
    const token = ++thumbToken;
    if (typeof state === 'undefined' || !state.pdfDoc) return;
    for (const box of document.querySelectorAll('#pfBody .pf-thumbs')) {
      for (const p of box.dataset.pages.split(',').map(Number)) {
        if (token !== thumbToken) return;
        try {
          const page = await state.pdfDoc.getPage(p + 1); const base = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 110 / Math.max(base.width, base.height) });
          const wrap = document.createElement('figure'); wrap.className = 'pf-thumb'; const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          wrap.appendChild(c); const cap = document.createElement('figcaption'); cap.textContent = 'p.' + (p + 1); wrap.appendChild(cap); box.appendChild(wrap);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        } catch (e) { /* thumbnails are optional */ }
      }
    }
  }
  function thumbsReady() { if (facts) drawThumbs(); }

  function summaryText() {
    const p = result.profile; const lines = [`PDF preflight: ${fileInfo.name}`, `Profile: bleed ${p.bleedMm} mm, ${p.minPpi} ppi minimum, RGB ${p.allowRgb ? 'accepted' : 'not accepted'}`, ''];
    for (const f of result.findings) if (f.level !== 'pass') lines.push(`[${LABEL[f.level].toUpperCase()}] ${f.title}: ${f.detail}${f.pages.length ? ' (pages ' + f.pages.slice(0, 20).map(x => x + 1).join(', ') + (f.pages.length > 20 ? ', \u2026' : '') + ')' : ''}`);
    lines.push('', `Passed: ${result.findings.filter(f => f.level === 'pass').map(f => f.title).join('; ') || 'none'}`, 'Generated by Printworks. Not a substitute for your printer\u2019s own preflight.');
    return lines.join('\n');
  }
  async function copySummary() {
    const btn = $('#pfCopyBtn'); const t = summaryText();
    try { await navigator.clipboard.writeText(t); btn.textContent = 'Copied'; }
    catch (e) { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy summary'; }, 1800);
  }
  function downloadJson() {
    const out = { printworks: '1.7', file: fileInfo.name, profile: result.profile, summary: result.summary, findings: result.findings,
      facts: { pages: facts.pageCount, fonts: facts.fonts.map(f => ({ name: f.name, type: f.type, embedded: f.embedded, subset: f.subset })), images: facts.images.length, placements: facts.placements.length, spots: facts.spots, output: facts.output, meta: facts.meta } };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileInfo.name.replace(/\.pdf$/i, '') + '-preflight.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  document.addEventListener('printworks:profile', () => { if (facts) render(); });
  PW.preflightUI = { start, reset, refresh: render, thumbsReady, get result() { return result; } };
})(typeof window !== 'undefined' ? window : globalThis);
