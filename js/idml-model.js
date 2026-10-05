/*
 * Printworks IDML model (v1.5)
 *
 * Pure parsing / analysis code: no DOM access beyond DOMParser, no UI.
 * Loaded as a classic script (window.PW.idml) so the app stays build-free and
 * works from file:// as well as GitHub Pages. Also loadable from Node for tests.
 *
 * Pipeline:  designmap.xml  ->  Spreads (pages + page items, world geometry)
 *                           ->  Stories (paragraphs > runs, local overrides)
 *                           ->  Styles / Fonts
 *            then scan() joins them: page -> text frame -> story -> text.
 *
 * Coordinates are always IDML points, y down, in spread-inner space.
 */
(function (root) {
  'use strict';
  const PW = (root.PW = root.PW || {});

  /* ------------------------------------------------------------------ XML */
  let parserFactory = null;
  function setParser(factory) { parserFactory = factory; }

  function parseXml(text) {
    const parser = parserFactory ? parserFactory() : new root.DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const bad = doc.getElementsByTagName('parsererror');
    if (bad && bad.length) throw new Error('XML parse error: ' + String(bad[0].textContent).slice(0, 120));
    return doc.documentElement;
  }
  const attr = (el, name) => (el && el.hasAttribute && el.hasAttribute(name) ? el.getAttribute(name) : null);
  function els(el) {
    const out = [];
    for (let n = el && el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n);
    return out;
  }
  function child(el, tag) {
    for (let n = el && el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.tagName === tag) return n;
    return null;
  }
  function decodeXml(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function attrsOf(tag) {
    const o = {};
    String(tag).replace(/([\w:.-]+)="([^"]*)"/g, (m, k, v) => { o[k] = decodeXml(v); return m; });
    return o;
  }

  /* ------------------------------------------------------------- matrices */
  const IDENTITY = [1, 0, 0, 1, 0, 0];
  function parseMatrix(s) {
    if (!s) return IDENTITY;
    const m = String(s).trim().split(/\s+/).map(Number);
    return m.length === 6 && m.every(Number.isFinite) ? m : IDENTITY;
  }
  // P . Q : apply Q first, then P. IDML/CSS order: x' = a x + c y + e ; y' = b x + d y + f
  function mul(P, Q) {
    const [a1, b1, c1, d1, e1, f1] = P, [a2, b2, c2, d2, e2, f2] = Q;
    return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
  }
  const applyPt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function matrixInfo(m) {
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    const det = m[0] * m[3] - m[1] * m[2];
    const skew = Math.abs((m[0] * m[2] + m[1] * m[3]) / ((sx * sy) || 1));
    let angle = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    angle = Math.round(angle * 10) / 10; if (Object.is(angle, -0)) angle = 0;
    return { angle, flipped: det < 0, skewed: skew > 1e-3, scaled: Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3 };
  }
  function bboxOf(pts) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /* ----------------------------------------------------------- designmap */
  function parseDesignMap(xml) {
    const list = re => Array.from(String(xml).matchAll(re)).map(m => m[1]);
    return {
      spreads: list(/<idPkg:Spread\b[^>]*\bsrc="([^"]+)"/g),
      masterSpreads: list(/<idPkg:MasterSpread\b[^>]*\bsrc="([^"]+)"/g),
      stories: list(/<idPkg:Story\b[^>]*\bsrc="([^"]+)"/g),
      layers: Array.from(String(xml).matchAll(/<Layer\b[^>]*>/g)).map(m => attrsOf(m[0])),
    };
  }

  /* --------------------------------------------------------------- fonts */
  function cleanFontFamily(name) {
    return String(name || '').replace(/\s*\((TT|OT|T1|Type 1|TrueType|OpenType|PS|CFF)\)\s*$/i, '').trim();
  }
  function parseFonts(xml) {
    return Array.from(String(xml || '').matchAll(/<Font\b[^>]*>/g)).map(m => {
      const a = attrsOf(m[0]);
      return { self: a.Self, family: a.FontFamily || '', name: a.Name || '', style: a.FontStyleName || '',
        postscript: a.PostScriptName || '', status: a.Status || '', type: a.FontType || '' };
    });
  }

  /* -------------------------------------------------------------- styles */
  // Properties that matter for typography. Attributes AND <Properties> children are read.
  const LOCAL_ATTRS = { FontStyle: 'fontStyle', PointSize: 'size', FillColor: 'fill', Tracking: 'tracking',
    BaselineShift: 'baselineShift', Justification: 'justification', Capitalization: 'caps',
    Position: 'position', AppliedLanguage: 'lang' };
  function readLocal(el) {
    const o = {};
    for (const a in LOCAL_ATTRS) { const v = attr(el, a); if (v != null) o[LOCAL_ATTRS[a]] = v; }
    const p = child(el, 'Properties');
    if (p) {
      const f = child(p, 'AppliedFont'); if (f) o.font = f.textContent.trim();
      const l = child(p, 'Leading'); if (l) o.leading = l.textContent.trim();
    }
    return o;
  }
  function readStyle(el) {
    const s = Object.assign({ self: attr(el, 'Self'), name: attr(el, 'Name') }, readLocal(el));
    const p = child(el, 'Properties');
    const b = p && child(p, 'BasedOn');
    s.basedOn = b ? b.textContent.trim() : null;
    return s;
  }
  function parseStyles(xml) {
    const out = { para: {}, char: {} };
    if (!xml) return out;
    const r = parseXml(xml);
    for (const el of Array.from(r.getElementsByTagName('ParagraphStyle'))) { const s = readStyle(el); out.para[s.self] = s; }
    for (const el of Array.from(r.getElementsByTagName('CharacterStyle'))) { const s = readStyle(el); out.char[s.self] = s; }
    return out;
  }
  const NORMAL_PARA = 'ParagraphStyle/$ID/NormalParagraphStyle';
  const FIELDS = ['font', 'fontStyle', 'size', 'leading', 'justification', 'fill', 'tracking'];
  function lookupStyle(table, id, prefix) {
    if (!id) return null;
    return table[id] || table[prefix + id] || null;
  }
  // Flatten a style through its BasedOn chain (nearest definition wins).
  function resolveStyle(table, id, prefix, rootId) {
    const chain = []; const seen = new Set();
    let cur = lookupStyle(table, id, prefix);
    while (cur && !seen.has(cur.self)) { seen.add(cur.self); chain.push(cur); cur = lookupStyle(table, cur.basedOn, prefix); }
    const rootStyle = rootId ? table[rootId] : null;
    if (rootStyle && !seen.has(rootStyle.self)) chain.push(rootStyle);
    const out = {};
    for (const s of chain.reverse()) for (const k of FIELDS) if (s[k] != null && s[k] !== '') out[k] = s[k];
    return out;
  }
  const isDefaultParaStyle = id => !id || /NormalParagraphStyle$|\[No paragraph style\]$/i.test(id);

  /* ------------------------------------------------------------- stories */
  function parseStory(text) {
    const r = parseXml(text);
    const st = child(r, 'Story') || r;
    const story = { id: attr(st, 'Self'), paragraphs: [], chars: 0, anchoredStories: [],
      features: { tables: 0, footnotes: 0, anchored: 0, notes: 0, specials: 0, lineBreaks: 0, variables: 0 } };
    let cur = null;
    const ensure = ctx => {
      if (!cur || cur.closed) {
        cur = { styleId: ctx.pStyle, local: ctx.pLocal, runs: [], closed: false, inTable: ctx.inTable };
        story.paragraphs.push(cur);
      }
      return cur;
    };
    const SKIP = new Set(['Properties', 'StoryPreference', 'InCopyExportOption']);
    const OBJECTS = new Set(['TextFrame', 'Rectangle', 'Oval', 'Polygon', 'GraphicLine', 'Group']);
    function walk(el, ctx) {
      for (const c of els(el)) {
        const t = c.tagName;
        if (SKIP.has(t)) continue;
        if (t === 'ParagraphStyleRange') {
          if (cur) cur.closed = true;
          walk(c, Object.assign({}, ctx, { pStyle: attr(c, 'AppliedParagraphStyle'), pLocal: readLocal(c) }));
        } else if (t === 'CharacterStyleRange') {
          walk(c, Object.assign({}, ctx, { cStyle: attr(c, 'AppliedCharacterStyle'), cLocal: readLocal(c) }));
        } else if (t === 'Content') {
          const p = ensure(ctx); let s = '';
          for (let n = c.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue;
            else if (n.nodeType === 7) story.features.specials++;
          }
          story.features.lineBreaks += (s.match(/\u2028/g) || []).length;
          p.runs.push({ text: s, charStyle: ctx.cStyle, local: ctx.cLocal });
          story.chars += s.length;
        } else if (t === 'Br') {
          ensure(ctx).closed = true;
        } else if (t === 'Table') {
          story.features.tables++; walk(c, Object.assign({}, ctx, { inTable: true }));
        } else if (t === 'Footnote') {
          story.features.footnotes++; walk(c, ctx);
        } else if (t === 'Note') {
          story.features.notes++;
        } else if (t === 'TextVariableInstance') {
          story.features.variables++;
        } else if (OBJECTS.has(t)) {
          story.features.anchored++;
          const ps = t === 'TextFrame' ? attr(c, 'ParentStory') : null;
          if (ps) story.anchoredStories.push(ps);
        } else {
          walk(c, ctx); // XMLElement, HyperlinkTextSource, Change, Row, Cell ...
        }
      }
    }
    walk(st, { pStyle: null, pLocal: {}, cStyle: null, cLocal: {}, inTable: false });
    story.text = story.paragraphs.map(p => p.runs.map(x => x.text).join('')).join('\n').replace(/\u2028/g, '\n');
    return story;
  }

  /* -------------------------------------------------------------- spreads */
  const ITEM_TAGS = new Set(['Group', 'TextFrame', 'Rectangle', 'Oval', 'Polygon', 'GraphicLine']);
  const PLACED_TAGS = ['Image', 'EPS', 'PDF', 'WMF', 'PICT', 'ImportedPage', 'SVG'];

  function readGeometry(el) {
    const props = child(el, 'Properties'); const pg = props && child(props, 'PathGeometry');
    if (!pg) return null;
    const paths = els(pg).filter(e => e.tagName === 'GeometryPathType');
    if (!paths.length) return null;
    const arr = child(paths[0], 'PathPointArray'); if (!arr) return null;
    const num = s => String(s || '').trim().split(/\s+/).map(Number);
    const points = els(arr).filter(e => e.tagName === 'PathPointType').map(p => ({
      a: num(attr(p, 'Anchor')), l: num(attr(p, 'LeftDirection')), r: num(attr(p, 'RightDirection')) }));
    return { points, paths: paths.length, open: attr(paths[0], 'PathOpen') === 'true' };
  }
  function readTextPrefs(el) {
    const tp = child(el, 'TextFramePreference');
    const prefs = { columns: 1, gutter: 12, inset: null, vj: 'TopAlign', autoSize: 'Off', firstBaseline: null };
    if (!tp) return prefs;
    if (attr(tp, 'TextColumnCount')) prefs.columns = Number(attr(tp, 'TextColumnCount')) || 1;
    if (attr(tp, 'TextColumnGutter')) prefs.gutter = Number(attr(tp, 'TextColumnGutter'));
    if (attr(tp, 'VerticalJustification')) prefs.vj = attr(tp, 'VerticalJustification');
    if (attr(tp, 'AutoSizingType')) prefs.autoSize = attr(tp, 'AutoSizingType');
    if (attr(tp, 'FirstBaselineOffset')) prefs.firstBaseline = attr(tp, 'FirstBaselineOffset');
    const props = child(tp, 'Properties'); const ins = props && child(props, 'InsetSpacing');
    if (ins) { const v = els(ins).map(e => Number(e.textContent)); if (v.length === 4 && v.every(Number.isFinite)) prefs.inset = v; }
    return prefs;
  }
  function readPlaced(el) {
    const out = [];
    for (const tag of PLACED_TAGS) for (const g of Array.from(el.getElementsByTagName(tag))) {
      const lk = child(g, 'Link');
      const uri = lk ? (attr(lk, 'LinkResourceURI') || '') : '';
      let file = uri.split('/').pop() || ''; try { file = decodeURIComponent(file); } catch (e) { /* keep raw */ }
      out.push({ kind: tag, format: lk ? String(attr(lk, 'LinkResourceFormat') || '').replace('$ID/', '') : '',
        stored: lk ? attr(lk, 'StoredState') : null, file });
    }
    return out;
  }
  function isAxisAligned(pts) {
    if (pts.length !== 4) return false;
    const e = 1e-6;
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      if (Math.abs(p[0] - q[0]) > e && Math.abs(p[1] - q[1]) > e) return false;
    }
    return true;
  }
  function readItem(el, W, parent, layerMap) {
    const local = parseMatrix(attr(el, 'ItemTransform'));
    const world = mul(W, local);
    const layerId = attr(el, 'ItemLayer') || (parent && parent.layerId) || null;
    const layer = layerId ? layerMap.get(layerId) : null;
    const hidden = attr(el, 'Visible') === 'false' || !!(parent && parent.hidden) || !!(layer && layer.Visible === 'false');
    const item = { id: attr(el, 'Self'), kind: el.tagName, name: attr(el, 'Name'), parentId: parent ? parent.id : null,
      layerId, layerName: layer ? layer.Name : null, hidden, locked: attr(el, 'Locked') === 'true',
      world, matrix: matrixInfo(world), fill: attr(el, 'FillColor'), stroke: attr(el, 'StrokeColor') };
    const geo = el.tagName === 'Group' ? null : readGeometry(el);
    if (geo) {
      const localPts = geo.points.map(p => p.a);
      item.localPoints = localPts;
      item.points = localPts.map(p => applyPt(world, p[0], p[1]));
      item.bbox = bboxOf(item.points);
      item.axisRect = isAxisAligned(localPts) && !geo.points.some(p => p.l.some((v, i) => Math.abs(v - p.a[i]) > 1e-6) || p.r.some((v, i) => Math.abs(v - p.a[i]) > 1e-6));
      item.curved = geo.points.some(p => p.l.some((v, i) => Math.abs(v - p.a[i]) > 1e-6) || p.r.some((v, i) => Math.abs(v - p.a[i]) > 1e-6));
      item.pathCount = geo.paths;
    }
    if (el.tagName === 'TextFrame') {
      item.story = attr(el, 'ParentStory');
      const pv = attr(el, 'PreviousTextFrame'), nx = attr(el, 'NextTextFrame');
      item.prev = pv && pv !== 'n' ? pv : null; item.next = nx && nx !== 'n' ? nx : null;
      item.prefs = readTextPrefs(el);
    } else if (el.tagName !== 'Group') {
      item.placed = readPlaced(el);
      item.textPaths = el.getElementsByTagName('TextPath').length;
    }
    return item;
  }
  function parseSpread(text, layerMap, src, isMaster) {
    const r = parseXml(text);
    const sp = child(r, isMaster ? 'MasterSpread' : 'Spread') || child(r, 'Spread') || child(r, 'MasterSpread');
    const spread = { id: attr(sp, 'Self'), src, master: !!isMaster, name: attr(sp, 'Name'),
      transform: parseMatrix(attr(sp, 'ItemTransform')), pages: [], items: [] };
    for (const pg of els(sp)) {
      if (pg.tagName !== 'Page') continue;
      const b = String(attr(pg, 'GeometricBounds') || '0 0 0 0').trim().split(/\s+/).map(Number);
      const tr = parseMatrix(attr(pg, 'ItemTransform'));
      const corners = [applyPt(tr, b[1], b[0]), applyPt(tr, b[3], b[2])];
      const rect = bboxOf(corners);
      spread.pages.push({ id: attr(pg, 'Self'), name: attr(pg, 'Name'), bounds: b, transform: tr, rect,
        widthPt: rect.w, heightPt: rect.h, widthMm: rect.w * 25.4 / 72, heightMm: rect.h * 25.4 / 72,
        master: attr(pg, 'AppliedMaster') });
    }
    const walkItems = (parentEl, W, parent) => {
      for (const c of els(parentEl)) {
        if (!ITEM_TAGS.has(c.tagName)) continue;
        const item = readItem(c, W, parent, layerMap);
        spread.items.push(item);
        if (c.tagName === 'Group') walkItems(c, item.world, item);
      }
    };
    walkItems(sp, IDENTITY, null);
    // Assign each item to the page holding its centre (else the page it overlaps most).
    for (const it of spread.items) {
      if (!it.bbox) continue;
      const cx = it.bbox.x + it.bbox.w / 2, cy = it.bbox.y + it.bbox.h / 2;
      let pg = spread.pages.find(p => cx >= p.rect.x && cx <= p.rect.x + p.rect.w && cy >= p.rect.y && cy <= p.rect.y + p.rect.h);
      if (!pg) {
        let best = 0;
        for (const p of spread.pages) {
          const ox = Math.min(it.bbox.x + it.bbox.w, p.rect.x + p.rect.w) - Math.max(it.bbox.x, p.rect.x);
          const oy = Math.min(it.bbox.y + it.bbox.h, p.rect.y + p.rect.h) - Math.max(it.bbox.y, p.rect.y);
          if (ox > 0 && oy > 0 && ox * oy > best) { best = ox * oy; pg = p; }
        }
      }
      it.pageId = pg ? pg.id : null;
    }
    return spread;
  }

  /* ----------------------------------------------------------------- load */
  // `text(path)` -> Promise<string> ('' when the entry is missing)
  async function load(text) {
    const dm = await text('designmap.xml');
    if (!dm) throw new Error('designmap.xml is missing');
    const designmap = parseDesignMap(dm);
    const styles = parseStyles(await text('Resources/Styles.xml'));
    const fonts = parseFonts(await text('Resources/Fonts.xml'));
    const layerMap = new Map(designmap.layers.map(l => [l.Self, l]));
    return { text, designmap, styles, fonts, layerMap };
  }

  /* ------------------------------------------------------------ font usage */
  const STATUS_RANK = { NotAvailable: 3, Substituted: 2, Installed: 1 };
  function computeFontUsage(doc, stories) {
    const usage = new Map();
    const totals = { chars: 0, runFontChars: 0, runStyleChars: 0, defaultStyleChars: 0 };
    for (const story of stories) for (const p of story.paragraphs) {
      const ps = resolveStyle(doc.styles.para, p.styleId, 'ParagraphStyle/', NORMAL_PARA);
      for (const run of p.runs) {
        const n = run.text.replace(/[\u2028\n]/g, '').length; if (!n) continue;
        const cs = resolveStyle(doc.styles.char, run.charStyle, 'CharacterStyle/', null);
        const rawFont = run.local.font || cs.font || p.local.font || ps.font || '';
        const fstyle = run.local.fontStyle || cs.fontStyle || p.local.fontStyle || ps.fontStyle || 'Regular';
        const key = cleanFontFamily(rawFont) + '|' + fstyle;
        let u = usage.get(key);
        if (!u) { u = { family: cleanFontFamily(rawFont) || '(unspecified)', style: fstyle, raw: new Set(), chars: 0, viaStyle: 0, viaOverride: 0 }; usage.set(key, u); }
        u.raw.add(rawFont); u.chars += n; totals.chars += n;
        const over = !!run.local.font;
        if (over) { u.viaOverride += n; totals.runFontChars += n; } else u.viaStyle += n;
        if (run.local.fontStyle) totals.runStyleChars += n;
        if (isDefaultParaStyle(p.styleId)) totals.defaultStyleChars += n;
      }
    }
    const list = Array.from(usage.values()).map(u => {
      let status = null;
      for (const f of doc.fonts) {
        if ((u.raw.has(f.family) || cleanFontFamily(f.family) === u.family) && f.style.toLowerCase() === u.style.toLowerCase()) {
          if (!status || (STATUS_RANK[f.status] || 0) > (STATUS_RANK[status] || 0)) status = f.status;
        }
      }
      return { family: u.family, style: u.style, chars: u.chars, viaStyle: u.viaStyle, viaOverride: u.viaOverride, status };
    }).sort((a, b) => b.chars - a.chars);
    return { list, totals };
  }

  /* ------------------------------------------------------------ frame support */
  function classifyFrame(item, story) {
    const reasons = []; let level = 'full';
    const bump = (lvl, why) => { reasons.push(why); if (lvl === 'unsupported') level = 'unsupported'; else if (level !== 'unsupported') level = 'approx'; };
    if (!story) bump('unsupported', 'story not found');
    if (item.next || item.prev) bump('approx', 'threaded text');
    if (item.prefs.columns > 1) bump('approx', 'multiple columns');
    if (!item.axisRect) bump('approx', 'non-rectangular frame');
    if (item.matrix.skewed || item.matrix.scaled || item.matrix.flipped) bump('approx', 'scaled, skewed or mirrored');
    if (item.prefs.vj === 'JustifyAlign') bump('approx', 'vertically justified');
    if (item.prefs.autoSize && item.prefs.autoSize !== 'Off') bump('approx', 'auto-sizing frame');
    if (story) {
      if (story.features.tables) bump('unsupported', 'table in story');
      if (story.features.footnotes) bump('unsupported', 'footnotes in story');
      if (story.features.anchored) bump('unsupported', 'anchored objects in story');
    }
    return { level, reasons };
  }
  const rotationBucket = a => { for (const t of [0, 90, 180, -90, -180]) if (Math.abs(a - t) < 0.5) return t === -180 ? '180' : String(t); return 'other'; };

  /* ------------------------------------------------------------------ scan */
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function scan(doc, opts) {
    opts = opts || {};
    const progress = opts.onProgress || function () {};
    const dm = doc.designmap;
    const warnings = [];
    const warn = (level, code, message, refs) => warnings.push({ level, code, message, refs: refs || [] });
    const total = dm.spreads.length + dm.masterSpreads.length + dm.stories.length;
    let done = 0;

    const spreads = [], pages = [], items = new Map();
    for (const src of dm.spreads) {
      const text = await doc.text(src);
      if (!text) { warn('error', 'missing-spread', 'Spread file listed in designmap.xml is missing: ' + src, [src]); continue; }
      const sp = parseSpread(text, doc.layerMap, src, false);
      sp.index = spreads.length; spreads.push(sp);
      for (const pg of sp.pages) { pg.index = pages.length; pg.spreadIndex = sp.index; pg.frameIds = []; pg.itemIds = []; pages.push(pg); }
      for (const it of sp.items) {
        it.spreadIndex = sp.index; items.set(it.id, it);
        const pg = sp.pages.find(p => p.id === it.pageId);
        it.pageIndex = pg ? pg.index : null;
        if (pg) { pg.itemIds.push(it.id); if (it.kind === 'TextFrame') pg.frameIds.push(it.id); }
      }
      if (++done % 8 === 0) { progress(done / total, 'Reading spreads'); await tick(); }
    }
    const masters = [];
    for (const src of dm.masterSpreads) {
      const text = await doc.text(src); if (!text) continue;
      masters.push(parseSpread(text, doc.layerMap, src, true));
      if (++done % 8 === 0) { progress(done / total, 'Reading master pages'); await tick(); }
    }
    const stories = new Map();
    for (const src of dm.stories) {
      const text = await doc.text(src);
      if (!text) { warn('error', 'missing-story', 'Story file listed in designmap.xml is missing: ' + src, [src]); continue; }
      const s = parseStory(text); s.src = src; stories.set(s.id, s);
      if (++done % 16 === 0) { progress(done / total, 'Reading stories'); await tick(); }
    }
    progress(1, 'Analysing');

    // --- frames, threading, story links
    const textFrames = Array.from(items.values()).filter(i => i.kind === 'TextFrame');
    const masterFrames = masters.flatMap(m => m.items.filter(i => i.kind === 'TextFrame'));
    const referenced = new Set([...textFrames, ...masterFrames].map(f => f.story).filter(Boolean));
    for (const s of stories.values()) for (const a of s.anchoredStories) referenced.add(a);
    const framesByStory = new Map();
    for (const f of textFrames) { if (!framesByStory.has(f.story)) framesByStory.set(f.story, []); framesByStory.get(f.story).push(f); }
    const allFrameIds = new Set([...textFrames, ...masterFrames].map(f => f.id));
    const missingStory = textFrames.filter(f => !stories.has(f.story));
    if (missingStory.length) warn('error', 'frame-without-story', missingStory.length + ' text frame(s) point to a story that is not in the package.', missingStory.slice(0, 20).map(f => f.id));
    const orphans = Array.from(stories.keys()).filter(id => !referenced.has(id));
    if (orphans.length) warn('info', 'orphan-stories', orphans.length + ' stor' + (orphans.length === 1 ? 'y is' : 'ies are') + ' not placed in any text frame.', orphans.slice(0, 20));
    const badThread = textFrames.filter(f => (f.next && !allFrameIds.has(f.next)) || (f.prev && !allFrameIds.has(f.prev)));
    if (badThread.length) warn('warn', 'broken-thread', badThread.length + ' frame(s) link to a threaded frame that was not found.', badThread.slice(0, 20).map(f => f.id));
    const shared = Array.from(framesByStory.entries()).filter(([, fs]) => fs.length > 1 && !fs.every(f => f.next || f.prev));
    if (shared.length) warn('warn', 'story-in-several-frames', shared.length + ' stor' + (shared.length === 1 ? 'y appears' : 'ies appear') + ' in several frames without being threaded.', shared.slice(0, 20).map(([id]) => id));

    // --- per-frame support + aggregate frame stats
    const fstat = { total: textFrames.length, onPages: 0, offPage: 0, hidden: 0, threaded: 0, nonRect: 0, multiColumn: 0, inset: 0, rotated: {},
      verticalJustification: {}, autoSizing: 0, scaledOrSkewed: 0, nestedInGroup: 0, empty: 0 };
    const support = { full: 0, approx: 0, unsupported: 0, skipped: 0, reasons: {} };
    for (const f of textFrames) {
      const story = stories.get(f.story);
      const cls = classifyFrame(f, story);
      f.support = cls.level; f.supportReasons = cls.reasons;
      if (f.parentId) fstat.nestedInGroup++;
      if (f.pageIndex == null) fstat.offPage++; else fstat.onPages++;
      if (f.hidden) fstat.hidden++;
      if (f.next || f.prev) fstat.threaded++;
      if (!f.axisRect) fstat.nonRect++;
      if (f.prefs.columns > 1) fstat.multiColumn++;
      if (f.prefs.inset && f.prefs.inset.some(v => v > 0)) fstat.inset++;
      if (f.prefs.autoSize !== 'Off') fstat.autoSizing++;
      if (f.matrix.skewed || f.matrix.scaled || f.matrix.flipped) fstat.scaledOrSkewed++;
      const rb = rotationBucket(f.matrix.angle); fstat.rotated[rb] = (fstat.rotated[rb] || 0) + 1;
      fstat.verticalJustification[f.prefs.vj] = (fstat.verticalJustification[f.prefs.vj] || 0) + 1;
      if (story && !story.text.trim()) fstat.empty++;
      if (f.hidden || f.pageIndex == null) { support.skipped++; continue; }
      support[cls.level]++;
      for (const r of cls.reasons) support.reasons[r] = (support.reasons[r] || 0) + 1;
    }

    // --- shapes and artwork
    const shapes = Array.from(items.values()).filter(i => i.kind !== 'TextFrame' && i.kind !== 'Group');
    const art = { shapes: shapes.length, placed: 0, byFormat: {}, linked: 0, embedded: 0, textPaths: 0 };
    for (const s of shapes) {
      art.textPaths += s.textPaths || 0;
      for (const p of s.placed || []) {
        art.placed++; const fmt = p.format || p.kind; art.byFormat[fmt] = (art.byFormat[fmt] || 0) + 1;
        if (p.stored === 'Embedded') art.embedded++; else art.linked++;
      }
    }
    if (art.linked) warn('info', 'linked-artwork', art.linked + ' placed image(s) are linked files outside the IDML, so the browser cannot draw them. A companion PDF supplies the artwork.');
    if (art.textPaths) warn('warn', 'text-on-path', art.textPaths + ' text-on-a-path object(s) found; these are not supported yet.');

    // --- stories, fonts, overrides
    const storyList = Array.from(stories.values());
    const sfeat = { total: storyList.length, empty: storyList.filter(s => !s.text.trim()).length, orphan: orphans.length,
      withTables: storyList.filter(s => s.features.tables).length, withFootnotes: storyList.filter(s => s.features.footnotes).length,
      withAnchored: storyList.filter(s => s.features.anchored).length, withSpecialChars: storyList.filter(s => s.features.specials).length,
      withForcedLineBreaks: storyList.filter(s => s.features.lineBreaks).length, paragraphs: storyList.reduce((n, s) => n + s.paragraphs.length, 0) };
    const fontUse = computeFontUsage(doc, storyList);
    if (fontUse.totals.runFontChars) {
      const pct = Math.round(100 * fontUse.totals.runFontChars / Math.max(1, fontUse.totals.chars));
      warn('warn', 'run-level-fonts', fontUse.totals.runFontChars.toLocaleString() + ' of ' + fontUse.totals.chars.toLocaleString() + ' characters (' + pct + '%) set their font directly on the text, not through a paragraph style. Changing paragraph styles will not change these.');
    }
    const missingFonts = fontUse.list.filter(f => f.status === 'NotAvailable' || f.status === 'Substituted');
    if (missingFonts.length) warn('warn', 'fonts-unavailable', missingFonts.length + ' font(s) in use were marked missing or substituted when the IDML was saved: ' + missingFonts.map(f => f.family + ' ' + f.style).join(', ') + '.');

    // --- pages
    const sizeMap = new Map();
    for (const p of pages) { const k = p.widthPt.toFixed(1) + 'x' + p.heightPt.toFixed(1); const e = sizeMap.get(k) || { widthPt: p.widthPt, heightPt: p.heightPt, widthMm: p.widthMm, heightMm: p.heightMm, count: 0 }; e.count++; sizeMap.set(k, e); }
    const perSpread = {}; for (const s of spreads) perSpread[s.pages.length] = (perSpread[s.pages.length] || 0) + 1;
    const layerStats = doc.designmap.layers.map(l => ({ id: l.Self, name: l.Name, visible: l.Visible !== 'false', locked: l.Locked === 'true', printable: l.Printable !== 'false',
      frames: textFrames.filter(f => f.layerId === l.Self).length }));
    if (layerStats.some(l => !l.visible)) warn('info', 'hidden-layers', 'Hidden layers: ' + layerStats.filter(l => !l.visible).map(l => l.name).join(', ') + '. Their items will not be drawn.');

    const report = {
      pages: pages.length, spreads: spreads.length, masterSpreads: masters.length, pagesPerSpread: perSpread,
      pageSizes: Array.from(sizeMap.values()).sort((a, b) => b.count - a.count),
      layers: layerStats, frames: fstat, support, stories: sfeat, art,
      text: Object.assign({ paragraphs: sfeat.paragraphs }, fontUse.totals), fonts: fontUse.list, warnings,
    };
    return { report, pages, spreads, masters, items, stories, framesByStory, textFrames };
  }

  /* ---------------------------------------------------------- PDF cross-check */
  function normWords(s) {
    return String(s || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }
  // pdfTexts: array of page text strings, in document order.
  function compareWithPdf(scanData, pdfTexts) {
    const rows = []; const sum = { checked: 0, ok: 0, overset: 0, differs: 0, mismatch: 0, noPdfPage: 0, noText: 0 };
    for (const pg of scanData.pages) {
      const frames = pg.frameIds.map(id => scanData.items.get(id)).filter(f => f && !f.hidden);
      const row = { pageIndex: pg.index, pageName: pg.name, status: 'ok', frames: [] };
      if (pg.index >= pdfTexts.length) { row.status = 'no-pdf-page'; sum.noPdfPage++; rows.push(row); continue; }
      const pdfWords = normWords(pdfTexts[pg.index]);
      const pool = new Map(); for (const w of pdfWords) pool.set(w, (pool.get(w) || 0) + 1);
      const compact = pdfWords.join('');
      let totalWords = 0, totalMissing = 0;
      for (const f of frames) {
        const story = scanData.stories.get(f.story); if (!story) continue;
        const words = normWords(story.text); if (!words.length) continue;
        const avail = new Map(pool); const ok = [];
        for (const w of words) {
          if ((avail.get(w) || 0) > 0) { avail.set(w, avail.get(w) - 1); ok.push(true); }
          // Tolerate a word the PDF split across lines with a hyphen, but only when the whole word is absent.
          else ok.push(!pool.has(w) && w.length >= 5 && compact.includes(w));
        }
        const missing = []; ok.forEach((v, i) => { if (!v) missing.push(i); });
        totalWords += words.length; totalMissing += missing.length;
        if (!missing.length) continue;
        // Overset text is cut from the END of the story. Allow a little coincidence: a cut-off word can
        // still match an unrelated word elsewhere on the page (e.g. a label that repeats it).
        const tail = words.length - missing[0];
        const coincidental = tail - missing.length;
        // Words with their original case for display (same tokenising, so indexes line up when possible).
        const raw = story.text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const shown = raw.length === words.length ? raw : words;
        row.frames.push({ id: f.id, story: f.story, words: words.length, missing: missing.map(i => shown[i]),
          lastKept: shown.slice(Math.max(0, missing[0] - 4), missing[0]).join(' '),
          trailing: coincidental <= Math.max(1, Math.floor(tail * 0.25)), text: story.text.slice(0, 120) });
      }
      if (!totalWords) { row.status = 'no-text'; sum.noText++; }
      else {
        sum.checked++;
        if (totalWords >= 6 && totalMissing / totalWords > 0.6) { row.status = 'mismatch'; sum.mismatch++; }
        else if (row.frames.some(f => f.trailing)) { row.status = 'overset'; sum.overset++; }
        else if (row.frames.length) { row.status = 'differs'; sum.differs++; }
        else sum.ok++;
      }
      rows.push(row);
    }
    return { rows, summary: sum, pdfPages: pdfTexts.length, idmlPages: scanData.pages.length, pageCountMismatch: pdfTexts.length !== scanData.pages.length };
  }

  PW.idml = { setParser, parseXml, parseDesignMap, parseFonts, parseStyles, parseStory, parseSpread, parseMatrix, mul, applyPt,
    resolveStyle, cleanFontFamily, load, scan, compareWithPdf, normWords, classifyFrame };
  if (typeof module !== 'undefined' && module.exports) module.exports = PW.idml;
})(typeof window !== 'undefined' ? window : globalThis);
