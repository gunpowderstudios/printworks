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
