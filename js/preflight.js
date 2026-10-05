/*
 * Printworks PDF preflight (v1.7)
 *
 * extract(bytes)            reads facts from a PDF (slow, done once)
 * evaluate(facts, profile)  turns facts into findings against your printer profile (instant, re-run any time)
 *
 * Built on pdf-lib, which reads the PDF's structure without decoding any images, so a 36 MB, 320-page
 * file takes about a second. Content streams are interpreted just far enough to find where images are
 * placed (for resolution), which fonts are used, and whether RGB colours are painted.
 *
 * What it checks: page size and trim/bleed boxes, font embedding, image colour space and effective
 * resolution, RGB colour in text and vector art, spot colours, PDF/X output intent.
 * What it does NOT check (say so in the UI): total ink coverage, overprint and trapping, transparency
 * flattening, image content, colour accuracy. Your printer's own preflight has the final word.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});
  const lib = () => root.PDFLib || (typeof require !== 'undefined' ? require('pdf-lib') : null);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const MM = 72 / 25.4;

  /* ----------------------------------------------------------- small helpers */
  const N = name => lib().PDFName.of(name);
  // instanceof, never constructor.name: the minified browser build of pdf-lib mangles class names.
  const is = (o, cls) => !!o && o instanceof lib()[cls];
  function look(ctx, obj) { // follow references
    let o = obj, guard = 0;
    while (is(o, 'PDFRef') && guard++ < 20) o = ctx.lookup(o);
    return o;
  }
  const num = o => (is(o, 'PDFNumber') ? o.asNumber() : (typeof o === 'number' ? o : NaN));
  const nameStr = o => (is(o, 'PDFName') ? o.decodeText() : null);
  const dictOf = o => (is(o, 'PDFDict') ? o : (is(o, 'PDFStream') && is(o.dict, 'PDFDict') ? o.dict : null));
  const arr = o => (is(o, 'PDFArray') ? o : null);
  const dget = (ctx, d, key) => { const dd = dictOf(d); return dd ? look(ctx, dd.get(N(key))) : undefined; };
  const textOf = o => { try { return o && o.decodeText ? o.decodeText() : (o && o.asString ? o.asString() : ''); } catch (e) { return ''; } };

  function boxOf(ctx, page, key) {
    const a = arr(look(ctx, page.node.get(N(key)))); if (!a || a.size() < 4) return null;
    const v = [0, 1, 2, 3].map(i => num(look(ctx, a.get(i)))); if (v.some(x => !isFinite(x))) return null;
    const x = Math.min(v[0], v[2]), y = Math.min(v[1], v[3]);
    return { x, y, w: Math.abs(v[2] - v[0]), h: Math.abs(v[3] - v[1]) };
  }
  const rectOf = r => ({ x: r.x, y: r.y, w: r.width, h: r.height });

  /* ------------------------------------------------------------ colour spaces */
  const PROCESS = new Set(['cyan', 'magenta', 'yellow', 'black']);
  function csInfo(ctx, obj, res, depth) {
    depth = depth || 0;
    const o = look(ctx, obj); const unk = { family: 'Other', label: 'Other', spot: [] };
    if (!o || depth > 5) return unk;
    const nm = nameStr(o);
    if (nm) {
      if (nm === 'DeviceRGB' || nm === 'RGB') return { family: 'RGB', label: 'DeviceRGB', spot: [] };
      if (nm === 'DeviceCMYK' || nm === 'CMYK') return { family: 'CMYK', label: 'DeviceCMYK', spot: [] };
      if (nm === 'DeviceGray' || nm === 'G') return { family: 'Gray', label: 'DeviceGray', spot: [] };
      if (nm === 'Pattern') return { family: 'Pattern', label: 'Pattern', spot: [] };
      const cs = res && dget(ctx, res, 'ColorSpace'); const named = cs && dget(ctx, cs, nm);
      return named && named !== o ? csInfo(ctx, named, res, depth + 1) : unk;
    }
    const a = arr(o); if (!a || !a.size()) return unk;
    const kind = nameStr(look(ctx, a.get(0)));
    if (kind === 'ICCBased') {
      const n = num(dget(ctx, look(ctx, a.get(1)), 'N'));
      return n === 3 ? { family: 'RGB', label: 'ICC RGB', spot: [] } : n === 4 ? { family: 'CMYK', label: 'ICC CMYK', spot: [] } : n === 1 ? { family: 'Gray', label: 'ICC Gray', spot: [] } : unk;
    }
    if (kind === 'Indexed' || kind === 'I') { const b = csInfo(ctx, a.get(1), res, depth + 1); return { family: b.family, label: 'Indexed ' + b.label, spot: b.spot }; }
    if (kind === 'CalRGB') return { family: 'RGB', label: 'CalRGB', spot: [] };
    if (kind === 'CalGray') return { family: 'Gray', label: 'CalGray', spot: [] };
    if (kind === 'Lab') return { family: 'Lab', label: 'Lab', spot: [] };
    if (kind === 'Separation') { const s = nameStr(look(ctx, a.get(1))) || 'Separation'; return { family: s === 'All' || s === 'None' ? 'Other' : 'Spot', label: 'Separation', spot: s === 'None' ? [] : [s] }; }
    if (kind === 'DeviceN') {
      const names = arr(look(ctx, a.get(1))); const list = [];
      if (names) for (let i = 0; i < names.size(); i++) { const s = nameStr(look(ctx, names.get(i))); if (s && s !== 'None') list.push(s); }
      const spots = list.filter(s => !PROCESS.has(s.toLowerCase()));
      return { family: spots.length ? 'Spot' : 'CMYK', label: 'DeviceN', spot: spots };
    }
    return unk;
  }

  /* ------------------------------------------------------------ content streams */
  const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
  const isWS = c => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  function decodeName(s) { return s.replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); }
  function skipString(s, i) { let depth = 1, j = i + 1; while (j < s.length && depth > 0) { const d = s.charCodeAt(j); if (d === 92) j++; else if (d === 40) depth++; else if (d === 41) depth--; j++; } return j; }

  // Content stream -> [{ op, args }]. Only the operands we use are kept: numbers and names.
  function parseOps(u8) {
    const s = latin1(u8), n = s.length, ops = []; let operands = [], i = 0;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (isWS(c)) { i++; continue; }
      if (c === 37) { while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++; continue; }
      if (c === 47) { let j = i + 1; while (j < n && !isWS(s.charCodeAt(j)) && !isDelim(s.charCodeAt(j))) j++; operands.push({ n: decodeName(s.slice(i + 1, j)) }); i = j; continue; }
      if (c === 40) { i = skipString(s, i); operands.push(0); continue; }
      if (c === 60) {
        if (s.charCodeAt(i + 1) === 60) {
          let depth = 1, j = i + 2;
          while (j < n && depth > 0) { if (s[j] === '<' && s[j + 1] === '<') { depth++; j += 2; } else if (s[j] === '>' && s[j + 1] === '>') { depth--; j += 2; } else if (s[j] === '(') j = skipString(s, j); else j++; }
          operands.push(0); i = j; continue;
        }
        const j = s.indexOf('>', i); i = j < 0 ? n : j + 1; operands.push(0); continue;
      }
      if (c === 91) { let depth = 1, j = i + 1; while (j < n && depth > 0) { const d = s.charCodeAt(j); if (d === 40) { j = skipString(s, j); continue; } if (d === 91) depth++; else if (d === 93) depth--; j++; } i = j; operands.push(0); continue; }
      if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) { i++; continue; }
      let j = i; while (j < n && !isWS(s.charCodeAt(j)) && !isDelim(s.charCodeAt(j))) j++;
      const tok = s.slice(i, j); i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) operands.push(parseFloat(tok));
      else if (tok === 'BI') { // inline image: read its header, then skip the binary data up to EI
        const idPos = s.indexOf('ID', i); const header = idPos < 0 ? '' : s.slice(i, idPos);
        const re = /\sEI(?=\s|$)/g; re.lastIndex = idPos < 0 ? i : idPos + 2; const m = re.exec(s);
        const get = k => { const mm = new RegExp('/' + k + '\\s+(/?[A-Za-z0-9]+)').exec(header); return mm ? mm[1] : null; };
        ops.push({ op: 'BI', args: [parseFloat(get('W') || get('Width')) || 0, parseFloat(get('H') || get('Height')) || 0, { n: (get('CS') || get('ColorSpace') || '').replace('/', '') }] });
        i = m ? m.index + m[0].length : n; operands = [];
      } else { ops.push({ op: tok, args: operands }); operands = []; }
    }
    return ops;
  }
  // PDF matrices use row vectors: new = M x CTM
  const concat = (M, C) => [M[0] * C[0] + M[1] * C[2], M[0] * C[1] + M[1] * C[3], M[2] * C[0] + M[3] * C[2], M[2] * C[1] + M[3] * C[3], M[4] * C[0] + M[5] * C[2] + C[4], M[4] * C[1] + M[5] * C[3] + C[5]];

  /* ----------------------------------------------------------------- extract */
  async function extract(bytes, opts) {
    opts = opts || {}; const progress = opts.onProgress || function () {};
    const L = lib(); if (!L) throw new Error('pdf-lib is not loaded');
    let doc;
    try { doc = await L.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && (e.name + e.message)))) return { error: 'encrypted', message: 'This PDF is password-protected, so it cannot be read. Export an unprotected copy for checking.' };
      throw e;
    }
    const ctx = doc.context; const pages = doc.getPages();
    const facts = { bytes: bytes.length, pageCount: pages.length, pages: [], fonts: [], images: [], placements: [], vector: { rgbPages: [], rgbOps: 0 },
      spots: [], output: { pdfx: null, intent: null, identifier: null }, meta: {}, unreadablePages: [], inlineImages: 0 };

    // document level info
    try { facts.meta.producer = doc.getProducer() || ''; facts.meta.creator = doc.getCreator() || ''; } catch (e) { /* optional */ }
    try { facts.meta.version = ctx.header.getVersionString(); } catch (e) { /* optional */ }
    try {
      const info = look(ctx, ctx.trailerInfo && ctx.trailerInfo.Info);
      const x = info && dget(ctx, info, 'GTS_PDFXVersion'); if (x) facts.output.pdfx = textOf(x);
      const oi = arr(look(ctx, doc.catalog.get(N('OutputIntents'))));
      if (oi && oi.size()) { const d = look(ctx, oi.get(0)); const id = dget(ctx, d, 'OutputConditionIdentifier'); facts.output.intent = true; facts.output.identifier = id ? textOf(id) : ''; }
    } catch (e) { /* optional */ }

    const imageIds = new Map(); // stream object -> index
    const fontIds = new Map();  // font dict -> index
    const opCache = new Map();  // stream object -> parsed ops
    const spotSet = new Set();

    const streamBytes = s => { const b = L.decodePDFRawStream(s).decode(); return b; };
    const opsOfStream = s => { let o = opCache.get(s); if (!o) { o = parseOps(streamBytes(s)); opCache.set(s, o); } return o; };
    function imageIndex(xo, res) {
      let id = imageIds.get(xo); if (id != null) return id;
      const d = dictOf(xo); const cs = csInfo(ctx, d.get(N('ColorSpace')), res);
      const mask = look(ctx, d.get(N('ImageMask'))) === ctx.obj(true);
      const filter = look(ctx, d.get(N('Filter')));
      const f = filter ? (nameStr(filter) || (arr(filter) ? nameStr(look(ctx, filter.get(arr(filter).size() - 1))) : null)) : null;
      for (const sp of cs.spot) spotSet.add(sp);
      const rec = { id: facts.images.length, w: num(look(ctx, d.get(N('Width')))), h: num(look(ctx, d.get(N('Height')))), bpc: num(look(ctx, d.get(N('BitsPerComponent')))) || (mask ? 1 : 8),
        mask, family: mask ? 'Mask' : cs.family, label: mask ? '1-bit mask' : cs.label, spot: cs.spot, filter: f, hasSMask: !!d.get(N('SMask')), uses: 0 };
      facts.images.push(rec); imageIds.set(xo, rec.id); return rec.id;
    }
    function fontIndex(fd) {
      let id = fontIds.get(fd); if (id != null) return id;
      const sub = nameStr(dget(ctx, fd, 'Subtype')) || ''; let base = nameStr(dget(ctx, fd, 'BaseFont')) || '(unnamed)';
      let desc = dget(ctx, fd, 'FontDescriptor');
      if (sub === 'Type0') { const df = arr(dget(ctx, fd, 'DescendantFonts')); const first = df && look(ctx, df.get(0)); if (first) desc = dget(ctx, first, 'FontDescriptor'); }
      const embedded = sub === 'Type3' ? true : !!(desc && (dget(ctx, desc, 'FontFile') || dget(ctx, desc, 'FontFile2') || dget(ctx, desc, 'FontFile3')));
      const subset = /^[A-Z]{6}\+/.test(base);
      const rec = { id: facts.fonts.length, name: base.replace(/^[A-Z]{6}\+/, ''), subset, type: sub, embedded, pages: [] };
      facts.fonts.push(rec); fontIds.set(fd, rec.id); return rec.id;
    }

    function run(ops, res, ctm, inherit, pageIdx, depth, seenFonts, inMask) {
      const stack = []; let g = { ctm, fill: inherit.fill, stroke: inherit.stroke };
      for (const { op, args } of ops) {
        switch (op) {
          case 'q': stack.push(Object.assign({}, g)); break;
          case 'Q': if (stack.length) g = stack.pop(); break;
          case 'cm': if (args.length >= 6 && args.slice(-6).every(Number.isFinite)) g.ctm = concat(args.slice(-6), g.ctm); break;
          case 'cs': g.fill = args[0] && args[0].n ? csInfo(ctx, N(args[0].n), res).family : g.fill; break;
          case 'CS': g.stroke = args[0] && args[0].n ? csInfo(ctx, N(args[0].n), res).family : g.stroke; break;
          case 'rg': case 'RG': facts.vector.rgbOps++; markRgb(pageIdx); break;
          case 'sc': case 'scn': if (g.fill === 'RGB') { facts.vector.rgbOps++; markRgb(pageIdx); } break;
          case 'SC': case 'SCN': if (g.stroke === 'RGB') { facts.vector.rgbOps++; markRgb(pageIdx); } break;
          case 'g': case 'G': case 'k': case 'K': break;
          case 'Tf': {
            const nm = args[0] && args[0].n; const fonts = nm && res && dget(ctx, res, 'Font'); const fd = fonts && dget(ctx, fonts, nm);
            if (fd) { const id = fontIndex(fd); const key = id + ':' + pageIdx; if (!seenFonts.has(key)) { seenFonts.add(key); facts.fonts[id].pages.push(pageIdx); } }
            break;
          }
          case 'gs': { // a soft mask (drop shadow, feather, transparency) holds its own little content stream
            const nm = args[0] && args[0].n; const egs = nm && res && dget(ctx, res, 'ExtGState'); const gd = egs && dget(ctx, egs, nm);
            const sm = gd && dget(ctx, gd, 'SMask'); const grp = sm && !nameStr(sm) && dget(ctx, sm, 'G');
            if (grp && depth < 8) {
              let fops; try { fops = opsOfStream(grp); } catch (e) { break; }
              const m = arr(dget(ctx, grp, 'Matrix')); const M = m && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map(k => num(look(ctx, m.get(k)))) : [1, 0, 0, 1, 0, 0];
              run(fops, dget(ctx, grp, 'Resources') || res, concat(M.every(Number.isFinite) ? M : [1, 0, 0, 1, 0, 0], g.ctm), { fill: g.fill, stroke: g.stroke }, pageIdx, depth + 1, seenFonts, true);
            }
            break;
          }
          case 'BI': { facts.inlineImages++; const w = args[0], h = args[1], cs = (args[2] && args[2].n) || ''; const fam = /RGB/.test(cs) ? 'RGB' : /CMYK/.test(cs) ? 'CMYK' : /^(G|Gray|DeviceGray)$/.test(cs) ? 'Gray' : 'Other'; placeImage({ id: -1, w, h, mask: false, family: fam, label: 'inline ' + cs }, g.ctm, pageIdx, inMask); break; }
          case 'Do': {
            const nm = args[0] && args[0].n; const xos = nm && res && dget(ctx, res, 'XObject'); const xo = xos && dget(ctx, xos, nm); if (!xo) break;
            const sub = nameStr(dget(ctx, xo, 'Subtype'));
            if (sub === 'Image') { const rec = facts.images[imageIndex(xo, res)]; placeImage(rec, g.ctm, pageIdx, inMask); }
            else if (sub === 'Form' && depth < 8) {
              let fops; try { fops = opsOfStream(xo); } catch (e) { break; }
              const m = arr(dget(ctx, xo, 'Matrix')); const M = m && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map(k => num(look(ctx, m.get(k)))) : [1, 0, 0, 1, 0, 0];
              const fres = dget(ctx, xo, 'Resources') || res;
              run(fops, fres, concat(M.every(Number.isFinite) ? M : [1, 0, 0, 1, 0, 0], g.ctm), { fill: g.fill, stroke: g.stroke }, pageIdx, depth + 1, seenFonts, inMask);
            }
            break;
          }
          default: break;
        }
      }
    }
    const rgbPageSet = new Set(); const markRgb = p => { rgbPageSet.add(p); };
    function placeImage(rec, ctm, pageIdx, inMask) {
      if (rec.id >= 0) facts.images[rec.id].uses++;
      const wPt = Math.hypot(ctm[0], ctm[1]), hPt = Math.hypot(ctm[2], ctm[3]);
      facts.placements.push({ page: pageIdx, image: rec.id, family: rec.family, label: rec.label, mask: !!rec.mask, softMask: !!inMask, px: [rec.w, rec.h], wPt, hPt,
        ppiX: wPt > 0 ? rec.w / (wPt / 72) : null, ppiY: hPt > 0 ? rec.h / (hPt / 72) : null });
    }

    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const media = rectOf(page.getMediaBox()); const crop = rectOf(page.getCropBox());
      facts.pages.push({ index: pi, media, crop, trim: boxOf(ctx, page, 'TrimBox'), bleed: boxOf(ctx, page, 'BleedBox'), art: boxOf(ctx, page, 'ArtBox') });
      try {
        const res = page.node.Resources(); const contents = page.node.Contents(); let bytesList = [];
        if (contents) {
          if (arr(contents)) for (let k = 0; k < contents.size(); k++) { const s = look(ctx, contents.get(k)); if (s) bytesList.push(streamBytes(s)); }
          else bytesList.push(streamBytes(contents));
        }
        const total = bytesList.reduce((n, b) => n + b.length + 1, 0); const all = new Uint8Array(total); let off = 0;
        for (const b of bytesList) { all.set(b, off); off += b.length; all[off++] = 10; }
        run(parseOps(all), res, [1, 0, 0, 1, 0, 0], { fill: 'Gray', stroke: 'Gray' }, pi, 0, facts._seen || (facts._seen = new Set()), false);
      } catch (e) { facts.unreadablePages.push(pi); }
      if (pi % 10 === 9 || pi === pages.length - 1) { progress((pi + 1) / pages.length); await tick(); }
    }
    delete facts._seen;
    facts.vector.rgbPages = Array.from(rgbPageSet).sort((a, b) => a - b);
    facts.spots = Array.from(spotSet);
    for (const f of facts.fonts) f.pages.sort((a, b) => a - b);
    return facts;
  }

  /* ---------------------------------------------------------------- evaluate */
  const DEFAULTS = { bleedMm: 3, minPpi: 300, allowRgb: false };
  const fmt = n => (Math.round(n * 10) / 10).toString();
  const fmtMm = pt => fmt(pt / MM);

  function pageBleedPt(p) { // how far the page extends past the trim on its smallest side
    const trim = p.trim; if (!trim) return { bleed: 0, known: false };
    const outer = p.bleed || p.media;
    const d = [trim.x - outer.x, trim.y - outer.y, (outer.x + outer.w) - (trim.x + trim.w), (outer.y + outer.h) - (trim.y + trim.h)];
    return { bleed: Math.max(0, Math.min.apply(null, d)), known: true };
  }

  // idml (optional): { pageCount, pageSizes:[{widthPt,heightPt,count}], bleedPt }
  function evaluate(facts, profileIn, idml) {
    const profile = Object.assign({}, DEFAULTS, profileIn || {});
    const out = [];
    const add = (level, id, title, detail, pages, extra) => out.push(Object.assign({ level, id, title, detail: detail || '', pages: (pages || []).slice(), count: pages ? pages.length : 0 }, extra || {}));
    const uniq = a => Array.from(new Set(a)).sort((x, y) => x - y);

    // ---- pages and sizes
    const sizes = new Map();
    for (const p of facts.pages) { const t = p.trim || p.media; const k = fmtMm(t.w) + ' × ' + fmtMm(t.h) + ' mm'; sizes.set(k, (sizes.get(k) || []).concat(p.index)); }
    const sizeList = Array.from(sizes.entries()).sort((a, b) => b[1].length - a[1].length);
    if (sizeList.length === 1) add('pass', 'page-size', 'Page size', `All ${facts.pageCount} page${facts.pageCount === 1 ? '' : 's'} are ${sizeList[0][0]} (${facts.pages[0].trim ? 'from the TrimBox' : 'from the page size'}).`);
    else add('warn', 'page-size', 'Pages are not all the same size', sizeList.slice(0, 5).map(([k, v]) => `${k}: ${v.length} page${v.length === 1 ? '' : 's'}`).join(' · ') + '. Fine for mixed products, but check it is intended.', sizeList[1][1]);

    // ---- bleed
    const tip = ' In InDesign\u2019s Export Adobe PDF dialog, open Marks and Bleeds and tick Use Document Bleed Settings.';
    const needPt = profile.bleedMm * MM; const bl = facts.pages.map(pageBleedPt);
    const noBox = facts.pages.filter((p, i) => !bl[i].known).map(p => p.index);
    const lacking = facts.pages.filter((p, i) => bl[i].known && bl[i].bleed + 0.05 < needPt).map(p => p.index);
    const haveVals = Array.from(new Set(bl.filter(b => b.known).map(b => fmtMm(b.bleed)))).slice(0, 4);
    if (noBox.length === facts.pageCount) {
      const media = facts.pages[0].media; const idmlNote = idml && idml.bleedPt ? ` Your IDML has ${fmtMm(idml.bleedPt)} mm of bleed, so this PDF was probably exported without it.` : '';
      add(profile.bleedMm > 0 ? 'error' : 'info', 'bleed', 'No bleed information', `The PDF has no TrimBox, so the printer cannot tell where to cut, and the pages are ${fmtMm(media.w)} × ${fmtMm(media.h)} mm with nothing outside the trim.${idmlNote} Export from InDesign with bleed (and crop marks or a TrimBox) if your printer needs ${fmt(profile.bleedMm)} mm.${tip}`, noBox.slice(0, 200));
    } else if (lacking.length) add('error', 'bleed', `Bleed below ${fmt(profile.bleedMm)} mm`, `Smallest bleed found on these pages: ${haveVals.join(', ')} mm. Your profile asks for ${fmt(profile.bleedMm)} mm.${idml && idml.bleedPt ? ' Your IDML has ' + fmtMm(idml.bleedPt) + ' mm of bleed, so the PDF was probably exported without it.' : ''}${tip}`, lacking);
    else add('pass', 'bleed', 'Bleed', `At least ${fmt(profile.bleedMm)} mm of bleed on every page${haveVals.length ? ' (found ' + haveVals.join(', ') + ' mm)' : ''}.`);

    // ---- fonts
    const missing = facts.fonts.filter(f => !f.embedded);
    const type3 = facts.fonts.filter(f => f.type === 'Type3');
    if (!facts.fonts.length) add('info', 'fonts', 'Fonts', 'No text was found in the page content (the text may be outlined or in images).');
    else if (missing.length) add('error', 'fonts', 'Fonts not embedded', `${Array.from(new Set(missing.map(f => f.name))).join(', ')} ${new Set(missing.map(f => f.name)).size === 1 ? 'is' : 'are'} not embedded. The printer's machine will substitute another font. Export again with fonts embedded.`, uniq(missing.flatMap(f => f.pages)));
    else { const names = Array.from(new Set(facts.fonts.map(f => f.name))); add('pass', 'fonts', 'Fonts embedded', `${names.length} font${names.length === 1 ? '' : 's'}, all embedded: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}.`); }
    if (type3.length) add('warn', 'fonts-type3', 'Type 3 fonts', `${type3.map(f => f.name).join(', ')} ${type3.length === 1 ? 'is a' : 'are'} Type 3 font${type3.length === 1 ? '' : 's'}; these can print less crisply and cannot be hinted.`, uniq(type3.flatMap(f => f.pages)));

    // ---- images: colour
    const real = facts.placements.filter(p => !p.mask && !p.softMask); // soft-mask images (shadows, feathers) do not affect print quality
    const byFam = f => real.filter(p => p.family === f);
    const rgbP = byFam('RGB'), labP = byFam('Lab');
    const imgCount = facts.images.filter(i => !i.mask).length;
    if (!facts.images.length && !facts.inlineImages) add('info', 'images', 'Images', 'No placed images found.');
    else {
      if (rgbP.length && !profile.allowRgb) add('warn', 'image-rgb', 'RGB images', `${rgbP.length} placement${rgbP.length === 1 ? '' : 's'} of ${new Set(rgbP.map(p => p.image)).size} RGB image${new Set(rgbP.map(p => p.image)).size === 1 ? '' : 's'}. Many printers convert these to CMYK themselves, which can shift colours. Convert them yourself, or tick "my printer accepts RGB" in your profile.`, uniq(rgbP.map(p => p.page)));
      else if (rgbP.length) add('info', 'image-rgb', 'RGB images', `${rgbP.length} RGB placement${rgbP.length === 1 ? '' : 's'}; accepted by your profile.`, uniq(rgbP.map(p => p.page)));
      if (labP.length) add('warn', 'image-lab', 'Lab images', 'Lab colour images can be handled inconsistently by print workflows.', uniq(labP.map(p => p.page)));
      if (!rgbP.length && !labP.length) add('pass', 'image-colour', 'Image colour', `${imgCount} image${imgCount === 1 ? '' : 's'}, none in RGB or Lab.`);
    }
    // ---- images: resolution
    const gradeable = real.filter(p => p.ppiX && p.ppiY && isFinite(p.ppiX) && isFinite(p.ppiY) && !(p.px[0] <= 1 && p.px[1] <= 1));
    if (gradeable.length) {
      const eff = p => Math.min(p.ppiX, p.ppiY);
      const low = gradeable.filter(p => eff(p) + 0.5 < profile.minPpi);
      const worst = gradeable.reduce((a, b) => (eff(b) < eff(a) ? b : a));
      if (low.length) add('warn', 'image-ppi', `Images below ${profile.minPpi} ppi`, `${low.length} placement${low.length === 1 ? ' is' : 's are'} below your minimum. Lowest is ${Math.round(eff(worst))} ppi on page ${worst.page + 1}. Soft or pixelated print is likely if the image is large on the finished piece.`, uniq(low.map(p => p.page)), { worst: { page: worst.page, ppi: Math.round(eff(worst)) } });
      else add('pass', 'image-ppi', 'Image resolution', `Every placed image is at least ${profile.minPpi} ppi (lowest ${Math.round(eff(worst))}).`);
    }
    // ---- vector / text RGB
    if (facts.vector.rgbPages.length && !profile.allowRgb) add('warn', 'vector-rgb', 'RGB colour in text or artwork', `RGB colours are painted on ${facts.vector.rgbPages.length} page${facts.vector.rgbPages.length === 1 ? '' : 's'}. Black text set in RGB can print as a four-colour mix.`, facts.vector.rgbPages);
    else if (!facts.vector.rgbPages.length) add('pass', 'vector-rgb', 'Text and artwork colour', 'No RGB colour found in text or vector artwork.');
    // ---- spots
    if (facts.spots.length) add('info', 'spot', 'Spot colours', `${facts.spots.length} spot colour${facts.spots.length === 1 ? '' : 's'}: ${facts.spots.slice(0, 8).join(', ')}. Make sure each one is intended (foil, varnish, a Pantone ink) and that your printer expects it.`);
    // ---- output intent
    if (facts.output.pdfx || facts.output.intent) add('info', 'pdfx', 'PDF/X', `${facts.output.pdfx ? 'Declares ' + facts.output.pdfx + '. ' : ''}${facts.output.intent ? 'Has an output intent' + (facts.output.identifier ? ' (' + facts.output.identifier + ')' : '') + '.' : ''}`);
    else add('info', 'pdfx', 'PDF/X', 'Not declared. Only matters if your printer asks for PDF/X.');
    if (facts.unreadablePages.length) add('info', 'unreadable', 'Some pages could not be fully read', 'Checks on these pages may be incomplete.', facts.unreadablePages);

    // ---- cross-check with the IDML (when both are loaded)
    if (idml) {
      if (idml.pageCount !== facts.pageCount) add('error', 'idml-pages', 'Page count differs from the IDML', `The PDF has ${facts.pageCount} pages; the IDML has ${idml.pageCount}. The PDF may be from a different version.`);
      else add('pass', 'idml-pages', 'Page count matches the IDML', `${facts.pageCount} pages.`);
      const t = facts.pages[0].trim || facts.pages[0].media; const match = idml.pageSizes.some(s => Math.abs(s.widthPt - t.w) < 0.6 && Math.abs(s.heightPt - t.h) < 0.6);
      if (idml.pageSizes.length && !match) add('warn', 'idml-size', 'Trim size differs from the IDML', `PDF trim ${fmtMm(t.w)} × ${fmtMm(t.h)} mm; IDML page ${idml.pageSizes.slice(0, 2).map(s => fmtMm(s.widthPt) + ' × ' + fmtMm(s.heightPt)).join(' / ')} mm.`);
    }

    const sum = { error: 0, warn: 0, info: 0, pass: 0 }; for (const f of out) sum[f.level]++;
    const order = { error: 0, warn: 1, info: 2, pass: 3 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    return { findings: out, summary: sum, profile };
  }

  PW.preflight = { extract, evaluate, parseOps, concat, DEFAULTS, pageBleedPt };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.preflight;
})(typeof window !== 'undefined' ? window : globalThis);
