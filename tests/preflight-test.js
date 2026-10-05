/*
 * PDF preflight checks.
 *   node preflight-test.js [file.pdf]
 * 1. Builds small PDFs with KNOWN contents and checks the engine finds exactly those facts.
 * 2. If a PDF is given and poppler's `pdfimages`/`pdffonts` are installed, compares the engine's image
 *    placements (page, size, effective ppi) and fonts against poppler's, as independent ground truth.
 */
const fs = require('fs'); const assert = require('assert'); const { execFileSync } = require('child_process');
// PDFLIB_MIN=1 runs against pdf-lib's minified browser build (the one the app loads from the CDN),
// whose class names are mangled, to prove the engine does not depend on them.
if (process.env.PDFLIB_MIN) globalThis.PDFLib = require('pdf-lib/dist/pdf-lib.min.js');
const L = globalThis.PDFLib || require('pdf-lib'); const pf = require('../js/preflight.js');
console.log('pdf-lib build:', process.env.PDFLIB_MIN ? 'minified browser build' : 'node build', '| class name of PDFName:', L.PDFName.name);

async function synthetic() {
  const doc = await L.PDFDocument.create();
  const png = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'rgb100.png'));
  const page = doc.addPage([300, 200]);
  // trim 3mm inside the media box on every side => bleed 3mm (8.504pt)
  const b = 3 * 72 / 25.4;
  page.setMediaBox(0, 0, 300, 200); page.setBleedBox(0, 0, 300, 200); page.setTrimBox(b, b, 300 - 2 * b, 200 - 2 * b);
  const helv = await doc.embedFont(L.StandardFonts.Helvetica);          // NOT embedded as a font file
  page.drawText('Not embedded', { x: 20, y: 150, size: 12, font: helv, color: L.rgb(1, 0, 0) });   // RGB colour
  page.drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: L.cmyk(0, 0, 0, 1) });           // CMYK colour
  const img = await doc.embedPng(png);                                   // 100x100 px, DeviceRGB
  page.drawImage(img, { x: 50, y: 50, width: 72, height: 72 });          // 1 inch => 100 ppi
  const p2 = doc.addPage([300, 200]); p2.drawImage(img, { x: 0, y: 0, width: 36, height: 36 }); // half inch => 200 ppi
  return new Uint8Array(await doc.save());
}

