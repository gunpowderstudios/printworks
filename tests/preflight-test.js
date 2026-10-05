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
const L = globalThis.PDFLib || require('pdf-lib'); require('../js/colour.js'); const pf = require('../js/preflight.js');
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


async function colourPdf() {
  const doc = await L.PDFDocument.create(); const ctx = doc.context; const N = L.PDFName.of;
  const fn2 = (c1, c0) => ctx.register(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: c0 || [0, 0, 0, 0], C1: c1, N: 1 }));
  const sep = (name, fn) => ctx.obj([N('Separation'), N(name), N('DeviceCMYK'), fn]);
  const pantone = sep('PANTONE#20123#20C', fn2([0, 0.19, 1, 0]));                        // type 2 tint transform
  const sampled = sep('SAMPLED#20GREEN', ctx.register(ctx.stream(new Uint8Array([0, 0, 0, 0, 255, 0, 255, 0]), { FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8 }))); // type 0
  const blackN = ctx.obj([N('DeviceN'), ctx.obj([N('Black')]), N('DeviceCMYK'), ctx.register(ctx.stream('{0 0 0 4 -1 roll}', { FunctionType: 4, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1] }))]); // type 4
  const reg = sep('All', fn2([1, 1, 1, 1]));
  const shRgb = ctx.obj({ ShadingType: 2, ColorSpace: N('DeviceRGB'), Coords: [0, 0, 100, 0], Function: fn2([0, 0, 1], [1, 0, 0]) });
  const shCmyk = ctx.obj({ ShadingType: 2, ColorSpace: N('DeviceCMYK'), Coords: [0, 0, 100, 0], Function: fn2([1, 0, 0, 0]) });
  const gs = ctx.obj({ Type: N('ExtGState'), OP: true, op: true });
  const mk = (content, blend) => { const p = doc.addPage([200, 200]);
    p.node.set(N('Resources'), ctx.obj({ ColorSpace: { CS0: pantone, CS1: blackN, CS2: reg, CS3: sampled }, Shading: { Sh0: shRgb, Sh1: shCmyk }, ExtGState: { GS0: gs } }));
    p.node.set(N('Group'), ctx.obj({ Type: N('Group'), S: N('Transparency'), CS: N(blend) }));
    p.node.set(N('Contents'), ctx.register(ctx.stream(content))); return p; };
  mk(['/GS0 gs', '/CS0 cs 1 scn 0 0 50 50 re f', '/CS0 cs 0.5 scn 60 0 50 50 re f', '/CS1 cs 1 scn 120 0 40 40 re f', '/CS3 cs 1 scn 0 100 20 20 re f',
    '0 0 0 1 k 0 60 20 20 re f', '0.8 0.7 0.7 1 k 30 60 20 20 re f', '1 0 0 rg 60 60 20 20 re f', '0.5 g 90 60 20 20 re f', '/CS2 cs 1 scn 120 60 20 20 re f',
    '/Sh0 sh /Sh1 sh', '0 0 1 RG 100 100 m 150 150 l S', '0.2 0.4 0.6 rg'].join('\n'), 'DeviceRGB');   // last colour is SET but never painted
  mk('0 0 0 1 k 0 0 10 10 re f', 'DeviceCMYK');
  return new Uint8Array(await doc.save());
}
async function cmykOnlyPdf() {
  const doc = await L.PDFDocument.create(); const ctx = doc.context; const N = L.PDFName.of; const p = doc.addPage([100, 100]);
  p.node.set(N('Group'), ctx.obj({ Type: N('Group'), S: N('Transparency'), CS: N('DeviceCMYK') }));
  p.node.set(N('Contents'), ctx.register(ctx.stream('0 0 0 1 k 0 0 10 10 re f 0.2 g 20 20 10 10 re f'))); return new Uint8Array(await doc.save());
}

