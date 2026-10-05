/*
 * Printworks structure inspector (v1.7)
 *
 * Reads the IDML through PW.idml, then shows:
 *   - how ready each text frame is for the upcoming page renderer
 *   - fonts in use (and which ones are set on the text itself)
 *   - findings (missing stories, threading problems, run-level fonts ...)
 *   - a page explorer: wireframe of frames + page -> frame -> story mapping
 *   - a PDF text check that also finds text already cut off in InDesign
 * Everything runs locally in the browser.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => (Math.round(n * 10) / 10).toString();
  const num = n => Number(n).toLocaleString();
  const tick = () => new Promise(r => setTimeout(r, 0));
  const SUPPORT_LABEL = { full: 'Ready', approx: 'Approximate', unsupported: 'Not supported yet' };

  let runId = 0, ctx = null, pdfResult = null, pdfRunning = false, currentPage = 0;

  /* ------------------------------------------------------------ lifecycle */
  function reset() {
    runId++; ctx = null; pdfResult = null; pdfRunning = false; currentPage = 0;
    if (PW.panels) PW.panels.reset();
    const body = $('#inspectorBody'), prog = $('#inspProgress');
    if (body) body.classList.add('hidden');
    if (prog) prog.classList.add('hidden');
  }

  async function start(state) {
    const my = ++runId; pdfResult = null; pdfRunning = false; currentPage = 0; ctx = null;
    if (PW.panels) PW.panels.reset();
    const body = $('#inspectorBody'), prog = $('#inspProgress');
    if (!body || !prog) return;
    body.classList.add('hidden'); prog.classList.remove('hidden');
    const setProgress = (p, label) => {
      $('#inspProgressLabel').textContent = label + '…';
      $('#inspProgressBar').value = Math.round(p * 100);
    };
    setProgress(0, 'Reading document structure');
    try {
      const prefilled = new Map();
      prefilled.set('designmap.xml', state.designMap);
      prefilled.set('Resources/Styles.xml', state.stylesXml);
      for (const s of state.spreads) prefilled.set(s.name, s.text);
      for (const s of state.stories) prefilled.set(s.name, s.text);
      const text = async p => {
        if (prefilled.has(p)) return prefilled.get(p);
        const f = state.zip.file(p); return f ? f.async('string') : '';
      };
      const doc = await PW.idml.load(text);
      const scan = await PW.idml.scan(doc, { onProgress: setProgress });
      if (my !== runId) return;
      ctx = { state, doc, scan };
      state.doc = doc; state.scan = scan;
      prog.classList.add('hidden'); body.classList.remove('hidden');
      render();
      updateFontChips();
      if (PW.panels) PW.panels.onScan(ctx);
      if (PW.preflightUI) PW.preflightUI.refresh();
      if (state.pdfDoc) runPdfCheck();
    } catch (err) {
      if (my !== runId) return;
      console.error(err);
      $('#inspProgressLabel').textContent = 'The structure inspector could not read this file: ' + err.message;
      $('#inspProgressBar').classList.add('hidden');
    }
  }

  function onPdfReady() { if (ctx) runPdfCheck(); }

  /* --------------------------------------------------------------- render */
  function render() {
    const { scan } = ctx; const r = scan.report;
    $('#inspReadiness').innerHTML = readinessHtml(r);
    $('#inspFacts').innerHTML = factsHtml(r);
    $('#inspFonts').innerHTML = fontsHtml(r);
    $('#inspFindings').innerHTML = findingsHtml(r);
    renderColours(r);
    $('#inspPageMax').textContent = String(scan.pages.length);
    const num_ = $('#inspPageNum'); num_.max = String(scan.pages.length); num_.value = '1';
    renderPageExplorer();
    renderPdfPanel();
  }

  function readinessHtml(r) {
    const s = r.support; const total = s.full + s.approx + s.unsupported;
    if (!total) return '<p class="insp-note">This file has no text frames on its pages.</p>';
    const seg = (k, n) => n ? `<i class="seg seg-${k}" style="flex:${n}" title="${SUPPORT_LABEL[k]}: ${n}"></i>` : '';
    const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([why, n]) => `<li>${esc(why)} <b>${num(n)}</b></li>`).join('');
    return `<div class="insp-bar" role="img" aria-label="Frame readiness">${seg('full', s.full)}${seg('approx', s.approx)}${seg('unsupported', s.unsupported)}</div>
      <p class="insp-bar-legend"><b>${num(total)}</b> text frames on pages:
        <span class="lg lg-full">${num(s.full)} ready</span>
        <span class="lg lg-approx">${num(s.approx)} approximate</span>
        <span class="lg lg-unsupported">${num(s.unsupported)} not supported yet</span>
        ${s.skipped ? `<span class="lg">${num(s.skipped)} hidden or off the page, skipped</span>` : ''}</p>
      ${reasons ? `<ul class="insp-reasons">${reasons}</ul>` : ''}`;
  }

  function factsHtml(r) {
    const sizes = r.pageSizes.slice(0, 4).map(s => `${fmt(s.widthMm)} × ${fmt(s.heightMm)} mm${r.pageSizes.length > 1 ? ' (' + s.count + ')' : ''}`).join(', ') + (r.pageSizes.length > 4 ? ', …' : '');
    const rot = Object.entries(r.frames.rotated).filter(([k]) => k !== '0').reduce((n, [, v]) => n + v, 0);
    const vj = Object.entries(r.frames.verticalJustification).filter(([k]) => k !== 'TopAlign').map(([k, v]) => `${v} ${k.replace('Align', '').toLowerCase()}`).join(', ');
    const row = (k, v, dim) => `<div class="${dim ? 'dim' : ''}"><dt>${k}</dt><dd>${v}</dd></div>`;
    const linked = r.art.linked, emb = r.art.embedded;
    return [
      row('Pages', `${num(r.pages)} in ${num(r.spreads)} spread${r.spreads === 1 ? '' : 's'} · ${esc(sizes)}`),
      row('Master pages', num(r.masterSpreads), !r.masterSpreads),
      row('Layers', r.layers.map(l => esc(l.name) + (l.visible ? '' : ' (hidden)')).join(', ') || '—'),
      row('Text frames', `${num(r.frames.total)}${r.frames.nestedInGroup ? ' · ' + num(r.frames.nestedInGroup) + ' inside groups' : ''}`),
      row('Rotated frames', num(rot), !rot),
      row('Vertical alignment', vj || 'all top', !vj),
      row('Threaded frames', num(r.frames.threaded), !r.frames.threaded),
      row('Multi-column frames', num(r.frames.multiColumn), !r.frames.multiColumn),
      row('Non-rectangular frames', num(r.frames.nonRect), !r.frames.nonRect),
      row('Stories', `${num(r.stories.total)} · ${num(r.text.paragraphs)} paragraphs · ${num(r.text.chars)} characters`),
      row('Tables / footnotes / anchored', `${r.stories.withTables} / ${r.stories.withFootnotes} / ${r.stories.withAnchored}`, !(r.stories.withTables || r.stories.withFootnotes || r.stories.withAnchored)),
      row('Placed artwork', r.art.placed ? `${num(r.art.placed)} (${linked ? num(linked) + ' linked' : ''}${linked && emb ? ', ' : ''}${emb ? num(emb) + ' embedded' : ''})` : '0', !r.art.placed),
    ].join('');
  }

  function renderColours(r) {
    const el = $('#inspColours'); if (!el || !PW.colourUI) return;
    const CU = PW.colourUI; const cols = r.colours || [];
    if (!cols.length) { el.innerHTML = '<p class="insp-note">No colours found on objects or text.</p>'; return; }
    const of = f => cols.filter(f); const grp = (t, n, items, pb) => items.length ? `<div class="pf-cgroup"><h4>${t}${n ? ` <span class="insp-note">${n}</span>` : ''}</h4>${CU.list(items, { pageButtons: pb })}</div>` : '';
    el.innerHTML = grp('Spot colours', 'print as their own plates', of(c => c.kind === 'spot'), 6) + grp('Registration', 'prints on every plate', of(c => c.kind === 'registration'), 6)
      + grp('RGB', 'not print colours', of(c => c.kind === 'rgb'), 6) + grp('Gradients', '', of(c => c.kind === 'gradient'), 4)
      + grp('CMYK swatches', 'as used on objects and text', of(c => c.kind === 'cmyk').slice(0, 30), 0)
      + '<p class="insp-note">Swatch colours are on-screen approximations. Colours set only by an object style, and colours inside placed images, are not listed.</p>';
    el.querySelectorAll('[data-page]').forEach(b => b.onclick = () => goToPage(Number(b.dataset.page) - 1, true));
  }

  function fontsHtml(r) {
    if (!r.fonts.length) return '<p class="insp-note">No fonts found in the text.</p>';
    const rows = r.fonts.map(f => {
      const st = f.status === 'NotAvailable' ? '<span class="fstat fstat-bad">missing</span>' : f.status === 'Substituted' ? '<span class="fstat fstat-bad">substituted</span>' : f.status === 'Installed' ? '<span class="fstat">installed</span>' : '';
      return `<tr><td>${esc(f.family)}</td><td>${esc(f.style)}</td><td class="r">${num(f.chars)}</td><td class="r">${f.viaOverride ? num(f.viaOverride) : '—'}</td><td>${st}</td></tr>`;
    }).join('');
    return `<table class="insp-table"><thead><tr><th>Family</th><th>Style</th><th class="r">Characters</th><th class="r">Set on text</th><th>Status at save</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="insp-note">“Set on text” counts characters whose font is applied directly to the text rather than through a style.</p>`;
  }

  function findingsHtml(r) {
    if (!r.warnings.length) return '<p class="insp-note">Nothing unusual found.</p>';
    const order = { error: 0, warn: 1, info: 2 };
    return '<ul class="insp-findings">' + r.warnings.slice().sort((a, b) => order[a.level] - order[b.level]).map(w =>
      `<li><span class="lvl lvl-${w.level}">${w.level === 'warn' ? 'check' : w.level}</span><span>${esc(w.message)}</span></li>`).join('') + '</ul>';
  }

  function updateFontChips() {
    const el = $('#fontList'); if (!el || !ctx) return;
    const list = ctx.scan.report.fonts;
    if (!list.length) return;
    el.innerHTML = list.map(f => {
      const bad = f.status === 'NotAvailable' || f.status === 'Substituted';
      return `<span class="chip${bad ? ' chip-warn' : ''}" title="${esc(f.status || 'status unknown')} · ${num(f.chars)} characters">${esc(f.family)} ${esc(f.style)}</span>`;
    }).join('');
  }

  /* ---------------------------------------------------------- page explorer */
  function frameStyles(f) {
    const { doc, scan } = ctx; const story = scan.stories.get(f.story); if (!story) return [];
    const names = [];
    for (const p of story.paragraphs) {
      const st = doc.styles.para[p.styleId] || doc.styles.para['ParagraphStyle/' + p.styleId];
      const n = st ? st.name : String(p.styleId || '').split('/').pop();
      const clean = String(n || '').replace(/^\$ID\//, '');
      if (clean && !names.includes(clean)) names.push(clean);
    }
    return names;
  }

  function wireframe(pg) {
    const { scan } = ctx; const r = pg.rect;
    const bl = ctx.doc.prefs && ctx.doc.prefs.bleed; const bleedPt = bl && bl.top != null ? bl.top : 0;
    const prof = PW.printcheck ? PW.printcheck.loadProfile() : null; const safePt = prof ? prof.safeMm * 72 / 25.4 : 0;
    const m = Math.max(r.w, r.h) * 0.08 + bleedPt;
    const items = scan.spreads[pg.spreadIndex].items.filter(i => i.pageId === pg.id && i.points);
    const fs = Math.max(3.5, Math.min(r.w, r.h) * 0.07);
    const pts = i => i.points.map(p => fmt(p[0]) + ',' + fmt(p[1])).join(' ');
    let svg = `<svg class="insp-wire" viewBox="${fmt(r.x - m)} ${fmt(r.y - m)} ${fmt(r.w + 2 * m)} ${fmt(r.h + 2 * m)}" role="img" aria-label="Frame layout of page ${esc(pg.name)}">`;
    svg += `<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" class="wire-page"/>`;
    if (bleedPt) svg += `<rect x="${fmt(r.x - bleedPt)}" y="${fmt(r.y - bleedPt)}" width="${fmt(r.w + 2 * bleedPt)}" height="${fmt(r.h + 2 * bleedPt)}" class="wire-bleed"/>`;
    if (safePt && safePt * 2 < Math.min(r.w, r.h)) svg += `<rect x="${fmt(r.x + safePt)}" y="${fmt(r.y + safePt)}" width="${fmt(r.w - 2 * safePt)}" height="${fmt(r.h - 2 * safePt)}" class="wire-safe"/>`;
    for (const i of items) if (i.kind !== 'TextFrame') svg += `<polygon points="${pts(i)}" class="${i.placed && i.placed.length ? 'wire-art' : 'wire-shape'}${i.hidden ? ' wire-hidden' : ''}"/>`;
    const frames = pg.frameIds.map(id => scan.items.get(id));
    frames.forEach((f, idx) => {
      if (!f.points) return;
      svg += `<polygon points="${pts(f)}" class="wire-frame wire-${f.support}${f.hidden ? ' wire-hidden' : ''}" data-frame="${idx}"/>`;
      svg += `<text x="${fmt(f.bbox.x + f.bbox.w / 2)}" y="${fmt(f.bbox.y + f.bbox.h / 2)}" font-size="${fmt(fs)}" class="wire-label" text-anchor="middle" dominant-baseline="central">${idx + 1}</text>`;
    });
    return svg + '</svg><p class="insp-note">Dashed red: bleed from the file. Dashed green: your safe margin.</p>';
  }

  function framesTableHtml(pg) {
    const { scan } = ctx;
    const frames = pg.frameIds.map(id => scan.items.get(id));
    if (!frames.length) return '<p class="insp-note">No text frames on this page.</p>';
    const rows = frames.map((f, i) => {
      const story = scan.stories.get(f.story);
      const snippet = story ? story.text.replace(/\s*\n\s*/g, ' / ').slice(0, 70) : '(story not found)';
      const why = f.supportReasons.length ? ` title="${esc(f.supportReasons.join('; '))}"` : '';
      const pdfRow = pdfResult && pdfResult.rows[pg.index];
      const pdfFrame = pdfRow && pdfRow.frames.find(x => x.id === f.id);
      const cut = pdfFrame ? `<span class="fstat fstat-bad" title="Missing from the PDF: ${esc(pdfFrame.missing.join(' '))}">${pdfFrame.trailing ? 'cut off in original' : 'differs from PDF'}</span>` : '';
      return `<tr><td class="r">${i + 1}</td><td><code>${esc(f.id)}</code></td><td><code>${esc(f.story)}</code></td><td>${esc(frameStyles(f).join(', '))}</td><td class="snip">${esc(snippet)} ${cut}</td><td class="r">${f.matrix.angle ? fmt(f.matrix.angle) + '°' : '—'}</td><td>${esc(String(f.prefs.vj).replace('Align', ''))}</td><td><span class="sup sup-${f.support}"${why}>${SUPPORT_LABEL[f.support]}</span></td></tr>`;
    }).join('');
    return `<div class="insp-scroll"><table class="insp-table"><thead><tr><th class="r">#</th><th>Frame</th><th>Story</th><th>Paragraph styles</th><th>Text</th><th class="r">Angle</th><th>Align</th><th>Readiness</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderPageExplorer() {
    const { scan } = ctx; const pg = scan.pages[currentPage]; if (!pg) return;
    $('#inspPageNum').value = String(currentPage + 1);
    $('#inspPageInfo').textContent = `Page “${pg.name}” · ${fmt(pg.widthMm)} × ${fmt(pg.heightMm)} mm${pg.master ? ' · master ' + pg.master : ''}`;
    $('#inspWire').innerHTML = wireframe(pg);
    $('#inspFrames').innerHTML = framesTableHtml(pg);
  }

  function goToPage(i, scroll) {
    if (!ctx) return;
    currentPage = Math.max(0, Math.min(ctx.scan.pages.length - 1, i));
    renderPageExplorer();
    if (scroll) $('#inspPageExplorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* -------------------------------------------------------------- PDF check */
  async function runPdfCheck() {
    if (!ctx || !ctx.state.pdfDoc || pdfRunning) return;
    pdfRunning = true; const my = runId; const st = ctx.state;
    const el = $('#inspPdf'); const n = st.pdfDoc.numPages;
    try {
      const texts = [];
      for (let i = 1; i <= n; i++) {
        if (my !== runId) return;
        const lines = await root.extractPdfPageText(i); // from app.js (cached per page)
        texts.push(lines.join(' '));
        if (i % 10 === 0 || i === n) { el.innerHTML = `<p class="insp-note">Reading PDF text… ${i} of ${n} pages</p>`; await tick(); }
      }
      if (my !== runId) return;
      pdfResult = PW.idml.compareWithPdf(ctx.scan, texts);
      renderPdfPanel(); renderPageExplorer();
    } catch (err) {
      console.error(err);
      el.innerHTML = `<p class="insp-note">The PDF text check failed: ${esc(err.message)}</p>`;
    } finally { pdfRunning = false; }
  }

  function renderPdfPanel() {
    const el = $('#inspPdf'); if (!el || !ctx) return;
    if (!pdfResult) {
      if (!ctx.state.pdfDoc) el.innerHTML = '<p class="insp-note">Add the matching PDF (button above) and Printworks will check that every frame’s text appears on the right PDF page. It also finds text that is already cut off in InDesign, so those frames are not blamed on a new font later.</p>';
      return;
    }
    const s = pdfResult.summary; const bad = pdfResult.rows.filter(r => r.status === 'overset' || r.status === 'differs' || r.status === 'mismatch');
    const label = { overset: 'text cut off', differs: 'text differs', mismatch: 'page may not match' };
    const rows = bad.map(r => {
      const fr = r.frames.map(f => `<span class="miss"><code>${esc(f.id)}</code> ${f.trailing && f.lastKept ? 'PDF stops after “…' + esc(f.lastKept) + '”;' : ''} missing: ${esc(f.missing.slice(0, 8).join(' '))}</span>`).join('');
      return `<li><button type="button" class="mini-btn" data-goto="${r.pageIndex}">Page ${esc(r.pageName)}</button><span class="sup sup-${r.status === 'overset' ? 'approx' : 'unsupported'}">${label[r.status]}</span>${fr}</li>`;
    }).join('');
    el.innerHTML = `${pdfResult.pageCountMismatch ? `<p class="insp-note insp-warn">The PDF has ${pdfResult.pdfPages} pages but the IDML has ${pdfResult.idmlPages}. Pages are matched by position, so results may be unreliable.</p>` : ''}
      <p class="insp-bar-legend"><b>${num(s.ok)}</b> of ${num(s.checked)} pages with text match the PDF ·
        <span class="lg lg-approx">${num(s.overset)} with text already cut off in InDesign</span>
        ${s.differs ? `<span class="lg lg-unsupported">${num(s.differs)} with other differences</span>` : ''}
        ${s.mismatch ? `<span class="lg lg-unsupported">${num(s.mismatch)} that may not match</span>` : ''}</p>
      ${rows ? `<ul class="insp-pdflist">${rows}</ul>` : ''}`;
    el.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => goToPage(Number(b.dataset.goto), true));
  }

  /* ------------------------------------------------------------- JSON export */
  function exportJson() {
    if (!ctx) return;
    const { scan, state } = ctx; const r = scan.report;
    const out = {
      printworks: '1.5', file: state.file ? state.file.name : '', summary: Object.assign({}, r, { warnings: r.warnings }),
      pdfCheck: pdfResult ? { summary: pdfResult.summary, pages: pdfResult.rows.filter(x => x.status !== 'ok' && x.status !== 'no-text') } : null,
      pages: scan.pages.map(pg => ({
        index: pg.index + 1, name: pg.name, spread: scan.spreads[pg.spreadIndex].id, widthPt: pg.widthPt, heightPt: pg.heightPt, master: pg.master,
        frames: pg.frameIds.map(id => {
          const f = scan.items.get(id); const story = scan.stories.get(f.story);
          return { id: f.id, story: f.story, layer: f.layerName, hidden: f.hidden,
            x: f.bbox ? f.bbox.x - pg.rect.x : null, y: f.bbox ? f.bbox.y - pg.rect.y : null, w: f.bbox ? f.bbox.w : null, h: f.bbox ? f.bbox.h : null,
            angle: f.matrix.angle, verticalJustification: f.prefs.vj, columns: f.prefs.columns, inset: f.prefs.inset,
            threadedTo: f.next, threadedFrom: f.prev, readiness: f.support, reasons: f.supportReasons,
            paragraphStyles: frameStyles(f), text: story ? story.text.slice(0, 300) : null };
        }),
      })),
    };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (state.file ? state.file.name.replace(/\.idml$/i, '') : 'document') + '-structure.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    const prev = $('#inspPagePrev'), next = $('#inspPageNext'), numEl = $('#inspPageNum'), json = $('#inspJsonBtn');
    if (!prev) return;
    prev.onclick = () => goToPage(currentPage - 1);
    next.onclick = () => goToPage(currentPage + 1);
    numEl.onchange = () => goToPage((parseInt(numEl.value, 10) || 1) - 1);
    json.onclick = exportJson;
  }
  document.addEventListener('DOMContentLoaded', init);

  function refresh() { if (ctx) renderPageExplorer(); }

  PW.inspector = { start, reset, onPdfReady, goToPage, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