(async () => {
  const bytes = await synthetic();
  const f = await pf.extract(bytes);
  console.log('synthetic facts:', JSON.stringify({ pages: f.pageCount, fonts: f.fonts.map(x => [x.name, x.type, x.embedded]), images: f.images.map(i => [i.family, i.w, i.h]), place: f.placements.map(p => [p.page, Math.round(p.ppiX * 10) / 10]), rgbPages: f.vector.rgbPages }));
  assert.strictEqual(f.pageCount, 2);
  assert.strictEqual(f.fonts.length, 1); assert.strictEqual(f.fonts[0].embedded, false, 'standard Helvetica is not embedded'); assert.strictEqual(f.fonts[0].name, 'Helvetica');
  assert.strictEqual(f.images.length, 1); assert.strictEqual(f.images[0].family, 'RGB');
  assert(Math.abs(f.placements[0].ppiX - 100) < 0.5, 'page 1 image is 100 ppi'); assert(Math.abs(f.placements[1].ppiX - 200) < 0.5, 'page 2 image is 200 ppi');
  assert.deepStrictEqual(f.vector.rgbPages, [0], 'RGB text colour found on page 1 only');
  const bl = pf.pageBleedPt(f.pages[0]); assert(Math.abs(bl.bleed - 3 * 72 / 25.4) < 0.01, 'bleed is 3 mm'); 
  const ev = pf.evaluate(f, { bleedMm: 3, minPpi: 150, allowRgb: false });
  const ids = ev.findings.map(x => x.level + ':' + x.id).join(' '); console.log('findings:', ids);
  assert(/error:fonts\b/.test(ids) && /warn:image-ppi/.test(ids) && /warn:image-rgb/.test(ids) && /warn:vector-rgb/.test(ids) && /pass:bleed/.test(ids));
  const ev2 = pf.evaluate(f, { bleedMm: 5, minPpi: 50, allowRgb: true });
  assert(ev2.findings.some(x => x.level === 'error' && x.id === 'bleed'), 'asking for 5 mm fails a 3 mm bleed');
  assert(!ev2.findings.some(x => x.id === 'image-ppi' && x.level === 'warn'), 'ppi threshold respected');
  console.log('synthetic checks passed');

  // encrypted / garbage input must not crash
  try { await pf.extract(new Uint8Array([1, 2, 3])); assert.fail('should throw'); } catch (e) { console.log('garbage input rejected:', String(e.message).slice(0, 60)); }

  const real = process.argv[2]; if (!real) return;
  const buf = new Uint8Array(fs.readFileSync(real)); let t = Date.now();
  const rf = await pf.extract(buf); console.log('REAL extract ms', Date.now() - t, '| pages', rf.pageCount, '| fonts', rf.fonts.map(x => x.name + (x.embedded ? '' : ' (NOT EMBEDDED)')).join(', '), '| placements', rf.placements.length, '| unreadable', rf.unreadablePages.length);
  // ---- compare with poppler
  let rows; try { rows = execFileSync('pdfimages', ['-list', real], { maxBuffer: 1 << 28 }).toString().split('\n').slice(2).filter(Boolean).map(l => l.trim().split(/\s+/)); } catch (e) { console.log('poppler not available; skipping comparison'); return; }
  const pop = rows.filter(r => r[2] === 'image' || r[2] === 'stencil').map(r => ({ page: Number(r[0]) - 1, w: Number(r[3]), h: Number(r[4]), mask: r[2] === 'stencil', ppi: Number(r[12]) }));
  const mine = rf.placements.map(p => ({ page: p.page, w: p.px[0], h: p.px[1], mask: p.mask, ppi: p.ppiX }));
  const key = r => r.page + ':' + r.w + 'x' + r.h + ':' + (r.mask ? 'm' : 'i');
  const group = a => { const m = new Map(); for (const r of a) { const k = key(r); (m.get(k) || m.set(k, []).get(k)).push(r.ppi); } return m; };
  const gp = group(pop), gm = group(mine); let missing = 0, extra = 0, ppiOff = 0, compared = 0;
  for (const [k, v] of gp) { const w = gm.get(k); if (!w || w.length !== v.length) { missing++; continue; } v.sort((a, b) => a - b); w.sort((a, b) => a - b); for (let i = 0; i < v.length; i++) { compared++; if (Math.abs(v[i] - w[i]) > Math.max(1, v[i] * 0.01)) ppiOff++; } }
  for (const k of gm.keys()) if (!gp.has(k)) extra++;
  console.log('poppler placements', pop.length, '| engine placements', mine.length, '| groups missing in engine', missing, '| extra in engine', extra, '| ppi compared', compared, 'off by >1%:', ppiOff);
  const popLow = Math.min(...pop.filter(r => !r.mask).map(r => r.ppi)), myLow = Math.min(...mine.filter(r => !r.mask).map(r => r.ppi));
  console.log('lowest ppi: poppler', popLow, '| engine', Math.round(myLow));
  assert(missing === 0 && extra === 0 && ppiOff === 0, 'engine disagrees with poppler');
  const fonts = execFileSync('pdffonts', [real]).toString().split('\n').slice(2).filter(Boolean).map(l => ({ emb: /\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(l) }));
  console.log('poppler fonts', fonts.length, 'embedded', fonts.filter(f => f.emb && f.emb[1] === 'yes').length, '| engine fonts', rf.fonts.length, 'embedded', rf.fonts.filter(f => f.embedded).length);
  const ev3 = pf.evaluate(rf, { bleedMm: 3, minPpi: 300, allowRgb: false });
  for (const x of ev3.findings) console.log(' ', x.level.padEnd(5), x.id.padEnd(13), x.title, '|', x.detail.slice(0, 130), x.pages.length ? '| pages ' + x.pages.length : '');
  console.log('PDF check against the real file: agrees with poppler');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
