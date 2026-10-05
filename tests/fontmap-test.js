/*
 * Font map checks. Synthetic cases for the tricky parts (inheritance, local overrides, pinning),
 * then the real IDML if a path is given:   node fontmap-test.js [file.idml]
 */
const fs = require('fs'); const assert = require('assert');
const JSZip = require('jszip'); const { DOMParser } = require('@xmldom/xmldom');
const idml = require('../js/idml-model.js'); const fm = require('../js/fontmap.js');
idml.setParser(() => new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(e) { throw new Error(e); } } }));

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><RootCharacterStyleGroup Self="u1">
<CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/>
<CharacterStyle Self="CharacterStyle/Emph" Name="Emph" FontStyle="Italic"><Properties><BasedOn type="string">$ID/[No character style]</BasedOn></Properties></CharacterStyle>
</RootCharacterStyleGroup><RootParagraphStyleGroup Self="u2">
<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="8" FontStyle="Regular"><Properties><Leading type="unit">8</Leading><AppliedFont type="string">Luminari (TT)</AppliedFont></Properties></ParagraphStyle>
<ParagraphStyle Self="ParagraphStyle/Body" Name="Body" FontStyle="Bold"><Properties><BasedOn type="string">$ID/NormalParagraphStyle</BasedOn><AppliedFont type="string">Kereru</AppliedFont></Properties></ParagraphStyle>
<ParagraphStyle Self="ParagraphStyle/Plain" Name="Plain"><Properties><BasedOn type="object">ParagraphStyle/Body</BasedOn></Properties></ParagraphStyle>
<ParagraphStyle Self="ParagraphStyle/BoldOnly" Name="BoldOnly" FontStyle="Bold"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn></Properties></ParagraphStyle>
</RootParagraphStyleGroup></idPkg:Styles>`;
const STORY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.5"><Story Self="uS1">
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>A style-driven </Content></CharacterStyleRange><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Regular"><Content>local style </Content></CharacterStyleRange><Br/></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/BoldOnly"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>inherits bold from a remapped parent </Content></CharacterStyleRange><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" FontStyle="Regular"><Content>local regular </Content></CharacterStyleRange><Br/></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="4.5"><Properties><AppliedFont type="string">Luminari</AppliedFont><Leading type="unit">5</Leading></Properties><Content>run-level font &amp; size</Content></CharacterStyleRange><Br/></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Plain"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Emph"><Content>char style italic </Content></CharacterStyleRange><Content>x</Content></ParagraphStyleRange>
</Story></idPkg:Story>`;

