/*
 * Printworks font map (v1.6)
 *
 * Maps original font (family + style) -> new font (family + style) and rewrites an IDML so that
 * EVERY piece of text resolves to the intended font, wherever the font was set:
 *   - paragraph styles and character styles   (Resources/Styles.xml)
 *   - formatting on a paragraph range         (Stories/*.xml)
 *   - formatting on a character range         (Stories/*.xml)
 *
 * Only font family and font style are written. Size, leading, colour, tracking, spacing, frames and
 * every other byte of the package are left untouched: the XML is edited as text, never re-serialised.
 * After writing, verify() proves it (see below).
 *
 * Pure code: works in the browser and in Node (see tests/).
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const idml = () => PW.idml;
  const STYLES_PATH = 'Resources/Styles.xml';

  const keyOf = (family, style) => idml().cleanFontFamily(family).toLowerCase() + '|' + String(style || 'Regular').trim().toLowerCase();
  const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // entries: [{ from:{family,style}, to:{family,style} }]  (entries with no target family are ignored)
  function makeMap(entries) {
    const map = new Map();
    for (const e of entries) {
      if (!e || !e.to || !String(e.to.family || '').trim()) continue;
      map.set(keyOf(e.from.family, e.from.style), { family: String(e.to.family).trim(), style: String(e.to.style || e.from.style || 'Regular').trim() });
    }
    return map;
  }

  /* ----------------------------------------------------------- text editing */
  function setAttr(tag, name, value) {
    const re = new RegExp('(\\s' + name + '=)(?:"[^"]*"|\'[^\']*\')');
    const v = '"' + escAttr(value) + '"';
    if (re.test(tag)) return tag.replace(re, (m, p) => p + v);
    return tag.replace(/\s*(\/?)>$/, (m, sl) => ' ' + name + '=' + v + sl + '>');
  }
  function setFontInProps(inner, family) {
    const el = '<AppliedFont type="string">' + escText(family) + '</AppliedFont>';
    const re = /<AppliedFont\b[^>]*>[^<]*<\/AppliedFont>/;
    return re.test(inner) ? inner.replace(re, () => el) : inner + el;
  }
  // One edit = the start tag plus its <Properties> block (if any), rewritten with a new font + style.
  function buildEdit(xml, startIdx, tag, family, style) {
    const eIdx = startIdx + tag.length;
    const rp = /\s*<Properties>([\s\S]*?)<\/Properties>/y; rp.lastIndex = eIdx;
    const pm = rp.exec(xml);
    const newTag = setAttr(tag, 'FontStyle', style);
    if (pm) {
      const lead = pm[0].match(/^\s*/)[0];
      return { start: startIdx, end: eIdx + pm[0].length, text: newTag + lead + '<Properties>' + setFontInProps(pm[1], family) + '</Properties>' };
    }
    return { start: startIdx, end: eIdx, text: newTag + '<Properties>' + setFontInProps('', family) + '</Properties>' };
  }
  function propsAfter(xml, idx) {
    const rp = /\s*<Properties>([\s\S]*?)<\/Properties>/y; rp.lastIndex = idx;
    const pm = rp.exec(xml); return pm ? pm[1] : '';
  }
  function applyEdits(xml, edits) {
    if (!edits.length) return xml;
    let out = '', pos = 0;
    for (const e of edits) { out += xml.slice(pos, e.start) + e.text; pos = e.end; }
    return out + xml.slice(pos);
  }

  /* ---------------------------------------------------------------- styles */
  function cloneTables(t) {
    const c = o => { const r = {}; for (const k in o) r[k] = Object.assign({}, o[k]); return r; };
    return { para: c(t.para), char: c(t.char) };
  }
  function rewriteStyles(xml, map, doc) {
    const tables = cloneTables(doc.styles);
    const all = [];
    for (const self in doc.styles.para) all.push({ kind: 'ParagraphStyle', self, tbl: 'para', prefix: 'ParagraphStyle/', root: idml().NORMAL_PARA });
    for (const self in doc.styles.char) all.push({ kind: 'CharacterStyle', self, tbl: 'char', prefix: 'CharacterStyle/', root: null });
    const id = d => d.kind + '|' + d.self;
    const effOrig = new Map();
    for (const d of all) effOrig.set(id(d), idml().resolveStyle(doc.styles[d.tbl], d.self, d.prefix, d.root));
    const touched = new Set();
    // Pass 1: styles that define their own font or style, and have a mapping.
    for (const d of all) {
      const st = doc.styles[d.tbl][d.self]; if (st.font == null && st.fontStyle == null) continue;
      const eff = effOrig.get(id(d)); if (!eff.font) continue; // a character style with no family: handled per text range
      const t = map.get(keyOf(eff.font, eff.fontStyle)); if (!t) continue;
      tables[d.tbl][d.self].font = t.family; tables[d.tbl][d.self].fontStyle = t.style; touched.add(id(d));
    }
    // Pass 2: a style that INHERITS its font from a remapped parent must not change unless it is mapped itself.
    // Pin any style whose resolved font no longer matches what it should be.
    for (let iter = 0; iter < 6; iter++) {
      let changed = false;
      for (const d of all) {
        const eff = effOrig.get(id(d)); if (!eff.font) continue;
        const t = map.get(keyOf(eff.font, eff.fontStyle));
        const want = t ? { font: t.family, fontStyle: t.style } : { font: eff.font, fontStyle: eff.fontStyle || 'Regular' };
        const got = idml().resolveStyle(tables[d.tbl], d.self, d.prefix, d.root);
        if (got.font !== want.font || (got.fontStyle || 'Regular') !== want.fontStyle) {
          tables[d.tbl][d.self].font = want.font; tables[d.tbl][d.self].fontStyle = want.fontStyle; touched.add(id(d)); changed = true;
        }
      }
      if (!changed) break;
    }
    const edits = []; const stats = { styles: 0 };
    const re = /<(ParagraphStyle|CharacterStyle)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g; let m;
    while ((m = re.exec(xml))) {
      const tag = m[0]; if (/\/>$/.test(tag)) continue;
      const kind = m[1]; const self = idml().attrsOf(tag).Self;
      const tbl = kind === 'ParagraphStyle' ? 'para' : 'char';
      if (!touched.has(kind + '|' + self)) continue;
      const o = doc.styles[tbl][self], n = tables[tbl][self];
      if (o.font === n.font && o.fontStyle === n.fontStyle) continue;
      edits.push(buildEdit(xml, m.index, tag, n.font, n.fontStyle)); stats.styles++;
    }
    return { xml: applyEdits(xml, edits), tables, stats };
  }

  /* ----------------------------------------------------------------- stories */
  function rewriteStory(xml, map, doc, newTables) {
    const orig = doc.styles; const edits = []; const stats = { psr: 0, csr: 0, pinned: 0 };
    const re = /<(\/?)(ParagraphStyleRange|CharacterStyleRange)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
    const stack = []; let m;
    const nearestPsr = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === 'ParagraphStyleRange') return stack[i]; return null; };
    while ((m = re.exec(xml))) {
      const kind = m[2], tag = m[0];
      if (m[1] === '/') { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === kind) { stack.length = i; break; } continue; }
      if (/\/>$/.test(tag)) continue;
      const a = idml().attrsOf(tag);
      const own = idml().localFromText(tag, propsAfter(xml, m.index + tag.length));
      const isP = kind === 'ParagraphStyleRange';
      const psr = isP ? null : nearestPsr();
      const styleId = isP ? a.AppliedParagraphStyle : a.AppliedCharacterStyle;
      const entry = { kind, styleId, own, newOwn: Object.assign({}, own) };
      const effOrig = isP ? idml().cascadeProps(orig, styleId, own, null, {})
        : idml().cascadeProps(orig, psr ? psr.styleId : null, psr ? psr.own : {}, styleId, own);
      if (effOrig.font) {
        const target = map.get(keyOf(effOrig.font, effOrig.fontStyle));
        const desired = target ? { font: target.family, fontStyle: target.style } : { font: effOrig.font, fontStyle: effOrig.fontStyle || 'Regular' };
        const hasOwn = own.font != null || own.fontStyle != null;
        const achieve = o => isP ? idml().cascadeProps(newTables, styleId, o, null, {})
          : idml().cascadeProps(newTables, psr ? psr.styleId : null, psr ? psr.newOwn : {}, styleId, o);
        let newOwn = entry.newOwn; let pinned = false;
        if (hasOwn && target) newOwn = Object.assign({}, newOwn, { font: desired.font, fontStyle: desired.fontStyle });
        const got = achieve(newOwn);
        if (got.font !== desired.font || (got.fontStyle || 'Regular') !== desired.fontStyle) {
          newOwn = Object.assign({}, newOwn, { font: desired.font, fontStyle: desired.fontStyle }); pinned = true;
        }
        if (newOwn.font !== own.font || newOwn.fontStyle !== own.fontStyle) {
          edits.push(buildEdit(xml, m.index, tag, newOwn.font, newOwn.fontStyle));
          if (isP) stats.psr++; else stats.csr++;
          if (pinned) stats.pinned++;
        }
        entry.newOwn = newOwn;
      }
      stack.push(entry);
    }
    return { xml: applyEdits(xml, edits), stats };
  }

  /* ------------------------------------------------------------------ package */
  // readText(path) -> Promise<string>. Returns the files that changed; everything else is untouched.
  async function rewritePackage(readText, doc, map) {
    const changes = new Map(); const stats = { styles: 0, psr: 0, csr: 0, pinned: 0, storiesChanged: 0 };
    if (!map.size) return { changes, stats };
    const sx = await readText(STYLES_PATH);
    let tables = doc.styles;
    if (sx) {
      const r = rewriteStyles(sx, map, doc); tables = r.tables; stats.styles = r.stats.styles;
      if (r.xml !== sx) changes.set(STYLES_PATH, r.xml);
    }
    for (const path of doc.designmap.stories) {
      const x = await readText(path); if (!x) continue;
      const r = rewriteStory(x, map, doc, tables);
      stats.psr += r.stats.psr; stats.csr += r.stats.csr; stats.pinned += r.stats.pinned;
      if (r.xml !== x) { changes.set(path, r.xml); stats.storiesChanged++; }
    }
    return { changes, stats };
  }

  /* ------------------------------------------------------------------- verify */
  const stripFonts = x => x.replace(/\sFontStyle="[^"]*"/g, '').replace(/<AppliedFont\b[^>]*>[^<]*<\/AppliedFont>/g, '')
    .replace(/<Properties>\s*<\/Properties>/g, '').replace(/<Properties\s*\/>/g, '');

  // Proves the rewrite did what it says. readOrig(path)->Promise<string>; changes = result of rewritePackage.
  async function verify(readOrig, changes, doc, map) {
    const res = { changedFiles: changes.size, onlyFontSettingsChanged: true, offenders: [], textUnchanged: true,
      runs: { total: 0, changed: 0, chars: 0, unchanged: 0 }, mismatches: [], structureSame: true };
    for (const [path, nx] of changes) {
      const ox = await readOrig(path);
      if (stripFonts(ox) !== stripFonts(nx)) { res.onlyFontSettingsChanged = false; res.offenders.push(path); }
    }
    const newStyles = changes.has(STYLES_PATH) ? idml().parseStyles(changes.get(STYLES_PATH)) : doc.styles;
    for (const path of doc.designmap.stories) {
      const ox = await readOrig(path); if (!ox) continue;
      const nx = changes.has(path) ? changes.get(path) : ox;
      const so = idml().parseStory(ox), sn = idml().parseStory(nx);
      if (so.text !== sn.text) { res.textUnchanged = false; res.offenders.push(path + ' (text)'); }
      if (so.paragraphs.length !== sn.paragraphs.length) { res.structureSame = false; res.offenders.push(path + ' (paragraphs)'); continue; }
      for (let i = 0; i < so.paragraphs.length; i++) {
        const po = so.paragraphs[i], pn = sn.paragraphs[i];
        if (po.runs.length !== pn.runs.length) { res.structureSame = false; res.offenders.push(path + ' (runs)'); break; }
        for (let j = 0; j < po.runs.length; j++) {
          const ro = po.runs[j], rn = pn.runs[j];
          const n = ro.text.replace(/[\u2028\n]/g, '').length; if (!n) continue;
          const eo = idml().cascadeProps(doc.styles, po.styleId, po.local, ro.charStyle, ro.local);
          const en = idml().cascadeProps(newStyles, pn.styleId, pn.local, rn.charStyle, rn.local);
          res.runs.total++;
          if (!eo.font) { res.runs.unchanged++; continue; }
          const target = map.get(keyOf(eo.font, eo.fontStyle));
          const want = target ? { font: target.family, fontStyle: target.style } : { font: eo.font, fontStyle: eo.fontStyle || 'Regular' };
          if (en.font !== want.font || (en.fontStyle || 'Regular') !== want.fontStyle) res.mismatches.push({ story: path, text: ro.text.slice(0, 40), want, got: { font: en.font, fontStyle: en.fontStyle } });
          if (en.font !== eo.font || (en.fontStyle || 'Regular') !== (eo.fontStyle || 'Regular')) { res.runs.changed++; res.runs.chars += n; } else res.runs.unchanged++;
        }
      }
    }
    res.ok = res.onlyFontSettingsChanged && res.textUnchanged && res.structureSame && res.mismatches.length === 0;
    return res;
  }

  // First entry must be 'mimetype', stored (not compressed), per the IDML/UCF packaging rules.
  function checkPackageBytes(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sig = u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04;
    const method = u8[8] | (u8[9] << 8);
    const nameLen = u8[26] | (u8[27] << 8);
    let name = ''; for (let i = 0; i < nameLen; i++) name += String.fromCharCode(u8[30 + i]);
    return { zip: sig, firstEntry: name, stored: method === 0, ok: sig && name === 'mimetype' && method === 0 };
  }

  PW.fontmap = { keyOf, makeMap, rewriteStyles, rewriteStory, rewritePackage, verify, checkPackageBytes, stripFonts };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.fontmap;
})(typeof window !== 'undefined' ? window : globalThis);
