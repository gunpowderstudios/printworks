const fs = require('fs'); const JSZip = require('jszip'); const { DOMParser } = require('@xmldom/xmldom');
const idml = require('../js/idml-model.js'); const fm = require('../js/fontmap.js'); const pc = require('../js/printcheck.js');
idml.setParser(() => new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(e) { throw new Error(e); } } }));
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(process.argv[2]));
  const text = async p => { const f = zip.file(p); return f ? f.async('string') : ''; };
  const doc = await idml.load(text); const scan = await idml.scan(doc);
  const show = (label, r) => {
    console.log('== ' + label + ' | frames checked', r.framesChecked, '| pages affected', r.pagesAffected);
    for (const i of r.problems.concat(r.notes)) console.log('  [' + i.level + '] ' + i.title + ': ' + i.frames + ' frames, ' + i.chars + ' chars', '| e.g. p' + i.examples[0].pageName, i.examples[0].detail, '"' + i.examples[0].text + '"');
    console.log('  clear:', r.clear.join('; '));
  };
  show('defaults, current fonts', pc.run(doc, scan, pc.DEFAULT_PROFILE, null));
  // Map to a Light face to prove the weight check reacts to the NEW fonts
  const map = fm.makeMap([{ from: { family: 'Kereru', style: 'Bold' }, to: { family: 'Source Serif 4', style: 'Light' } }]);
  show('after mapping Kereru Bold -> Source Serif 4 Light', pc.run(doc, scan, pc.DEFAULT_PROFILE, map));
  show('strict printer (min 6pt, multi-ink 9pt)', pc.run(doc, scan, Object.assign({}, pc.DEFAULT_PROFILE, { minText: 6, multiInkMin: 9 }), null));
})();
