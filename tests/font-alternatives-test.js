const assert = require('node:assert/strict');
const test = require('node:test');
const { match } = require('../js/font-alternatives.js');

test('recognises PDF-style family names and preserves bold italic', () => {
  const [font] = match('HelveticaNeueLTStd-BoldOblique');
  assert.deepEqual([font.family, font.weight, font.slant], ['Arimo', 700, 'italic']);
  assert.equal(match('TimesNewRomanPSMT')[0].family, 'Tinos');
});

test('offers curated display faces and reports variant limitations', () => {
  const fonts = match('StencilStd-Bold');
  assert.equal(fonts[0].family, 'Stardos Stencil');
  assert.equal(fonts[0].weight, 700);
  assert.equal(fonts[1].differentStyle, true);
});

test('recognises fonts already in the curated Google Fonts catalogue', () => {
  const fonts = match('Inter-Bold');
  assert.equal(fonts[0].exact, true);
  assert.ok(fonts.slice(1).every(font => !font.exact));
  assert.ok(fonts.length <= 3);
});

test('does not guess alternatives for unknown families', () => {
  assert.deepEqual(match(''), []);
  assert.deepEqual(match('Uncatalogued Example'), []);
});
