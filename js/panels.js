/*
 * Printworks panels (v1.7): font map, print checks, verified export.
 * UI glue only. The work is done by PW.fontmap and PW.printcheck.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => Number(n).toLocaleString();
  const STYLE_SUGGESTIONS = ['Regular', 'Italic', 'Bold', 'Bold Italic', 'Semibold', 'Semibold Italic', 'Medium', 'Light', 'Light Italic', 'ExtraLight', 'Black', 'Condensed', 'Bold Condensed'];
  const BOLDISH = /bold|black|heavy|semibold|demi|extrabold/i;

  let ctx = null, entries = new Map(), rows = [], lastUrl = null, checkTimer = null;

  /* -------------------------------------------------------------- lifecycle */
  function reset() {
    ctx = null; entries = new Map(); rows = [];
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
    const sec = $('#fontMapSection'); if (sec) sec.classList.add('hidden');
    const rep = $('#fmReport'); if (rep) rep.innerHTML = '';
  }

  function onScan(c) {
    reset(); ctx = c; rows = c.scan.report.fonts.slice();
    const sec = $('#fontMapSection'); if (!sec) return;
    sec.classList.remove('hidden');
    buildPresetSelect(); buildDatalists(); renderFontTable(); fileNote(); runChecks(); updateExportButton();
  }

  /* --------------------------------------------------------------- font map */
  const keyOf = (family, style) => PW.fontmap.keyOf(family, style);
  function knownFamilies() {
    const set = new Set();
    for (const f of ctx.doc.fonts) set.add(PW.idml.cleanFontFamily(f.family).toLowerCase());
    for (const f of rows) set.add(f.family.toLowerCase());
    return set;
  }
  function buildDatalists() {
    const fam = new Set(); const mdl = typeof moods !== 'undefined' ? moods : [];
    for (const m of mdl) { fam.add(m.head); fam.add(m.body); fam.add(m.label); }
    for (const f of ctx.doc.fonts) fam.add(PW.idml.cleanFontFamily(f.family));
    $('#fmFamilies').innerHTML = Array.from(fam).filter(Boolean).sort().map(f => `<option value="${esc(f)}">`).join('');
    $('#fmStyles').innerHTML = STYLE_SUGGESTIONS.map(s => `<option value="${esc(s)}">`).join('');
  }
  function buildPresetSelect() {
    const mdl = typeof moods !== 'undefined' ? moods : [];
    $('#fmPreset').innerHTML = '<option value="">Fill from a typography direction…</option>' + mdl.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  }
  function renderFontTable() {
    if (!rows.length) { $('#fmTable').innerHTML = '<p class="insp-note">No fonts were found in the text of this file.</p>'; return; }
    const trs = rows.map((f, i) => {
      const k = keyOf(f.family, f.style); const e = entries.get(k) || {};
      const st = f.status === 'NotAvailable' ? '<span class="fstat fstat-bad">missing</span>' : f.status === 'Substituted' ? '<span class="fstat fstat-bad">substituted</span>' : '';
      return `<tr data-i="${i}"><td><b>${esc(f.family)}</b> <span class="fm-style">${esc(f.style)}</span> ${st}</td>
        <td class="r">${num(f.chars)}</td><td class="r">${f.viaOverride ? num(f.viaOverride) : '—'}</td>
        <td><input class="fm-in fm-family" list="fmFamilies" aria-label="New family for ${esc(f.family)} ${esc(f.style)}" placeholder="Keep ${esc(f.family)}" value="${esc(e.family || '')}"></td>
        <td><input class="fm-in fm-fstyle" list="fmStyles" aria-label="New style for ${esc(f.family)} ${esc(f.style)}" placeholder="${esc(f.style)}" value="${esc(e.style || '')}"></td>
        <td class="fm-hint" id="fmHint${i}"></td></tr>`;
    }).join('');
    $('#fmTable').innerHTML = `<div class="insp-scroll"><table class="insp-table fm-table"><thead><tr><th>Font in the file</th><th class="r">Characters</th><th class="r">Set on text</th><th>New family</th><th>New style</th><th></th></tr></thead><tbody>${trs}</tbody></table></div>
      <p class="insp-note">Leave a row blank to keep that font. If you only type a family, the original style name is kept. A direction fills bold fonts with its heading font and the rest with its body font; treat that as a starting point and adjust each row. Names must match what InDesign shows for the installed font.</p>`;
    $('#fmTable').querySelectorAll('tr[data-i]').forEach(tr => {
      const i = Number(tr.dataset.i); const f = rows[i];
      const fam = tr.querySelector('.fm-family'), sty = tr.querySelector('.fm-fstyle');
      const onEdit = () => {
        const k = keyOf(f.family, f.style);
        if (fam.value.trim()) entries.set(k, { family: fam.value.trim(), style: sty.value.trim() || f.style }); else entries.delete(k);
        updateHint(i); scheduleChecks(); updateExportButton(); clearReport();
      };
      fam.oninput = sty.oninput = onEdit; updateHint(i);
    });
  }
  function updateHint(i) {
    const f = rows[i]; const e = entries.get(keyOf(f.family, f.style)); const el = $('#fmHint' + i); if (!el) return;
    if (!e) { el.textContent = ''; return; }
    el.innerHTML = knownFamilies().has(PW.idml.cleanFontFamily(e.family).toLowerCase()) ? '' : '<span class="fm-warn" title="This family is not in the file\u2019s font list. Check it is installed in InDesign with exactly this name and style.">not in this file</span>';
  }
  function applyPreset(id) {
    const mdl = typeof moods !== 'undefined' ? moods : []; const m = mdl.find(x => x.id === id); if (!m) return;
    entries = new Map();
    for (const f of rows) {
      const bold = BOLDISH.test(f.style);
      const spec = bold ? { family: m.head, style: m.headStyle.style } : { family: m.body, style: m.bodyStyle.style };
      entries.set(keyOf(f.family, f.style), spec);
    }
    renderFontTable(); runChecks(); updateExportButton(); clearReport();
  }
  const currentMap = () => PW.fontmap.makeMap(rows.map(f => ({ from: { family: f.family, style: f.style }, to: entries.get(keyOf(f.family, f.style)) })).filter(x => x.to));
  function updateExportButton() { const b = $('#fmExportBtn'); if (b) b.disabled = currentMap().size === 0; }
  function clearReport() { $('#fmReport').innerHTML = ''; if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; } }

  /* ------------------------------------------------------------ print checks */
  function fileNote() {
    const pr = ctx.scan.report.prefs; const MM = 72 / 25.4;
    const b = pr && pr.bleed && pr.bleed.top != null ? pr.bleed.top / MM : null;
    const pg = ctx.scan.pages[0]; const mg = pg && pg.margins ? pg.margins.top / MM : null;
    if (PW.profileUI) PW.profileUI.setFileNote('IDML: bleed ' + (b != null ? b.toFixed(1) + ' mm' : 'not set') + ', page margins ' + (mg != null ? mg.toFixed(1) + ' mm' : 'not set') + '.');
  }
  function scheduleChecks() { clearTimeout(checkTimer); checkTimer = setTimeout(runChecks, 200); }
  function runChecks() {
    if (!ctx) return;
    const profile = PW.printcheck.loadProfile();
    const map = currentMap(); const res = PW.printcheck.run(ctx.doc, ctx.scan, profile, map);
    const li = i => `<li><div class="pc-head"><span class="lvl lvl-${i.level}">${i.level === 'warn' ? 'check' : 'note'}</span><b>${esc(i.title)}</b><span class="pc-count">${num(i.frames)} frame${i.frames === 1 ? '' : 's'}${i.chars ? ' · ' + num(i.chars) + ' characters' : ''}</span></div>
      <p class="insp-note">${esc(i.help)}</p>
      <ul class="pc-ex">${i.examples.map(e => `<li><button type="button" class="mini-btn" data-goto="${e.pageIndex}">Page ${esc(e.pageName)}</button> <span>${esc(e.detail)}</span> <span class="pc-text">${esc(e.text)}</span></li>`).join('')}</ul>
      ${i.frames > i.examples.length ? `<p class="insp-note">…and ${num(i.frames - i.examples.length)} more.</p>` : ''}</li>`;
    $('#pcResults').innerHTML = `<p class="insp-bar-legend">${res.usedFontMap ? 'Checking with <b>your new fonts</b>' : 'Checking with the <b>current fonts</b>'} · ${num(res.framesChecked)} text frames on ${num(ctx.scan.pages.length)} pages.</p>
      ${res.problems.length ? `<ul class="pc-list">${res.problems.map(li).join('')}</ul>` : '<p class="insp-note">No size, weight or ink problems found with these settings.</p>'}
      ${res.notes.length ? `<ul class="pc-list">${res.notes.map(li).join('')}</ul>` : ''}
      ${res.clear.length ? `<p class="insp-note">Nothing found for: ${esc(res.clear.join('; '))}.</p>` : ''}`;
    $('#pcResults').querySelectorAll('[data-goto]').forEach(b => b.onclick = () => PW.inspector && PW.inspector.goToPage(Number(b.dataset.goto), true));
    if (PW.inspector && PW.inspector.refresh) PW.inspector.refresh();
  }

  /* ------------------------------------------------------------------ export */
  async function exportFontMap() {
    const map = currentMap(); if (!map.size || !ctx) return;
    const btn = $('#fmExportBtn'); const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Building and checking…'; clearReport();
    try {
      const st = ctx.state; const cache = new Map([['designmap.xml', st.designMap], ['Resources/Styles.xml', st.stylesXml]]);
      for (const s of st.stories) cache.set(s.name, s.text);
      const read = async p => (cache.has(p) ? cache.get(p) : (st.zip.file(p) ? st.zip.file(p).async('string') : ''));
      const { changes, stats } = await PW.fontmap.rewritePackage(read, ctx.doc, map);
      const v = await PW.fontmap.verify(read, changes, ctx.doc, map);
      const blob = await root.writeValidIdml(new root.JSZip(), st.zip, async (name, xml) => (changes.has(name) ? changes.get(name) : xml));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const pkg = PW.fontmap.checkPackageBytes(bytes);
      lastUrl = URL.createObjectURL(blob);
      renderReport({ stats, v, pkg, map, name: st.file.name.replace(/\.idml$/i, '') + '-printworks-fontmap.idml', total: ctx.scan.report.text.chars });
    } catch (err) {
      console.error(err);
      $('#fmReport').innerHTML = `<p class="insp-note insp-warn">Could not create the IDML: ${esc(err.message)}</p>`;
    } finally { btn.textContent = label; updateExportButton(); }
  }

  function renderReport(r) {
    const { v, pkg, stats } = r; const ok = v.ok && pkg.ok;
    const line = (good, text) => `<li class="${good ? 'ok' : 'bad'}"><span class="mark">${good ? 'Pass' : 'Fail'}</span><span>${text}</span></li>`;
    const targets = Array.from(r.map.values()).map(t => t.family + ' ' + t.style);
    const unknown = Array.from(new Set(Array.from(r.map.values()).map(t => t.family).filter(f => !knownFamilies().has(PW.idml.cleanFontFamily(f).toLowerCase()))));
    $('#fmReport').innerHTML = `<div class="rep ${ok ? 'rep-ok' : 'rep-bad'}">
      <h3>${ok ? 'Checked and ready to open in InDesign' : 'Do not use this file: a check failed'}</h3>
      <p>${num(v.runs.changed)} of ${num(v.runs.total)} text runs (${num(v.runs.chars)} characters) now use the new fonts. ${num(stats.styles)} style${stats.styles === 1 ? '' : 's'} updated${stats.csr + stats.psr ? ', and ' + num(stats.csr + stats.psr) + ' range' + (stats.csr + stats.psr === 1 ? '' : 's') + ' of text where the font was set directly' : ''}${stats.pinned ? '; ' + num(stats.pinned) + ' held at their original font so they did not change by inheritance' : ''}.</p>
      <ul class="rep-list">
        ${line(v.onlyFontSettingsChanged, `Only font family and style changed. ${num(v.changedFiles)} file${v.changedFiles === 1 ? '' : 's'} edited; every other file in the package is identical.${v.offenders.length ? ' Problem: ' + esc(v.offenders.slice(0, 3).join(', ')) : ''}`)}
        ${line(v.textUnchanged && v.structureSame, 'Text, paragraphs and ranges are unchanged. Spreads, frames and positions were not touched.')}
        ${line(v.mismatches.length === 0, v.mismatches.length ? num(v.mismatches.length) + ' run(s) would not get the intended font.' : 'Every text run resolves to the font you chose (or keeps its original).')}
        ${line(pkg.ok, 'Package follows the IDML rules: the <code>mimetype</code> entry comes first and is stored uncompressed.')}
      </ul>
      <p class="insp-note">Sizes, leading, colours, tracking, spacing, layers and dielines were not touched.</p>
      <p class="insp-note"><b>Before opening in InDesign:</b> install ${targets.length === 1 ? 'this font' : 'these fonts'} with exactly ${targets.length === 1 ? 'this name and style' : 'these names and styles'}: ${esc(targets.join('; '))}.${unknown.length ? ' Not in this file\u2019s font list: <b>' + esc(unknown.join(', ')) + '</b>.' : ''} A missing or differently named font appears as a pink substitution.</p>
      ${ok ? `<a class="primary rep-dl" href="${lastUrl}" download="${esc(r.name)}">Download revised IDML</a>` : ''}
    </div>`;
  }

  /* -------------------------------------------------------------------- init */
  function init() {
    const sel = $('#fmPreset'); if (!sel) return;
    sel.onchange = () => { if (sel.value) applyPreset(sel.value); sel.value = ''; };
    $('#fmClear').onclick = () => { entries = new Map(); renderFontTable(); runChecks(); updateExportButton(); clearReport(); };
    $('#fmExportBtn').onclick = exportFontMap;
    document.addEventListener('printworks:profile', scheduleChecks);
    const ep = $('#pcEditProfile');
    if (ep) ep.onclick = () => { const d = $('#profileSection'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  }
  document.addEventListener('DOMContentLoaded', init);

  PW.panels = { onScan, reset, runChecks, currentMap };
})(typeof window !== 'undefined' ? window : globalThis);
