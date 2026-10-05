/*
 * Runs the IDML model against a real IDML (and optionally its PDF) and prints a report.
 *   cd tests && npm install && node run-model-test.js path/to/file.idml [path/to/file.pdf]
 * The PDF text check needs `pdftotext` (poppler) on PATH; it is skipped otherwise.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const idml = require('../js/idml-model.js');

idml.setParser(() => new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(e) { throw new Error(e); } } }));

(async () => {
  const [idmlPath, pdfPath] = process.argv.slice(2);
  if (!idmlPath) { console.error('usage: node run-model-test.js file.idml [file.pdf]'); process.exit(1); }
  const zip = await JSZip.loadAsync(fs.readFileSync(idmlPath));
  const text = async p => { const f = zip.file(p); return f ? f.async('string') : ''; };
  let t = Date.now();
  const doc = await idml.load(text);
  const scan = await idml.scan(doc);
  const r = scan.report;
  console.log('scan time ms:', Date.now() - t);
  console.log(JSON.stringify({ pages: r.pages, spreads: r.spreads, masters: r.masterSpreads, pageSizes: r.pageSizes.map(s => s.widthMm.toFixed(1) + 'x' + s.heightMm.toFixed(1) + 'mm x' + s.count),
    frames: r.frames, support: r.support, stories: r.stories, art: r.art, text: r.text, layers: r.layers }, null, 1));
  console.log('FONTS'); for (const f of r.fonts) console.log(' ', f.family, '/', f.style, f.chars, 'chars', 'override', f.viaOverride, f.status || '');
  console.log('WARNINGS'); for (const w of r.warnings) console.log(' ', w.level, w.code, '-', w.message);

  if (pdfPath) {
    try {
      const out = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 1 << 28 }).toString();
      const pages = out.split('\f'); pages.pop();
      const cmp = idml.compareWithPdf(scan, pages);
      console.log('PDF CHECK', JSON.stringify(cmp.summary), 'pdfPages', cmp.pdfPages, 'idmlPages', cmp.idmlPages);
      for (const row of cmp.rows.filter(x => x.status !== 'ok' && x.status !== 'no-text')) console.log('  page', row.pageName, row.status, row.frames.map(f => f.id + ' missing[' + f.missing.join(',') + '] trailing=' + f.trailing).join('; '));
    } catch (e) { console.log('PDF check skipped:', e.message.split('\n')[0]); }
  }
})().catch(e => { console.error(e); process.exit(1); });
