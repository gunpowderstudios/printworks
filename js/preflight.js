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
  const DEV = { gray: { family: 'Gray', label: 'DeviceGray', spot: [], kind: 'gray' }, rgb: { family: 'RGB', label: 'DeviceRGB', spot: [], kind: 'rgb' }, cmyk: { family: 'CMYK', label: 'DeviceCMYK', spot: [], kind: 'cmyk' } };
  const numArr = (ctx, o) => { const a = arr(look(ctx, o)); if (!a) return null; const v = []; for (let i = 0; i < a.size(); i++) v.push(num(look(ctx, a.get(i)))); return v; };

  // A colour space "definition": enough to name it, classify it and (where possible) turn components into RGB.
  function csDef(ctx, obj, res, depth) {
    depth = depth || 0;
    const o = look(ctx, obj); const unk = { family: 'Other', label: 'Other', spot: [], kind: 'other' };
    if (!o || depth > 5) return unk;
    const nm = nameStr(o);
    if (nm) {
      if (nm === 'DeviceRGB' || nm === 'RGB') return DEV.rgb;
      if (nm === 'DeviceCMYK' || nm === 'CMYK') return DEV.cmyk;
      if (nm === 'DeviceGray' || nm === 'G') return DEV.gray;
      if (nm === 'Pattern') return { family: 'Pattern', label: 'Pattern', spot: [], kind: 'pattern' };
      const cs = res && dget(ctx, res, 'ColorSpace'); const named = cs && dget(ctx, cs, nm);
      return named && named !== o ? csDef(ctx, named, res, depth + 1) : unk;
    }
    const a = arr(o); if (!a || !a.size()) return unk;
    const kind = nameStr(look(ctx, a.get(0)));
    if (kind === 'ICCBased') {
      const n = num(dget(ctx, look(ctx, a.get(1)), 'N'));
      return n === 3 ? { family: 'RGB', label: 'ICC RGB', spot: [], kind: 'rgb' } : n === 4 ? { family: 'CMYK', label: 'ICC CMYK', spot: [], kind: 'cmyk' } : n === 1 ? { family: 'Gray', label: 'ICC Gray', spot: [], kind: 'gray' } : unk;
    }
    if (kind === 'Indexed' || kind === 'I') { const b = csDef(ctx, a.get(1), res, depth + 1); return { family: b.family, label: 'Indexed ' + b.label, spot: b.spot, kind: 'indexed' }; }
    if (kind === 'CalRGB') return { family: 'RGB', label: 'CalRGB', spot: [], kind: 'rgb' };
    if (kind === 'CalGray') return { family: 'Gray', label: 'CalGray', spot: [], kind: 'gray' };
    if (kind === 'Lab') return { family: 'Lab', label: 'Lab', spot: [], kind: 'lab' };
    if (kind === 'Separation') {
      const s = nameStr(look(ctx, a.get(1))) || 'Separation';
      return { family: s === 'All' ? 'Registration' : s === 'None' ? 'Other' : 'Spot', label: s === 'All' ? 'Registration' : 'Separation', spot: s === 'None' || s === 'All' ? [] : [s], names: [s], kind: 'sep', alt: csDef(ctx, a.get(2), res, depth + 1), fn: look(ctx, a.get(3)) };
    }
    if (kind === 'DeviceN') {
      const na = arr(look(ctx, a.get(1))); const names = [];
      if (na) for (let i = 0; i < na.size(); i++) names.push(nameStr(look(ctx, na.get(i))) || '?');
      const spots = names.filter(n => n !== 'None' && !PROCESS.has(n.toLowerCase()));
      return { family: spots.length ? 'Spot' : 'CMYK', label: 'DeviceN', spot: spots, names, kind: 'devn', alt: csDef(ctx, a.get(2), res, depth + 1), fn: look(ctx, a.get(3)) };
    }
    return unk;
  }

  /* ---- PDF functions (tint transforms, gradients): types 0, 2, 3 and 4 */
  const clampTo = (v, lo, hi) => (isFinite(lo) && v < lo ? lo : isFinite(hi) && v > hi ? hi : v);
  function runPostScript(src, inputs) {
    const toks = src.replace(/[{}]/g, m => ' ' + m + ' ').split(/\s+/).filter(Boolean);
    if (toks[0] !== '{') return null; let pos = 1;
    const parse = () => { const blk = []; while (pos < toks.length) { const t = toks[pos++]; if (t === '{') blk.push(parse()); else if (t === '}') return blk; else blk.push(t); } return blk; };
    const prog = parse(); const st = inputs.slice(); let steps = 0;
    const bin = f => { const b = st.pop(), a = st.pop(); st.push(f(a, b)); };
    const un = f => { st.push(f(st.pop())); };
    function exec(blk) {
      for (let i = 0; i < blk.length; i++) {
        if (++steps > 5000) throw new Error('function too long');
        const t = blk[i];
        if (Array.isArray(t)) {
          if (blk[i + 1] === 'if') { if (st.pop()) exec(t); i++; }
          else if (Array.isArray(blk[i + 1]) && blk[i + 2] === 'ifelse') { const c = st.pop(); exec(c ? t : blk[i + 1]); i += 2; }
          continue;
        }
        const n = Number(t); if (t !== '' && !isNaN(n)) { st.push(n); continue; }
        switch (t) {
          case 'add': bin((a, b) => a + b); break; case 'sub': bin((a, b) => a - b); break; case 'mul': bin((a, b) => a * b); break;
          case 'div': bin((a, b) => a / b); break; case 'idiv': bin((a, b) => Math.trunc(a / b)); break; case 'mod': bin((a, b) => a % b); break;
          case 'neg': un(a => -a); break; case 'abs': un(Math.abs); break; case 'ceiling': un(Math.ceil); break; case 'floor': un(Math.floor); break;
          case 'round': un(a => Math.floor(a + 0.5)); break; case 'truncate': case 'cvi': un(Math.trunc); break; case 'cvr': break; case 'sqrt': un(Math.sqrt); break;
          case 'sin': un(a => Math.sin(a * Math.PI / 180)); break; case 'cos': un(a => Math.cos(a * Math.PI / 180)); break;
          case 'atan': bin((a, b) => { let d = Math.atan2(a, b) * 180 / Math.PI; if (d < 0) d += 360; return d; }); break;
          case 'exp': bin(Math.pow); break; case 'ln': un(Math.log); break; case 'log': un(Math.log10); break;
          case 'eq': bin((a, b) => a === b); break; case 'ne': bin((a, b) => a !== b); break; case 'gt': bin((a, b) => a > b); break;
          case 'ge': bin((a, b) => a >= b); break; case 'lt': bin((a, b) => a < b); break; case 'le': bin((a, b) => a <= b); break;
          case 'and': bin((a, b) => (typeof a === 'boolean' ? a && b : a & b)); break; case 'or': bin((a, b) => (typeof a === 'boolean' ? a || b : a | b)); break;
          case 'xor': bin((a, b) => (typeof a === 'boolean' ? a !== b : a ^ b)); break; case 'not': un(a => (typeof a === 'boolean' ? !a : ~a)); break;
          case 'bitshift': bin((a, b) => (b >= 0 ? a << b : a >> -b)); break; case 'true': st.push(true); break; case 'false': st.push(false); break;
          case 'pop': st.pop(); break; case 'exch': { const b = st.pop(), a = st.pop(); st.push(b, a); break; }
          case 'dup': st.push(st[st.length - 1]); break;
          case 'copy': { const n2 = st.pop(); if (n2 > 0) st.push(...st.slice(-n2)); break; }
          case 'index': { const n2 = st.pop(); st.push(st[st.length - 1 - n2]); break; }
          case 'roll': { const j = st.pop(), n2 = st.pop(); if (n2 > 0) { const k = ((j % n2) + n2) % n2; const sl = st.splice(st.length - n2, n2); st.push(...sl.slice(n2 - k), ...sl.slice(0, n2 - k)); } break; }
          default: throw new Error('unsupported operator ' + t);
        }
      }
    }
    exec(prog);
    return st.map(Number);
  }
  function evalFn(ctx, fobj, inp, depth) {
    depth = depth || 0;
    try {
      const f = look(ctx, fobj); const d = dictOf(f); if (!d || depth > 6) return null;
      const type = num(look(ctx, d.get(N('FunctionType')))); const domain = numArr(ctx, d.get(N('Domain'))) || [0, 1]; const range = numArr(ctx, d.get(N('Range')));
      const x = inp.map((v, i) => clampTo(v, domain[2 * i], domain[2 * i + 1])); let out = null;
      if (type === 2) {
        const C0 = numArr(ctx, d.get(N('C0'))) || [0], C1 = numArr(ctx, d.get(N('C1'))) || [1], n = num(look(ctx, d.get(N('N'))));
        out = C0.map((c0, i) => c0 + Math.pow(x[0], isFinite(n) ? n : 1) * ((C1[i] != null ? C1[i] : 1) - c0));
      } else if (type === 3) {
        const fns = arr(look(ctx, d.get(N('Functions')))), bounds = numArr(ctx, d.get(N('Bounds'))) || [], enc = numArr(ctx, d.get(N('Encode'))) || [];
        let k = 0; while (k < bounds.length && x[0] >= bounds[k]) k++;
        const lo = k === 0 ? domain[0] : bounds[k - 1], hi = k === bounds.length ? domain[1] : bounds[k]; const e0 = enc[2 * k] != null ? enc[2 * k] : 0, e1 = enc[2 * k + 1] != null ? enc[2 * k + 1] : 1;
        out = evalFn(ctx, fns.get(k), [hi === lo ? e0 : e0 + (x[0] - lo) * (e1 - e0) / (hi - lo)], depth + 1);
      } else if (type === 0 && inp.length === 1 && range) {
        const size = numArr(ctx, d.get(N('Size')))[0], bps = num(look(ctx, d.get(N('BitsPerSample')))); const enc = numArr(ctx, d.get(N('Encode'))) || [0, size - 1]; const dec = numArr(ctx, d.get(N('Decode'))) || range;
        const nOut = range.length / 2; const bytes = lib().decodePDFRawStream(f).decode(); const max = Math.pow(2, bps) - 1;
        const sample = idx => { const r = []; for (let k = 0; k < nOut; k++) { let bitPos = (idx * nOut + k) * bps, v = 0; for (let b = 0; b < bps; b++, bitPos++) v = v * 2 + ((bytes[bitPos >> 3] >> (7 - (bitPos & 7))) & 1); r.push(dec[2 * k] + v * (dec[2 * k + 1] - dec[2 * k]) / max); } return r; };
        const e = clampTo(enc[0] + (x[0] - domain[0]) * (enc[1] - enc[0]) / ((domain[1] - domain[0]) || 1), 0, size - 1); const i0 = Math.floor(e), i1 = Math.min(size - 1, i0 + 1), fr = e - i0;
        const a = sample(i0), b = sample(i1); out = a.map((v, i) => v + fr * (b[i] - v));
      } else if (type === 4) {
        out = runPostScript(latin1(lib().decodePDFRawStream(f).decode()), x);
      }
      if (out && range) out = out.map((v, i) => clampTo(v, range[2 * i], range[2 * i + 1]));
      return out && out.every(Number.isFinite) ? out : null;
    } catch (e) { return null; }
  }
  // def + components -> { rgb:[r,g,b] 0-255, cmyk:[c,m,y,k] 0-1 | null }, or null when it cannot be worked out
  function resolveColour(ctx, def, comps) {
    const C = root.PW && root.PW.colour; if (!C || !def) return null;
    const g = v => (isFinite(v) ? v : 0);
    switch (def.kind) {
      case 'gray': return { rgb: [0, 0, 0].map(() => Math.round(255 * C.clamp01(g(comps[0])))), cmyk: null, gray: C.clamp01(g(comps[0])) };
      case 'rgb': return { rgb: [0, 1, 2].map(i => Math.round(255 * C.clamp01(g(comps[i])))), cmyk: null };
      case 'cmyk': { const c = [0, 1, 2, 3].map(i => C.clamp01(g(comps[i]))); return { rgb: C.cmykToRgb(c[0], c[1], c[2], c[3]), cmyk: c }; }
      case 'lab': return { rgb: C.labToRgb(g(comps[0]), g(comps[1]), g(comps[2])), cmyk: null };
      case 'sep': case 'devn': { const alt = evalFn(ctx, def.fn, comps); return alt ? resolveColour(ctx, def.alt, alt) : null; }
      default: return null;
    }
  }
  const initialComps = def => (def.kind === 'sep' || def.kind === 'devn' ? new Array((def.names || [0]).length).fill(1) : def.kind === 'cmyk' ? [0, 0, 0, 1] : [0, 0, 0]);

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
  const FILL_OPS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']), STROKE_OPS = new Set(['S', 's', 'B', 'B*', 'b', 'b*']), TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);
  const pct = v => Math.round(v * 1000) / 10;

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
    const facts = { bytes: bytes.length, pageCount: pages.length, pages: [], fonts: [], images: [], placements: [], colours: [], overprintPages: [],
      spots: [], output: { pdfx: null, intent: null, identifier: null }, meta: {}, unreadablePages: [], inlineImages: 0, gradients: 0, patterns: 0 };

    try { facts.meta.producer = doc.getProducer() || ''; facts.meta.creator = doc.getCreator() || ''; } catch (e) { /* optional */ }
    try { facts.meta.version = ctx.header.getVersionString(); } catch (e) { /* optional */ }
    try {
      const info = look(ctx, ctx.trailerInfo && ctx.trailerInfo.Info);
      const x = info && dget(ctx, info, 'GTS_PDFXVersion'); if (x) facts.output.pdfx = textOf(x);
      const oi = arr(look(ctx, doc.catalog.get(N('OutputIntents'))));
      if (oi && oi.size()) { const d = look(ctx, oi.get(0)); const id = dget(ctx, d, 'OutputConditionIdentifier'); facts.output.intent = true; facts.output.identifier = id ? textOf(id) : ''; }
    } catch (e) { /* optional */ }

    const imageIds = new Map(), fontIds = new Map(), opCache = new Map(), colourMap = new Map();
    const overprint = new Set();
    const streamBytes = s => L.decodePDFRawStream(s).decode();
    const opsOfStream = s => { let o = opCache.get(s); if (!o) { o = parseOps(streamBytes(s)); opCache.set(s, o); } return o; };

    /* ---- colour inventory: every colour that is actually painted */
    function addColour(key, base, pageIdx, source, tint) {
      let c = colourMap.get(key);
      if (!c) { c = Object.assign({ key, pages: new Set(), sources: new Set(), tints: new Set(), uses: 0 }, base); colourMap.set(key, c); }
      c.uses++; c.pages.add(pageIdx); c.sources.add(source); if (tint != null) c.tints.add(Math.round(tint * 100));
    }
    function recordPaint(def, comps, pageIdx, source) {
      if (!def || def.kind === 'pattern') return;
      const r = resolveColour(ctx, def, comps) || {}; const hex = r.rgb ? root.PW.colour.hex(r.rgb) : null;
      if (def.kind === 'gray') { const k = pct(1 - (r.gray != null ? r.gray : comps[0] || 0)); addColour('gray:' + k, { kind: 'gray', label: k === 0 ? 'White' : k === 100 ? 'Black (gray)' : 'Gray ' + k + '% K', rgb: hex, cmyk: null, tac: null }, pageIdx, source); }
      else if (def.kind === 'rgb') { const v = [0, 1, 2].map(i => Math.round(255 * (comps[i] || 0))); addColour('rgb:' + v.join(','), { kind: 'rgb', label: 'RGB ' + v.join(' '), rgb: hex, cmyk: null, tac: null, icc: def.label !== 'DeviceRGB' }, pageIdx, source); }
      else if (def.kind === 'cmyk') { const v = [0, 1, 2, 3].map(i => pct(comps[i] || 0)); addColour('cmyk:' + v.join(','), { kind: 'cmyk', label: `C${v[0]} M${v[1]} Y${v[2]} K${v[3]}`, rgb: hex, cmyk: v, tac: Math.round((v[0] + v[1] + v[2] + v[3]) * 10) / 10 }, pageIdx, source); }
      else if (def.kind === 'lab') addColour('lab:' + comps.map(x => Math.round(x)).join(','), { kind: 'lab', label: 'Lab ' + comps.slice(0, 3).map(x => Math.round(x)).join(' '), rgb: hex, cmyk: null, tac: null }, pageIdx, source);
      else if (def.kind === 'sep') {
        if (def.family === 'Registration') addColour('registration', { kind: 'registration', label: 'Registration', rgb: '#000000', cmyk: null, tac: null }, pageIdx, source);
        else if (def.family === 'Spot') addSpot(def, def.spot[0], 0, comps, pageIdx, source);
      } else if (def.kind === 'devn') {
        const zero = comps.slice();
        def.names.forEach((n, i) => { if (def.spot.includes(n) && (comps[i] || 0) > 0) { addSpot(def, n, i, comps, pageIdx, source); zero[i] = 0; } });
        if (zero.some((v, i) => v > 0 && !def.spot.includes(def.names[i]))) { const a = evalFn(ctx, def.fn, zero); if (a) recordPaint(def.alt, a, pageIdx, source); }
      }
    }
    function addSpot(def, name, idx, comps, pageIdx, source) {
      const one = new Array((def.names || [0]).length).fill(0); one[idx] = 1; const full = resolveColour(ctx, def, one);
      addColour('spot:' + name, { kind: 'spot', label: name, rgb: full && full.rgb ? root.PW.colour.hex(full.rgb) : null, cmyk: full && full.cmyk ? full.cmyk.map(pct) : null, tac: null }, pageIdx, source, comps[idx] != null ? comps[idx] : 1);
    }
    function recordShading(sd, res, pageIdx) {
      const d = dictOf(sd); if (!d) return; facts.gradients++;
      const def = csDef(ctx, d.get(N('ColorSpace')), res); const fnObj = look(ctx, d.get(N('Function'))); const dom = numArr(ctx, d.get(N('Domain'))) || [0, 1];
      let a = null, b = null;
      if (fnObj && !arr(fnObj)) { const o0 = evalFn(ctx, fnObj, [dom[0]]), o1 = evalFn(ctx, fnObj, [dom[1]]); a = o0 && resolveColour(ctx, def, o0); b = o1 && resolveColour(ctx, def, o1); }
      const h0 = a && a.rgb ? root.PW.colour.hex(a.rgb) : null, h1 = b && b.rgb ? root.PW.colour.hex(b.rgb) : null;
      addColour('grad:' + def.family + ':' + h0 + ':' + h1, { kind: 'gradient', label: 'Gradient (' + def.family + ')', family: def.family, rgb: h0, rgb2: h1, cmyk: null, tac: null }, pageIdx, 'gradient');
      if (def.kind === 'sep' && def.family === 'Spot') addSpot(def, def.spot[0], 0, [1], pageIdx, 'gradient');
    }

    function imageIndex(xo, res) {
      let id = imageIds.get(xo); if (id != null) return id;
      const d = dictOf(xo); const def = csDef(ctx, d.get(N('ColorSpace')), res);
      const mask = look(ctx, d.get(N('ImageMask'))) === ctx.obj(true);
      const filter = look(ctx, d.get(N('Filter')));
      const f = filter ? (nameStr(filter) || (arr(filter) ? nameStr(look(ctx, filter.get(arr(filter).size() - 1))) : null)) : null;
      const swatches = {};
      if (!mask && (def.kind === 'sep' || def.kind === 'devn')) def.spot.forEach(n => { const i = def.names.indexOf(n); const one = new Array(def.names.length).fill(0); one[i] = 1; const r = resolveColour(ctx, def, one); swatches[n] = r && r.rgb ? root.PW.colour.hex(r.rgb) : null; });
      const rec = { id: facts.images.length, w: num(look(ctx, d.get(N('Width')))), h: num(look(ctx, d.get(N('Height')))), bpc: num(look(ctx, d.get(N('BitsPerComponent')))) || (mask ? 1 : 8),
        mask, family: mask ? 'Mask' : def.family, label: mask ? '1-bit mask' : def.label, spot: def.spot, swatches, filter: f, hasSMask: !!d.get(N('SMask')), uses: 0 };
      facts.images.push(rec); imageIds.set(xo, rec.id); return rec.id;
    }
    function fontIndex(fd) {
      let id = fontIds.get(fd); if (id != null) return id;
      const sub = nameStr(dget(ctx, fd, 'Subtype')) || ''; const base = nameStr(dget(ctx, fd, 'BaseFont')) || '(unnamed)';
      let desc = dget(ctx, fd, 'FontDescriptor');
      if (sub === 'Type0') { const df = arr(dget(ctx, fd, 'DescendantFonts')); const first = df && look(ctx, df.get(0)); if (first) desc = dget(ctx, first, 'FontDescriptor'); }
      const embedded = sub === 'Type3' ? true : !!(desc && (dget(ctx, desc, 'FontFile') || dget(ctx, desc, 'FontFile2') || dget(ctx, desc, 'FontFile3')));
      const rec = { id: facts.fonts.length, name: base.replace(/^[A-Z]{6}\+/, ''), subset: /^[A-Z]{6}\+/.test(base), type: sub, embedded, pages: [] };
      facts.fonts.push(rec); fontIds.set(fd, rec.id); return rec.id;
    }
    const matrixOf = d => { const m = arr(dget(ctx, d, 'Matrix')); const M = m && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map(k => num(look(ctx, m.get(k)))) : null; return M && M.every(Number.isFinite) ? M : [1, 0, 0, 1, 0, 0]; };

    // flags: { mask: inside a soft mask or pattern tile (images there do not count for resolution) }
    function run(ops, res, ctm, inherit, pageIdx, depth, seen, mask) {
      const stack = [];
      let g = { ctm, fill: inherit.fill || { def: DEV.gray, comps: [0] }, stroke: inherit.stroke || { def: DEV.gray, comps: [0] }, tr: 0 };
      const paintFill = () => {
        const c = g.fill; if (!c) return;
        if (c.pattern) { usePattern(c.pattern); return; }
        recordPaint(c.def, c.comps, pageIdx, 'artwork');
      };
      const paintStroke = () => {
        const c = g.stroke; if (!c) return;
        if (c.pattern) { usePattern(c.pattern); return; }
        recordPaint(c.def, c.comps, pageIdx, 'artwork');
      };
      function usePattern(name) {
        const pats = res && dget(ctx, res, 'Pattern'); const po = pats && dget(ctx, pats, name); const pd = dictOf(po); if (!pd) return;
        const key = pageIdx + ':' + (pd._pwid || (pd._pwid = ++seen.counter));
        if (seen.patterns.has(key)) return; seen.patterns.add(key);
        const type = num(look(ctx, pd.get(N('PatternType')))); facts.patterns++;
        if (type === 2) { const sh = dget(ctx, pd, 'Shading'); if (sh) recordShading(sh, res, pageIdx); }
        else if (type === 1 && depth < 8) { let pops; try { pops = opsOfStream(po); } catch (e) { return; } run(pops, dget(ctx, pd, 'Resources') || res, concat(matrixOf(pd), g.ctm), {}, pageIdx, depth + 1, seen, true); }
      }
      const setColour = (which, def, comps, pattern) => { g[which] = { def, comps, pattern }; };
      for (const { op, args } of ops) {
        switch (op) {
          case 'q': stack.push(Object.assign({}, g)); break;
          case 'Q': if (stack.length) g = stack.pop(); break;
          case 'cm': if (args.length >= 6 && args.slice(-6).every(Number.isFinite)) g.ctm = concat(args.slice(-6), g.ctm); break;
          case 'g': setColour('fill', DEV.gray, args.slice(-1)); break; case 'G': setColour('stroke', DEV.gray, args.slice(-1)); break;
          case 'rg': setColour('fill', DEV.rgb, args.slice(-3)); break; case 'RG': setColour('stroke', DEV.rgb, args.slice(-3)); break;
          case 'k': setColour('fill', DEV.cmyk, args.slice(-4)); break; case 'K': setColour('stroke', DEV.cmyk, args.slice(-4)); break;
          case 'cs': case 'CS': { const nm = args[0] && args[0].n; if (!nm) break; const def = csDef(ctx, N(nm), res); setColour(op === 'cs' ? 'fill' : 'stroke', def, def.kind === 'pattern' ? [] : initialComps(def)); break; }
          case 'sc': case 'scn': case 'SC': case 'SCN': {
            const which = op[0] === 's' ? 'fill' : 'stroke'; const cur = g[which]; if (!cur) break;
            const nums = args.filter(Number.isFinite); const nm = args.length && args[args.length - 1] && args[args.length - 1].n;
            if (cur.def.kind === 'pattern' && nm) setColour(which, cur.def, [], nm); else setColour(which, cur.def, nums);
            break;
          }
          case 'Tr': g.tr = args[0]; break;
          case 'sh': { const nm = args[0] && args[0].n; const shs = nm && res && dget(ctx, res, 'Shading'); const sd = shs && dget(ctx, shs, nm); if (sd) recordShading(sd, res, pageIdx); break; }
          case 'gs': {
            const nm = args[0] && args[0].n; const egs = nm && res && dget(ctx, res, 'ExtGState'); const gd = egs && dget(ctx, egs, nm); if (!gd) break;
            const T = ctx.obj(true); if (look(ctx, dictOf(gd).get(N('OP'))) === T || look(ctx, dictOf(gd).get(N('op'))) === T) overprint.add(pageIdx);
            const sm = dget(ctx, gd, 'SMask'); const grp = sm && !nameStr(sm) && dget(ctx, sm, 'G'); // soft masks (shadows, feathers) hold their own content
            if (grp && depth < 8) { let fops; try { fops = opsOfStream(grp); } catch (e) { break; } run(fops, dget(ctx, grp, 'Resources') || res, concat(matrixOf(dictOf(grp)), g.ctm), { fill: g.fill, stroke: g.stroke }, pageIdx, depth + 1, seen, true); }
            break;
          }
          case 'Tf': {
            const nm = args[0] && args[0].n; const fonts = nm && res && dget(ctx, res, 'Font'); const fd = fonts && dget(ctx, fonts, nm);
            if (fd) { const id = fontIndex(fd); const key = id + ':' + pageIdx; if (!seen.fonts.has(key)) { seen.fonts.add(key); facts.fonts[id].pages.push(pageIdx); } }
            break;
          }
          case 'BI': { facts.inlineImages++; const w = args[0], h = args[1], cs = (args[2] && args[2].n) || ''; const fam = /RGB/.test(cs) ? 'RGB' : /CMYK/.test(cs) ? 'CMYK' : /^(G|Gray|DeviceGray)$/.test(cs) ? 'Gray' : 'Other'; placeImage({ id: -1, w, h, mask: false, family: fam, label: 'inline ' + cs }, g.ctm, pageIdx, mask); break; }
          case 'Do': {
            const nm = args[0] && args[0].n; const xos = nm && res && dget(ctx, res, 'XObject'); const xo = xos && dget(ctx, xos, nm); if (!xo) break;
            const sub = nameStr(dget(ctx, xo, 'Subtype'));
            if (sub === 'Image') { const rec = facts.images[imageIndex(xo, res)]; placeImage(rec, g.ctm, pageIdx, mask); if (rec.mask) paintFill(); }
            else if (sub === 'Form' && depth < 8) {
              let fops; try { fops = opsOfStream(xo); } catch (e) { break; }
              run(fops, dget(ctx, xo, 'Resources') || res, concat(matrixOf(dictOf(xo)), g.ctm), { fill: g.fill, stroke: g.stroke }, pageIdx, depth + 1, seen, mask);
            }
            break;
          }
          default:
            if (FILL_OPS.has(op)) paintFill();
            if (STROKE_OPS.has(op)) paintStroke();
            if (TEXT_OPS.has(op)) { if ([0, 2, 4, 6].includes(g.tr)) paintFill(); if ([1, 2, 5, 6].includes(g.tr)) paintStroke(); }
            break;
        }
      }
    }
    function placeImage(rec, ctm, pageIdx, inMask) {
      if (rec.id >= 0) facts.images[rec.id].uses++;
      const wPt = Math.hypot(ctm[0], ctm[1]), hPt = Math.hypot(ctm[2], ctm[3]);
      facts.placements.push({ page: pageIdx, image: rec.id, family: rec.family, label: rec.label, mask: !!rec.mask, softMask: !!inMask, px: [rec.w, rec.h], wPt, hPt,
        ppiX: wPt > 0 ? rec.w / (wPt / 72) : null, ppiY: hPt > 0 ? rec.h / (hPt / 72) : null });
    }

    const seen = { fonts: new Set(), patterns: new Set(), counter: 0 };
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const media = rectOf(page.getMediaBox()); const crop = rectOf(page.getCropBox());
      let blend = null; try { const grp = dget(ctx, page.node, 'Group'); if (grp) blend = csDef(ctx, dictOf(grp).get(N('CS')), null).family; else blend = 'none'; } catch (e) { /* optional */ }
      facts.pages.push({ index: pi, media, crop, trim: boxOf(ctx, page, 'TrimBox'), bleed: boxOf(ctx, page, 'BleedBox'), art: boxOf(ctx, page, 'ArtBox'), blend });
      try {
        const res = page.node.Resources(); const contents = page.node.Contents(); const bytesList = [];
        if (contents) {
          if (arr(contents)) for (let k = 0; k < contents.size(); k++) { const st = look(ctx, contents.get(k)); if (st) bytesList.push(streamBytes(st)); }
          else bytesList.push(streamBytes(contents));
        }
        const total = bytesList.reduce((n, b) => n + b.length + 1, 0); const all = new Uint8Array(total); let off = 0;
        for (const b of bytesList) { all.set(b, off); off += b.length; all[off++] = 10; }
        run(parseOps(all), res, [1, 0, 0, 1, 0, 0], {}, pi, 0, seen, false);
      } catch (e) { facts.unreadablePages.push(pi); }
      if (pi % 10 === 9 || pi === pages.length - 1) { progress((pi + 1) / pages.length); await tick(); }
    }
    // spot colours that only appear inside images
    for (const pl of facts.placements) {
      if (pl.mask || pl.softMask || pl.image < 0) continue; const im = facts.images[pl.image];
      for (const n of im.spot) addColour('spot:' + n, { kind: 'spot', label: n, rgb: (im.swatches && im.swatches[n]) || null, cmyk: null, tac: null }, pl.page, 'image');
    }
    facts.overprintPages = Array.from(overprint).sort((a, b) => a - b);
    facts.colours = Array.from(colourMap.values()).map(c => ({ key: c.key, kind: c.kind, label: c.label, rgb: c.rgb || null, rgb2: c.rgb2 || null, cmyk: c.cmyk || null, tac: c.tac, family: c.family || null, icc: !!c.icc,
      tints: Array.from(c.tints).sort((a, b) => b - a), sources: Array.from(c.sources), pages: Array.from(c.pages).sort((a, b) => a - b), uses: c.uses }))
      .sort((a, b) => b.pages.length - a.pages.length || b.uses - a.uses);
    facts.spots = facts.colours.filter(c => c.kind === 'spot').map(c => c.label);
    for (const f of facts.fonts) f.pages.sort((a, b) => a - b);
    return facts;
  }

  /* ---------------------------------------------------------------- evaluate */
  const DEFAULTS = { bleedMm: 3, minPpi: 300, allowRgb: false, allowSpot: false, maxInk: 300 };
  const fmt = n => (Math.round(n * 10) / 10).toString();
  const fmtMm = pt => fmt(pt / MM);

  function pageBleedPt(p) { // how far the page extends past the trim on its smallest side
    const trim = p.trim; if (!trim) return { bleed: 0, known: false };
    const outer = p.bleed || p.media;
    const d = [trim.x - outer.x, trim.y - outer.y, (outer.x + outer.w) - (trim.x + trim.w), (outer.y + outer.h) - (trim.y + trim.h)];
    return { bleed: Math.max(0, Math.min.apply(null, d)), known: true };
  }
  const pageList = (pages, max) => { const p = pages.slice(0, max || 6).map(x => x + 1).join(', '); return pages.length > (max || 6) ? p + ' and ' + (pages.length - (max || 6)) + ' more' : p; };

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
    const missing = facts.fonts.filter(f => !f.embedded), type3 = facts.fonts.filter(f => f.type === 'Type3');
    const missingNames = Array.from(new Set(missing.map(f => f.name)));
    if (!facts.fonts.length) add('info', 'fonts', 'Fonts', 'No text was found in the page content (the text may be outlined or in images).');
    else if (missing.length) add('error', 'fonts', 'Fonts not embedded', `${missingNames.join(', ')} ${missingNames.length === 1 ? 'is' : 'are'} not embedded. The printer's machine will substitute another font. Export again with fonts embedded.`, uniq(missing.flatMap(f => f.pages)));
    else { const names = Array.from(new Set(facts.fonts.map(f => f.name))); add('pass', 'fonts', 'Fonts embedded', `${names.length} font${names.length === 1 ? '' : 's'}, all embedded: ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}.`); }
    if (type3.length) add('warn', 'fonts-type3', 'Type 3 fonts', `${type3.map(f => f.name).join(', ')} ${type3.length === 1 ? 'is a' : 'are'} Type 3 font${type3.length === 1 ? '' : 's'}; these can print less crisply and cannot be hinted.`, uniq(type3.flatMap(f => f.pages)));

    // ---- colour: one verdict, with the detail behind it
    const real = facts.placements.filter(p => !p.mask && !p.softMask); // soft-mask images (shadows, feathers) do not affect print quality
    const rgbP = real.filter(p => p.family === 'RGB'), labP = real.filter(p => p.family === 'Lab');
    const cols = facts.colours;
    const rgbCols = cols.filter(c => c.kind === 'rgb'), labCols = cols.filter(c => c.kind === 'lab'), gradRgb = cols.filter(c => c.kind === 'gradient' && c.family === 'RGB');
    const blendRgb = facts.pages.filter(p => p.blend === 'RGB').map(p => p.index);
    const vecRgbPages = uniq(rgbCols.flatMap(c => c.pages)), gradPages = uniq(gradRgb.flatMap(c => c.pages));
    const rgbAnywhere = rgbP.length || rgbCols.length || gradRgb.length || blendRgb.length;
    const imgRgbN = new Set(rgbP.map(p => p.image)).size;
    if (rgbAnywhere && !profile.allowRgb) {
      if (rgbP.length) add('warn', 'image-rgb', 'RGB images', `${rgbP.length} placement${rgbP.length === 1 ? '' : 's'} of ${imgRgbN} RGB image${imgRgbN === 1 ? '' : 's'}. Many printers convert these to CMYK themselves, which can shift colours. Convert them yourself, or tick "my printer accepts RGB" in your profile.`, uniq(rgbP.map(p => p.page)));
      if (rgbCols.length) add('warn', 'vector-rgb', 'RGB colour in text or artwork', `${rgbCols.length} RGB colour${rgbCols.length === 1 ? '' : 's'} painted on ${vecRgbPages.length} page${vecRgbPages.length === 1 ? '' : 's'}. Black text set in RGB can print as a four-colour mix.`, vecRgbPages);
      if (gradRgb.length) add('warn', 'gradient-rgb', 'RGB gradients', `${gradRgb.length} gradient${gradRgb.length === 1 ? '' : 's'} blend in RGB, so they will be converted by the printer.`, gradPages);
      if (blendRgb.length) add('warn', 'blend-rgb', 'Page blending space is RGB', 'Transparent objects (shadows, feathers, blends) can be converted to RGB even when every swatch is CMYK. In InDesign, set Edit > Transparency Blend Space to Document CMYK.', blendRgb);
    } else if (rgbAnywhere) {
      add('info', 'colour-rgb', 'RGB present', 'RGB colour was found, and your profile accepts it.', uniq([].concat(rgbP.map(p => p.page), vecRgbPages, gradPages, blendRgb)));
    }
    if (labP.length || labCols.length) add('warn', 'colour-lab', 'Lab colour', 'Lab colours can be handled inconsistently by print workflows.', uniq(labP.map(p => p.page).concat(labCols.flatMap(c => c.pages))));
    if (!rgbAnywhere && !labP.length && !labCols.length) {
      const cm = cols.filter(c => c.kind === 'cmyk').length, parts = [];
      const imgs = facts.images.filter(i => !i.mask).length; if (imgs) parts.push(`${imgs} image${imgs === 1 ? '' : 's'}`);
      if (cm || cols.some(c => c.kind === 'gray')) parts.push(`${cm} CMYK colour${cm === 1 ? '' : 's'} in text and artwork`);
      add('pass', 'colour', 'All colour is CMYK or grayscale', `Checked ${parts.join(', ') || 'the page content'}${blendRgb.length === 0 && facts.pages.some(p => p.blend === 'CMYK') ? ', and the page blending space is CMYK' : ''}.`);
    }
    if (!facts.images.length && !facts.inlineImages) add('info', 'images', 'Images', 'No placed images found.');

    // ---- spot colours and registration
    const spotCols = cols.filter(c => c.kind === 'spot'), regCols = cols.filter(c => c.kind === 'registration');
    if (spotCols.length) {
      const detail = spotCols.slice(0, 8).map(c => `${c.label}${c.tints.length && c.tints.some(t => t < 100) ? ' (tints ' + c.tints.join(', ') + '%)' : ''} on ${c.pages.length} page${c.pages.length === 1 ? '' : 's'} (${pageList(c.pages, 5)})`).join('; ');
      add(profile.allowSpot ? 'info' : 'warn', 'spot', 'Spot colours in the file', `${detail}. ${profile.allowSpot ? 'Your profile says this job uses spot colours.' : 'These print as extra plates. If the job is CMYK only, convert them to CMYK in InDesign (Swatches > Convert to Process) and export again.'}`, uniq(spotCols.flatMap(c => c.pages)));
    }
    if (regCols.length) add('warn', 'registration', 'Registration colour is used', 'Registration prints on every plate. It belongs on crop marks only. If it is on text or artwork, change it to a real colour.', uniq(regCols.flatMap(c => c.pages)));

    // ---- total ink (text and artwork; images are not checked)
    const cmykCols = cols.filter(c => c.kind === 'cmyk' && c.tac != null);
    if (cmykCols.length && profile.maxInk > 0) {
      const over = cmykCols.filter(c => c.tac > profile.maxInk + 0.5).sort((a, b) => b.tac - a.tac);
      const top = cmykCols.reduce((a, b) => (b.tac > a.tac ? b : a));
      if (over.length) add('warn', 'total-ink', `Total ink above ${profile.maxInk}%`, `${over.slice(0, 3).map(c => `${c.label} = ${fmt(c.tac)}%`).join('; ')}${over.length > 3 ? ' and ' + (over.length - 3) + ' more' : ''}. Applies to text and artwork; image ink is not measured.`, uniq(over.flatMap(c => c.pages)));
      else add('pass', 'total-ink', 'Total ink in text and artwork', `Highest is ${fmt(top.tac)}% (${top.label}), within your ${profile.maxInk}% limit. Image ink is not measured.`);
    }
    // ---- overprint
    if (facts.overprintPages.length) add('info', 'overprint', 'Overprint is switched on', 'Overprint is set on these pages. InDesign overprints 100% black by default, so this is often normal on pages with black text. Check it is intended for anything else (a spot varnish, for example). Printworks does not preview overprint.', facts.overprintPages);

    // ---- images: resolution
    const gradeable = real.filter(p => p.ppiX && p.ppiY && isFinite(p.ppiX) && isFinite(p.ppiY) && !(p.px[0] <= 1 && p.px[1] <= 1));
    if (gradeable.length) {
      const eff = p => Math.min(p.ppiX, p.ppiY);
      const low = gradeable.filter(p => eff(p) + 0.5 < profile.minPpi);
      const worst = gradeable.reduce((a, b) => (eff(b) < eff(a) ? b : a));
      if (low.length) add('warn', 'image-ppi', `Images below ${profile.minPpi} ppi`, `${low.length} placement${low.length === 1 ? ' is' : 's are'} below your minimum. Lowest is ${Math.round(eff(worst))} ppi on page ${worst.page + 1}. Soft or pixelated print is likely if the image is large on the finished piece.`, uniq(low.map(p => p.page)), { worst: { page: worst.page, ppi: Math.round(eff(worst)) } });
      else add('pass', 'image-ppi', 'Image resolution', `Every placed image is at least ${profile.minPpi} ppi (lowest ${Math.round(eff(worst))}).`);
    }
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

    // ---- colour inventory + page map for the UI
    const problemKinds = c => c.kind === 'rgb' || c.kind === 'lab' || c.kind === 'registration' || (c.kind === 'gradient' && c.family === 'RGB') || (c.kind === 'spot' && !profile.allowSpot);
    const colours = cols.map(c => Object.assign({}, c, { problem: !!(problemKinds(c) && !(profile.allowRgb && (c.kind === 'rgb' || c.family === 'RGB'))) }));
    const pageFlags = facts.pages.map(() => ({ rgb: false, spot: false, reg: false, overprint: false }));
    for (const p of rgbP) pageFlags[p.page].rgb = true;
    for (const pg of vecRgbPages.concat(gradPages, blendRgb)) pageFlags[pg].rgb = true;
    for (const c of spotCols) for (const pg of c.pages) pageFlags[pg].spot = true;
    for (const c of regCols) for (const pg of c.pages) pageFlags[pg].reg = true;
    for (const pg of facts.overprintPages) pageFlags[pg].overprint = true;
    const imageSpaces = {}; for (const p of real) { const k = p.family; (imageSpaces[k] = imageSpaces[k] || { placements: 0, pages: new Set(), images: new Set() }); imageSpaces[k].placements++; imageSpaces[k].pages.add(p.page); imageSpaces[k].images.add(p.image); }
    const imageColour = Object.entries(imageSpaces).map(([family, v]) => ({ family, placements: v.placements, images: v.images.size, pages: Array.from(v.pages).sort((a, b) => a - b) })).sort((a, b) => b.placements - a.placements);

    const sum = { error: 0, warn: 0, info: 0, pass: 0 }; for (const f of out) sum[f.level]++;
    const order = { error: 0, warn: 1, info: 2, pass: 3 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    return { findings: out, summary: sum, profile, colours, pageFlags, imageColour, blend: { cmyk: facts.pages.filter(p => p.blend === 'CMYK').length, rgb: blendRgb.length, none: facts.pages.filter(p => p.blend === 'none').length } };
  }

  PW.preflight = { extract, evaluate, parseOps, concat, DEFAULTS, pageBleedPt };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.preflight;
})(typeof window !== 'undefined' ? window : globalThis);