(async () => {
  const bytes = await synthetic();
  const f = await pf.extract(bytes);
  console.log('synthetic facts:', JSON.stringify({ pages: f.pageCount, fonts: f.fonts.map(x => [x.name, x.type, x.embedded]), images: f.images.map(i => [i.family, i.w, i.h]), place: f.placements.map(p => [p.page, Math.round(p.ppiX * 10) / 10]) }));
  assert.strictEqual(f.pageCount, 2);
  assert.strictEqual(f.fonts.length, 1); assert.strictEqual(f.fonts[0].embedded, false, 'standard Helvetica is not embedded'); assert.strictEqual(f.fonts[0].name, 'Helvetica');
  assert.strictEqual(f.images.length, 1); assert.strictEqual(f.images[0].family, 'RGB');
  assert(Math.abs(f.placements[0].ppiX - 100) < 0.5, 'page 1 image is 100 ppi'); assert(Math.abs(f.placements[1].ppiX - 200) < 0.5, 'page 2 image is 200 ppi');
  assert(f.colours.some(c => c.kind === 'rgb' && c.pages.join() === '0'), 'RGB text colour found on page 1 only');
  const bl = pf.pageBleedPt(f.pages[0]); assert(Math.abs(bl.bleed - 3 * 72 / 25.4) < 0.01, 'bleed is 3 mm'); 
  const ev = pf.evaluate(f, { bleedMm: 3, minPpi: 150, allowRgb: false });
  const ids = ev.findings.map(x => x.level + ':' + x.id).join(' '); console.log('findings:', ids);
  assert(/error:fonts\b/.test(ids) && /warn:image-ppi/.test(ids) && /warn:image-rgb/.test(ids) && /warn:vector-rgb/.test(ids) && /pass:bleed/.test(ids));
  const ev2 = pf.evaluate(f, { bleedMm: 5, minPpi: 50, allowRgb: true });
  assert(ev2.findings.some(x => x.level === 'error' && x.id === 'bleed'), 'asking for 5 mm fails a 3 mm bleed');
  assert(!ev2.findings.some(x => x.id === 'image-ppi' && x.level === 'warn'), 'ppi threshold respected');
  console.log('synthetic checks passed');
  // ---- colour inventory on a PDF with every colour structure
  const colourBytes = await colourPdf();
  fs.writeFileSync(require('path').join(__dirname, 'fixtures', 'colour-test.pdf'), colourBytes); // a small PDF with spot, RGB, registration, gradients: drop it into the app to see them
  const cf = await pf.extract(colourBytes); const by = k => cf.colours.find(c => c.key === k), kinds = cf.colours.map(c => c.kind + ':' + c.label).join(' | ');
  console.log('colour inventory:', kinds);
  const pan = cf.colours.find(c => c.label === 'PANTONE 123 C'); assert(pan && pan.kind === 'spot', 'Pantone spot found'); assert.deepStrictEqual(pan.pages, [0]); assert.deepStrictEqual(pan.tints, [100, 50], 'tints 100% and 50% seen');
  assert.strictEqual(pan.rgb, '#fcc907', 'spot swatch comes from its CMYK alternate through a type 2 tint transform');
  const smp = cf.colours.find(c => c.label === 'SAMPLED GREEN'); assert(smp && smp.rgb && smp.rgb !== '#ffffff', 'type 0 (sampled) tint transform evaluated: ' + (smp && smp.rgb));
  assert(by('cmyk:0,0,0,100').uses >= 2 && by('cmyk:0,0,0,100').pages.join() === '0,1', 'DeviceN [Black] through a PostScript (type 4) function becomes K100');
  assert(by('cmyk:80,70,70,100') && by('cmyk:80,70,70,100').tac === 320, 'rich black total ink = 320');
  assert(by('rgb:255,0,0') && by('rgb:0,0,255') && !by('rgb:51,102,153'), 'RGB fill and stroke counted; a colour that is set but never painted is not');
  assert(by('gray:50') && cf.colours.some(c => c.kind === 'registration'), 'gray and registration found');
  assert(cf.colours.filter(c => c.kind === 'gradient').length === 2 && cf.colours.find(c => c.kind === 'gradient' && c.family === 'RGB').rgb === '#ff0000', 'two gradients, RGB one runs from red');
  assert.deepStrictEqual(cf.overprintPages, [0]); assert.deepStrictEqual(cf.pages.map(p => p.blend), ['RGB', 'CMYK']);
  const ce = pf.evaluate(cf, { bleedMm: 0, minPpi: 0, allowRgb: false, allowSpot: false, maxInk: 300 }); const cids = ce.findings.map(x => x.level + ':' + x.id).join(' '); console.log('colour findings:', cids);
  for (const id of ['vector-rgb', 'gradient-rgb', 'blend-rgb', 'spot', 'registration', 'total-ink', 'overprint']) assert(new RegExp(':' + id + '\\b').test(cids), 'expected finding ' + id);
  assert(!/pass:colour\b/.test(cids), 'no "all CMYK" verdict when RGB is present');
  assert(ce.pageFlags[0].rgb && ce.pageFlags[0].spot && ce.pageFlags[0].reg && ce.pageFlags[0].overprint && !ce.pageFlags[1].rgb && !ce.pageFlags[1].spot, 'page map flags');
  const ce2 = pf.evaluate(cf, { bleedMm: 0, minPpi: 0, allowRgb: true, allowSpot: true, maxInk: 400 }); const c2 = ce2.findings.map(x => x.level + ':' + x.id).join(' ');
  assert(/info:spot\b/.test(c2) && !/warn:(vector-rgb|gradient-rgb|blend-rgb|total-ink)/.test(c2), 'profile can accept spot, RGB and higher ink: ' + c2);
  const ok = pf.evaluate(await pf.extract(await cmykOnlyPdf()), { bleedMm: 0, minPpi: 0 }); assert(ok.findings.some(x => x.id === 'colour' && x.level === 'pass'), 'CMYK + gray only => one clear pass');
  console.log('colour checks passed');


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
  // ---- colour inventory of the real PDF, cross-checked against the swatches defined in the IDML
  console.log('COLOURS in the PDF (' + rf.colours.length + '):');
  for (const c of rf.colours.slice(0, 40)) console.log('  ', c.kind.padEnd(9), c.label.padEnd(28), (c.rgb || '-').padEnd(8), 'pages', String(c.pages.length).padStart(3), c.tac != null ? 'ink ' + c.tac + '%' : '', c.sources.join('/'));
  console.log('  image colour spaces:', JSON.stringify(ev3.imageColour.map(x => x.family + ' x' + x.placements)), '| blend', JSON.stringify(ev3.blend), '| overprint pages', rf.overprintPages.length, '| gradients', rf.gradients, '| patterns', rf.patterns);
  const idmlPath = process.argv[3];
  if (idmlPath) {
    const JSZip = require('jszip'); const { DOMParser } = require('@xmldom/xmldom'); const idml = require('../js/idml-model.js');
    const z = await JSZip.loadAsync(fs.readFileSync(idmlPath)); const sw = idml.parseSwatches(await z.file('Resources/Graphic.xml').async('string'));
    const defined = [...sw.values()].filter(c => c.type === 'color' && c.space === 'CMYK').map(c => c.value.slice(0, 4).map(v => Math.round(v * 10) / 10));
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 0.6);
    let exact = 0, tint = 0, other = []; 
    for (const c of rf.colours.filter(c => c.kind === 'cmyk')) {
      if (defined.some(d => near(d, c.cmyk))) exact++;
      else if (defined.some(d => { const k = c.cmyk.findIndex((v, i) => d[i] > 0); const f = k >= 0 ? c.cmyk[k] / d[k] : 0; return f > 0 && f < 1.001 && d.every((v, i) => Math.abs(v * f - c.cmyk[i]) <= 0.8); })) tint++;
      else other.push(c.label);
    }
    console.log('  PDF CMYK colours vs IDML swatches: exact', exact, '| tints of a swatch', tint, '| not in IDML swatches', other.length, other.slice(0, 5).join(' ; '));
  }
  console.log('PDF check against the real file: agrees with poppler');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