(async () => {
  const doc = { styles: idml.parseStyles(STYLES), designmap: { stories: ['Stories/Story_uS1.xml'] } };
  const files = new Map([['Resources/Styles.xml', STYLES], ['Stories/Story_uS1.xml', STORY]]);
  const read = async p => files.get(p) || '';
  const map = fm.makeMap([
    { from: { family: 'Kereru', style: 'Bold' }, to: { family: 'Source Serif 4', style: 'Semibold' } },
    { from: { family: 'Kereru', style: 'Regular' }, to: { family: 'Source Serif 4', style: 'Regular' } },
    { from: { family: 'Luminari', style: 'Regular' }, to: { family: 'Cormorant Garamond', style: 'Regular' } },   // matches "Luminari (TT)" too
  ]);
  const { changes, stats } = await fm.rewritePackage(read, doc, map);
  const ns = changes.get('Resources/Styles.xml'), nstory = changes.get('Stories/Story_uS1.xml') || STORY;
  // styles
  assert(/Self="ParagraphStyle\/Body"[^>]*FontStyle="Semibold"/.test(ns), 'Body style mapped to Semibold');
  assert(/<AppliedFont type="string">Source Serif 4<\/AppliedFont>/.test(ns), 'Body family mapped');
  assert(/NormalParagraphStyle[^>]*FontStyle="Regular"[\s\S]*?Cormorant Garamond/.test(ns), '"Luminari (TT)" matches the Luminari mapping');
  assert(/Self="ParagraphStyle\/BoldOnly"[^>]*FontStyle="Bold"/.test(ns) && /BoldOnly[\s\S]*?<AppliedFont type="string">Luminari \(TT\)<\/AppliedFont>/.test(ns), 'BoldOnly is pinned to its ORIGINAL font, not dragged along by its remapped parent');
  assert(!/Self="ParagraphStyle\/Plain"[^>]*FontStyle/.test(ns), 'Plain still just inherits');
  // stories: nothing but fonts changed, and every run resolves to what the map says
  const v = await fm.verify(read, changes, doc, map);
  console.log('synthetic:', JSON.stringify({ stats, runs: v.runs, mismatches: v.mismatches, only: v.onlyFontSettingsChanged, text: v.textUnchanged }));
  assert(v.ok, 'synthetic verify failed: ' + JSON.stringify(v.mismatches.concat(v.offenders)));
  assert(/&amp; size/.test(nstory), 'entities preserved');
  assert(/PointSize="4.5"/.test(nstory), 'size untouched');
  // identity / empty map = no changes at all
  const none = await fm.rewritePackage(read, doc, fm.makeMap([]));
  assert(none.changes.size === 0, 'empty map changes nothing');
  const same = await fm.rewritePackage(read, doc, fm.makeMap([{ from: { family: 'Kereru', style: 'Bold' }, to: { family: 'Kereru', style: 'Bold' } }]));
  assert(same.changes.size === 0, 'identity map changes nothing');
  console.log('synthetic cases passed');

  const real = process.argv[2];
  if (!real) return;
  const zip = await JSZip.loadAsync(fs.readFileSync(real));
  const text = async p => { const f = zip.file(p); return f ? f.async('string') : ''; };
  const rdoc = await idml.load(text);
  const rmap = fm.makeMap([
    { from: { family: 'Kereru', style: 'Bold' }, to: { family: 'Source Serif 4', style: 'Semibold' } },
    { from: { family: 'Kereru', style: 'Regular' }, to: { family: 'Source Serif 4', style: 'Regular' } },
    { from: { family: 'Interstate Condensed', style: 'Regular' }, to: { family: 'Inter', style: 'Regular' } },
    { from: { family: 'Interstate Condensed', style: 'Bold' }, to: { family: 'Inter', style: 'Bold' } },
    { from: { family: 'Luminari', style: 'Regular' }, to: { family: 'Cormorant Garamond', style: 'Regular' } },
  ]);
  let t = Date.now();
  const r = await fm.rewritePackage(text, rdoc, rmap);
  const rv = await fm.verify(text, r.changes, rdoc, rmap);
  console.log('REAL FILE rewrite+verify ms:', Date.now() - t, JSON.stringify({ stats: r.stats, changedFiles: rv.changedFiles, onlyFontSettingsChanged: rv.onlyFontSettingsChanged, textUnchanged: rv.textUnchanged, structureSame: rv.structureSame, runs: rv.runs, mismatches: rv.mismatches.length }));
  assert(rv.ok, 'real verify failed ' + JSON.stringify(rv.mismatches.slice(0, 3)) + rv.offenders.slice(0, 3));
  // After: which fonts are in use?
  const out = new JSZip();
  out.file('mimetype', 'application/vnd.adobe.indesign-idml-package', { compression: 'STORE' });
  for (const f of Object.values(zip.files).filter(f => !f.dir && f.name !== 'mimetype')) {
    out.file(f.name, r.changes.has(f.name) ? r.changes.get(f.name) : await f.async('uint8array'), { compression: 'DEFLATE' });
  }
  const buf = await out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  console.log('package bytes check:', JSON.stringify(fm.checkPackageBytes(buf)));
  const z2 = await JSZip.loadAsync(buf); const t2 = async p => { const f = z2.file(p); return f ? f.async('string') : ''; };
  const doc2 = await idml.load(t2); const scan2 = await idml.scan(doc2);
  console.log('FONTS AFTER:'); for (const f of scan2.report.fonts) console.log('  ', f.family, '/', f.style, f.chars, 'chars', 'set on text', f.viaOverride);
  const scan1 = await idml.scan(rdoc);
  assert.strictEqual(scan2.report.frames.total, scan1.report.frames.total); assert.strictEqual(scan2.report.text.chars, scan1.report.text.chars);
  assert.deepStrictEqual(scan2.textFrames.map(f => f.id + ':' + f.story), scan1.textFrames.map(f => f.id + ':' + f.story));
  console.log('re-scan of the exported package: same frames, same stories, same text. OK');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
