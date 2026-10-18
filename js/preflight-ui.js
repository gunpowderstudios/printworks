/*
 * Printworks PDF preflight UI (v1.9)
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
  const ICON = { error: '\u2717', warn: '!', info: 'i', pass: '\u2713' };
  const MM = 72 / 25.4;


  /* Plain steps for fixing each kind of finding, in InDesign terms. */
  const FIX = {
    'page-size': ['Check the page sizes in Pages panel > Page Size. Mixed sizes are fine for a rulebook with a cover, but not for a card sheet.', 'If one page is wrong, fix it in the InDesign file and export again.'],
    bleed: ['In InDesign, File > Document Setup > Bleed and Slug. Set Bleed to the amount your printer asks for (usually 3 mm) on all four sides.', 'Extend backgrounds and images out to the red bleed line.', 'File > Export > Adobe PDF (Print). Under Marks and Bleeds tick Use Document Bleed Settings.', 'Check the PDF again here.'],
    fonts: ['Open the export dialog: File > Export > Adobe PDF (Print) > Advanced. Set Subset fonts below 100%.', 'If a font still will not embed, its licence may forbid it. Use a different font or convert that text to outlines (Type > Create Outlines) on a copy.'],
    'fonts-type3': ['Type 3 fonts usually come from old or odd font formats. Replace the font with an OpenType or TrueType version, or outline the text on a copy of the file.'],
    'image-rgb': ['Best: Window > Links to find the RGB images, convert them to CMYK in Photoshop (Edit > Convert to Profile) and relink.', 'Or leave them and export with Compatibility: PDF/X-4 and Colour Conversion set to Convert to Destination, using your printer’s profile. Ask the printer which they prefer.', 'Export and check again.'],
    'vector-rgb': ['Window > Colour > Swatches: look for swatches with a small RGB icon. Delete them or change their Colour Mode to CMYK.', 'Check any colour you picked in a placed Illustrator or SVG file.', 'Export and check again.'],
    'gradient-rgb': ['Open the Gradient swatch. Make sure each colour stop is a CMYK swatch, not RGB.', 'Gradients inside placed Illustrator files need fixing in Illustrator (File > Document Colour Mode > CMYK).'],
    'blend-rgb': ['Edit > Transparency Blend Space > Document CMYK, then export again.'],
    'colour-lab': ['Replace Lab swatches with CMYK ones, or convert them in the placed file.'],
    spot: ['If the job is CMYK only: Swatches panel > double-click each Pantone swatch > change Colour Type to Process and Colour Mode to CMYK. Or Swatches menu > Ink Manager > tick All Spots to Process.', 'If the job does use a spot colour, tick “This job uses spot colours” in the printer profile above and leave it.', 'Export and check again. Pantone colours in placed PDFs or Illustrator files need converting in those files.'],
    registration: ['Find objects filled with the [Registration] swatch. Select one, then Edit > Select Similar, or look at the Swatches panel for the black swatch with the cross.', 'Change it to a real colour such as C0 M0 Y0 K100. Keep [Registration] for crop marks only.', 'If you want marks, export with Marks and Bleeds > Crop Marks, which uses it correctly.'],
    'total-ink': ['Lower the darkest CMYK builds below your limit, for example turn C75 M68 Y67 K90 rich black into a build that totals 300% or less.', 'Or send the file to the printer’s profile with Convert to Destination, which limits ink for you.'],
    overprint: ['Usually nothing. InDesign overprints 100% black by default, which is good for black text.', 'If a white or coloured object disappears in print, select it and untick Window > Output > Attributes > Overprint Fill.'],
    'image-ppi': ['Window > Links shows the effective ppi of each image. Replace the low ones with higher resolution versions, or shrink them in the layout.', 'Do not just upsize in Photoshop, as that does not add detail.'],
    pdfx: ['Only if your printer asks for it: File > Export > Adobe PDF (Print) > Standard: PDF/X-1a:2001 or PDF/X-4.'],
    'idml-pages': ['The PDF and IDML are probably from different versions. Export a fresh PDF from the current InDesign file.'],
    'idml-size': ['Check Document Setup in InDesign against the PDF trim size, then export again.']
  };
  const fixHtml = f => FIX[f.id] && f.level !== 'pass' ? `<details class="pf-fix"><summary>How to fix it</summary><ol>${FIX[f.id].map(t => `<li>${esc(t)}</li>`).join('')}</ol></details>` : '';
  const NEXT = ['Fix the artwork in your InDesign file, using the steps under each item.', 'Export a new PDF with the same export preset as before.', 'Drop the new PDF in here again and check the list is clear.', 'When it passes, commit the InDesign file, the PDF and this report to your repo (for example: git add . && git commit -m "Artwork v2, preflight clean" && git push), so each print run has its own record.'];
  const nextHtml = () => `<details class="pf-next"><summary>What to do next</summary><ol>${NEXT.map(t => `<li>${esc(t)}</li>`).join('')}</ol></details>`;

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
    const group = (title, note, inner, help) => inner ? `<div class="pf-cgroup"><h4>${title}${note ? ` <span class="insp-note">${note}</span>` : ''}</h4>${help ? `<details class="pf-help"><summary>What does this mean?</summary><p>${help}</p></details>` : ''}${inner}</div>` : '';
    const H = {
      spot: 'A printing press lays down colour one layer at a time, like screen-printing a T-shirt with one screen per colour. Normal full-colour printing uses four layers: cyan, magenta, yellow and black (CMYK). A <b>spot colour</b>, such as a Pantone, is a fifth premixed pot of ink with its own extra layer. That costs extra, and if you did not plan for it you may get an unexpected charge or a muddy conversion. Fix: turn it into CMYK in InDesign, unless the job really uses that ink.',
      reg: '<b>Registration</b> is the guide mark that lets the printer line up the layers. Think of tracing paper sheets stacked on top of each other, each with a cross in the same place: if the crosses sit on top of each other, the layers are lined up. Registration is a special colour that prints on <b>all</b> the layers at once, so the marks can be matched. It is right on crop marks and targets outside your cut line. It is wrong on your artwork or text, because that would print as all four inks at full strength, a thick muddy black with fuzzy edges.',
      rgb: 'RGB is how screens make colour with light. Printers cannot print it, so they convert it to CMYK, and bright screen colours (vivid blues and greens especially) can come out duller than you expected. Convert it yourself so you see the result first.',
      grad: 'A gradient fades from one colour to another. If the colours are RGB, the printer has to convert them, and the smooth fade can shift or band.',
      cmyk: 'Each line is a recipe, for example C0 M0 Y0 K100 means black ink only at full strength. The percentage on the right is the <b>total ink</b>, all four layers added together. Paper can only hold so much wet ink (around 300% for most presses). Too much and it smudges, dries slowly or sets off on the next sheet. Rich blacks are the usual culprit. Items over your limit are marked.',
      gray: 'Grays made from black ink only. These are fine, and the safest way to print neutral gray without a colour cast.'
    };
    const shown = cmyk.slice(0, 16), more = cmyk.slice(16);
    const imgRows = res.imageColour.map(x => `<li class="pf-imgrow${x.family === 'RGB' || x.family === 'Lab' ? ' is-problem' : ''}"><b>${esc(x.family === 'Spot' ? 'Spot / DeviceN' : x.family)}</b><span>${num(x.placements)} placement${x.placements === 1 ? '' : 's'} of ${num(x.images)} image${x.images === 1 ? '' : 's'} · ${num(x.pages.length)} page${x.pages.length === 1 ? '' : 's'}</span></li>`).join('');
    const blend = res.blend; const blendTxt = blend.rgb ? `RGB on ${num(blend.rgb)} page${blend.rgb === 1 ? '' : 's'}` : blend.cmyk ? `CMYK on ${num(blend.cmyk)} page${blend.cmyk === 1 ? '' : 's'}` : 'not set';
    return `<section class="pf-colours"><h3>Colours used</h3>
      <p class="insp-note">Every colour actually painted in text and artwork, listed the way a separations check would. Swatches are on-screen approximations; the printed colour depends on the press and paper.</p>
      <details class="pf-help"><summary>How to read this section</summary><p>Think of printing as stacking transparent sheets, one per ink. Normal colour printing uses four sheets: cyan, magenta, yellow and black. This list tells you every colour recipe in your file and whether it needs any <b>extra</b> sheets (spot colours), uses the wrong kind of colour for print (RGB), or would put too much ink on the paper. If a colour sits in the top groups it is worth a look. If it is only in the CMYK builds, it is normal.</p></details>
      ${group('Spot colours', 'print as their own plates', spot.length ? CU.list(spot, { pageButtons: 8 }) : '', H.spot)}
      ${group('Registration', 'prints on every plate', reg.length ? CU.list(reg, { pageButtons: 8 }) : '', H.reg)}
      ${group('RGB and Lab', 'not print colours', bad.length ? CU.list(bad.map(c => Object.assign({}, c, { problem: !profile.allowRgb })), { pageButtons: 8 }) : '', H.rgb)}
      ${group('Gradients', '', grads.length ? CU.list(grads.map(c => Object.assign({}, c, { problem: c.family === 'RGB' && !profile.allowRgb })), { pageButtons: 6 }) : '', H.grad)}
      ${group(`CMYK builds (${num(cmyk.length)})`, profile.maxInk ? `over ${profile.maxInk}% total ink are marked` : '', cmyk.length ? CU.list(shown, { pageButtons: 0 }) + (more.length ? `<details class="pf-more"><summary>${num(more.length)} more builds</summary>${CU.list(more, { pageButtons: 0 })}</details>` : '') : '', H.cmyk)}
      ${group('Grays', '', gray.length ? CU.list(gray, { pageButtons: 0 }) : '')}
      ${group('Images', 'by colour space', imgRows ? `<ul class="pf-imglist">${imgRows}</ul>` : '')}
      <p class="insp-note">Page blending space: <b>${esc(blendTxt)}</b>. Image ink and image content are not measured.</p></section>`;
  }
  function pageMapHtml(res, count) {
    const f = res.pageFlags; const badPages = new Set(); for (const x of res.findings) if (x.level === 'error' || x.level === 'warn') for (const q of x.pages) badPages.add(q);
    const cell = (x, i) => { const cls = x.reg ? 'pm-reg' : x.rgb ? 'pm-rgb' : x.spot ? 'pm-spot' : badPages.has(i) ? 'pm-bad' : 'pm-ok'; const why = [x.spot && 'spot colour', x.rgb && 'RGB', x.reg && 'registration colour', !x.spot && !x.rgb && !x.reg && badPages.has(i) && 'see the problems above'].filter(Boolean).join(', '); return `<button type="button" class="pm ${cls}" data-page="${i + 1}" title="Page ${i + 1}${why ? ': ' + why : ': all good'}">${cls === 'pm-ok' ? '\u2713' : ''}${i + 1}</button>`; };
    return `<section class="pf-map"><h3>Page map</h3><p class="insp-note">Every page at a glance. Click a page to open it and see exactly where any problem is.</p>
      <div class="pm-legend"><span class="pm pm-ok">\u2713 all good</span><span class="pm pm-bad">problem</span><span class="pm pm-spot">spot</span><span class="pm pm-rgb">RGB</span><span class="pm pm-reg">registration</span></div>
      <div class="pm-grid">${f.map(cell).join('')}</div></section>`;
  }

  function render() {
    if (!facts) return;
    const profile = PW.printcheck.loadProfile();
    result = PW.preflight.evaluate(facts, profile, idmlInfo());
    const s = result.summary; const body = $('#pfBody');
    const verdict = s.error ? { cls: 'bad', head: `${s.error} problem${s.error === 1 ? '' : 's'} to fix before this goes to print`, sub: s.warn ? `plus ${s.warn} thing${s.warn === 1 ? '' : 's'} to check.` : '' }
      : s.warn ? { cls: 'warn', head: `${s.warn} thing${s.warn === 1 ? '' : 's'} to check`, sub: 'Nothing blocking was found, but these may matter to your printer.' }
        : { cls: 'ok', head: 'All good!', sub: 'That is not a guarantee. Your printer\u2019s own preflight has the final word.' };
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
      return `<li class="pf-item pf-${f.level}"><div class="pc-head"><span class="lvl lvl-${f.level}"><i class="ico ico-${f.level}">${ICON[f.level]}</i>${LABEL[f.level]}</span><b>${esc(f.title)}</b>${f.pages.length ? `<span class="pc-count">${num(f.pages.length)} page${f.pages.length === 1 ? '' : 's'}</span>` : ''}</div><p class="insp-note">${esc(f.detail)}</p>${fixHtml(f)}${pages}${thumbs}</li>`;
    };
    const attention = result.findings.filter(f => f.level !== 'pass'), passed = result.findings.filter(f => f.level === 'pass');
    body.innerHTML = `<div class="pf-verdict pf-v-${verdict.cls}"><h3><i class="ico ico-${verdict.cls === 'bad' ? 'error' : verdict.cls === 'warn' ? 'warn' : 'pass'}">${verdict.cls === 'bad' ? '\u2717' : verdict.cls === 'warn' ? '!' : '\u2713'}</i> ${esc(verdict.head)}</h3><p>${esc(verdict.sub)}</p></div>
      <dl class="insp-facts pf-facts">${facts_}</dl>
      ${attention.length ? `<ul class="pf-list">${attention.map(item).join('')}</ul>${nextHtml()}` : ''}
      ${coloursHtml(result, profile)}
      ${pageMapHtml(result, facts.pageCount)}
      ${passed.length ? `<section class="pf-good"><h3><i class="ico ico-pass">\u2713</i> What is working</h3><ul class="pf-list">${passed.map(item).join('')}</ul></section>` : ''}
      <p class="insp-note"><b>Checked:</b> page size, trim and bleed boxes, font embedding, image colour and resolution, RGB in text and artwork, spot colours, total ink in text and artwork, PDF/X. <b>Not checked:</b> ink coverage inside images, trapping, transparency flattening, and how the images actually look. Your printer\u2019s own preflight has the final word.</p>
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
          wrap.title = 'Open page ' + (p + 1) + ' and show where the problem is'; wrap.onclick = () => { if (typeof openPdfPage === 'function') openPdfPage(p + 1); }; wrap.appendChild(c); const cap = document.createElement('figcaption'); cap.textContent = 'p.' + (p + 1); wrap.appendChild(cap); box.appendChild(wrap);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        } catch (e) { /* thumbnails are optional */ }
      }
    }
  }

  /* ---- page popup: outline what the checker found, in the right place on the page */
  function decoratePage(num, vp) {
    const ov = $('#lightboxOverlay'), lg = $('#lightboxLegend'); if (!ov || !lg || !facts || !result) return;
    ov.innerHTML = ''; lg.innerHTML = '';
    const pi = num - 1, profile = PW.printcheck.loadProfile();
    const pm = PW.preflight.pageMarks(facts, profile, pi); const W = vp.width, H = vp.height;
    const place = (el, box) => { const r = vp.convertToViewportRectangle(box); const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]);
      el.style.left = (x0 / W * 100) + '%'; el.style.top = (y0 / H * 100) + '%'; el.style.width = Math.max(1.2, (x1 - x0)) / W * 100 + '%'; el.style.height = Math.max(1.2, (y1 - y0)) / H * 100 + '%'; ov.appendChild(el); return el; };
    // trim and bleed
    const rect = b => [b.x, b.y, b.x + b.w, b.y + b.h];
    const notes = [];
    if (pm.trim) {
      place(Object.assign(document.createElement('div'), { className: 'lb-box lb-trim', title: 'Trim: where the page is cut' }), rect(pm.trim));
      const need = pm.needBleedPt;
      if (need > 0) {
        const t = pm.trim, bleedRect = [t.x - need, t.y - need, t.x + t.w + need, t.y + t.h + need];
        const ok = pm.bleedPt + 0.05 >= need;
        const el = place(Object.assign(document.createElement('div'), { className: 'lb-box ' + (ok ? 'lb-bleed-ok' : 'lb-bleed-bad'), title: ok ? 'Bleed is at least ' + profile.bleedMm + ' mm' : 'Bleed needed: artwork should reach this line' }), bleedRect);
        const tag = document.createElement('span'); tag.className = 'lb-tag'; tag.textContent = ok ? '\u2713 bleed ' + profile.bleedMm + ' mm' : '\u2717 bleed missing: should reach here'; el.appendChild(tag);
        notes.push(ok ? { level: 'ok', text: 'Bleed is at least ' + profile.bleedMm + ' mm' } : { level: 'error', text: 'Not enough bleed (needs ' + profile.bleedMm + ' mm past the trim)' });
      }
    } else notes.push({ level: 'warn', text: 'No TrimBox in this PDF, so trim and bleed cannot be drawn' });
    // things found on the page
    const items = [];
    pm.marks.forEach((m, i) => {
      const el = document.createElement('div'); el.className = 'lb-mark lb-' + m.level; el.title = m.text; el.dataset.i = i;
      if (m.level !== 'ok') { const tag = document.createElement('span'); tag.className = 'lb-tag'; tag.textContent = (m.level === 'error' ? '\u2717 ' : '! ') + m.text; el.appendChild(tag); }
      place(el, m.box); items.push({ m, el });
    });
    // summary under the page
    const count = lv => pm.marks.filter(m => m.level === lv).length;
    const issueFindings = result.findings.filter(f => (f.level === 'error' || f.level === 'warn') && f.pages.includes(pi));
    const nErr = count('error') + notes.filter(n => n.level === 'error').length, nWarn = count('warn') + notes.filter(n => n.level === 'warn').length, nOk = count('ok') + notes.filter(n => n.level === 'ok').length;
    const allGood = !nErr && !nWarn && !issueFindings.length;
    const group = {}; for (const { m } of items.filter(x => x.m.level !== 'ok')) { const k = m.level + '|' + m.text; group[k] = (group[k] || 0) + 1; }
    const rows = notes.filter(n => n.level !== 'ok').map(n => ({ level: n.level, text: n.text, n: 1 })).concat(Object.entries(group).map(([k, n]) => ({ level: k.split('|')[0], text: k.slice(k.indexOf('|') + 1), n })));
    const covered = new Set(pm.marks.filter(m => m.level !== 'ok').flatMap(m => m.ids || [m.id]));
    for (const f of issueFindings) if (!covered.has(f.id) && !(f.id === 'bleed')) rows.push({ level: f.level, text: f.title + ' (applies to the whole page; no spot to outline)', n: 1 });
    lg.innerHTML = `<div class="lb-verdict ${allGood ? 'is-good' : nErr ? 'is-bad' : 'is-warn'}">${allGood ? '<i class="ico ico-pass">\u2713</i> All good on this page!' : nErr ? `<i class="ico ico-error">\u2717</i> ${nErr} problem${nErr === 1 ? '' : 's'} on this page` + (nWarn ? `, ${nWarn} to check` : '') : `<i class="ico ico-warn">!</i> ${nWarn} thing${nWarn === 1 ? '' : 's'} to check on this page`}${nOk ? ` <span class="lb-okn">\u00b7 ${nOk} OK</span>` : ''}</div>` +
      (rows.length ? `<ul class="lb-list">${rows.map(r => `<li class="lbl-${r.level}"><i class="ico ico-${r.level}">${ICON[r.level]}</i>${esc(r.text)}${r.n > 1 ? ' <b>\u00d7' + r.n + '</b>' : ''}</li>`).join('')}</ul>` : '') +
      `<p class="lb-key"><span class="k k-err"></span>problem <span class="k k-warn"></span>to check <span class="k k-ok"></span>OK <span class="k k-trim"></span>trim line <span class="insp-note">Text is marked at the point where it starts.</span></p>`;
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
    const out = { printworks: '1.8', file: fileInfo.name, profile: result.profile, summary: result.summary, findings: result.findings,
      facts: { pages: facts.pageCount, fonts: facts.fonts.map(f => ({ name: f.name, type: f.type, embedded: f.embedded, subset: f.subset })), images: facts.images.length, placements: facts.placements.length, spots: facts.spots, output: facts.output, meta: facts.meta } };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileInfo.name.replace(/\.pdf$/i, '') + '-preflight.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  document.addEventListener('printworks:profile', () => { if (facts) render(); });
  PW.preflightUI = { start, reset, refresh: render, thumbsReady, decoratePage, get result() { return result; } };
})(typeof window !== 'undefined' ? window : globalThis);
