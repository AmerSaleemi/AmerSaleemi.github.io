/* ClearFileCo Card Maker engine. Data-driven: a product spec (cm-<id>.json) lists sizes, designs, form fields and,
   per size and design, the pages with a background image and the editable elements (text, photo) in inches.
   Everything runs in the browser; photos never leave the device. Exports: print-ready PDF (pdf-lib) and images. */
(function () {
  'use strict';
  var FONTS = {PF: 'PlayfairDisplay-Regular', PFi: 'PlayfairDisplay-Italic', GV: 'GreatVibes-Regular', LA: 'Lato-Regular', LAi: 'Lato-Italic'};
  var MET = {PF: [1082, 251, 1000], PFi: [1082, 251, 1000], GV: [851, 401, 1000], LA: [1974, 426, 2000], LAi: [1974, 426, 2000]};
  var PT = 1 / 72;
  var spec = null, verses = [], vmap = {}, S = null, bgCache = {}, $ = function (id) { return document.getElementById(id); };
  var hasLS = (function () { try { var c = document.createElement('canvas').getContext('2d'); return 'letterSpacing' in c; } catch (e) { return false; } })();

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function fontCss(key, px) { return px.toFixed(2) + 'px cm' + key; }
  function spacing(ctx, px) { if (hasLS) ctx.letterSpacing = (px > 0.05 ? px.toFixed(2) : '0') + 'px'; }
  function lm(font, px, ls) { var m = MET[font] || MET.LA, em = (m[0] + m[1]) / m[2], lh = px * em * (ls || 1); return {lh: lh, base: (lh - px * em) / 2 + px * m[0] / m[2]}; }

  // ------------------------------------------------------------------ values
  function design() { for (var i = 0; i < spec.designs.length; i++) if (spec.designs[i].id === S.design) return spec.designs[i]; return spec.designs[0]; }
  function size() { for (var i = 0; i < spec.sizes.length; i++) if (spec.sizes[i].id === S.size) return spec.sizes[i]; return spec.sizes[0]; }
  function pages() { return spec.pages[S.size][S.design]; }
  // user-facing words; a spec can override any of them (spec.ui) for a Spanish or bilingual maker
  var UI = {
    front: 'Front', back: 'Back', outside: 'Outside', inside: 'Inside', add_photo: 'Add a photo', zoom: 'Zoom', more: 'More options',
    opening: 'Opening your photo...', photo_added: 'Photo added. Drag it on the preview to position it.',
    photo_reused: 'Using the photo you added last time. Choose a new file to change it.',
    photo_help: 'Drag the photo on the preview to position it. Your photo stays on your device; nothing is uploaded.',
    photo_bad: 'Sorry, that photo could not be opened here. Please choose a JPG or PNG photo.\n\nIf it is an iPhone photo (HEIC), open this page in Safari, or save the photo as a JPG first.',
    your_own: 'Your own', write_own: 'Write my own words', no_verse: 'No verse', title_opt: 'Title (optional)',
    verse_ph: 'Type the prayer, poem or verse. For a poem, put each line on its own line and leave a blank line between verses.',
    source_opt: 'Source or author (optional)', no_photo: 'No photo added yet. Download without a photo?',
    error: 'Sorry, something went wrong making the file: {m}\nPlease message us on Etsy and we will make it for you.'
  };
  function T(k) { return (spec && spec.ui && spec.ui[k] != null) ? spec.ui[k] : UI[k]; }
  function pron(t) {
    var her = S.values.pronoun !== 'his';
    // also: Arabic suffixes in the transliterated du'a ({hu}, {hi}), Irish 'a {anam}' (her soul = a hanam), pets ({dog})
    var m = her ? {him: 'her', he: 'she', his: 'her', Him: 'Her', He: 'She', His: 'Her', hu: 'ha', hi: 'ha', anam: 'hanam', dog: 'girl'}
                : {him: 'him', he: 'he', his: 'his', Him: 'Him', He: 'He', His: 'His', hu: 'hu', hi: 'hi', anam: 'anam', dog: 'boy'};
    return String(t || '').replace(/\{(him|he|his|Him|He|His|hu|hi|anam|dog)\}/g, function (_, k) { return m[k]; });
  }
  function val(bind) {
    var c = spec.computed && spec.computed[bind];
    if (c) {
      if (c.join) { var parts = c.join.map(function (b) { return (S.values[b] || '').trim(); }).filter(Boolean); return parts.join(c.sep || ' '); }
      if (c.split) {
        var items = (S.values[c.split] || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        var per = Math.ceil(items.length / c.of);
        return items.slice(c.part * per, (c.part + 1) * per).join('\n');
      }
      if (c.template) return c.template.replace(/\{(\w+)\}/g, function (_, k) { return (S.values[k] || '').trim(); }).replace(/\s+([,.])/g, '$1').trim();
    }
    if (bind === 'verse_title') { var v = curVerse(); return v ? pron(v.title) : ''; }
    return pron(S.values[bind] == null ? '' : S.values[bind]);
  }
  function curVerse() {
    if (S.values.verse === '__custom') {
      var lines = (S.values.verse_text || '').split('\n');
      var poem = lines.filter(function (l) { return l.trim(); }).length > 1;
      return {title: S.values.verse_custom_title || '', form: poem ? 'poem' : 'prose', lines: lines, source: S.values.verse_source || ''};
    }
    if (S.values.verse === '__none') return null;
    return vmap[S.values.verse] || null;
  }

  // ------------------------------------------------------------------ text layout
  function wrap(ctx, text, maxW) {
    var out = [];
    String(text).split('\n').forEach(function (hard) {
      var words = hard.split(/ +/), line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (!line || ctx.measureText(t).width <= maxW) line = t; else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }
  function layout(ctx, paras, W, H, ppi, nowrap) {
    var f = 1, best = null;
    for (var it = 0; it < 60; it++) {
      var lines = [], y = 0, maxw = 0;
      for (var i = 0; i < paras.length; i++) {
        var p = paras[i], px = p.size * PT * ppi * f;
        ctx.font = fontCss(p.font, px); spacing(ctx, (p.spc || 0) * PT * ppi * f);
        y += (p.before || 0) * PT * ppi * f;
        var m = lm(p.font, px, p.ls), arr = nowrap ? String(p.text).split('\n') : wrap(ctx, p.text, W);
        for (var j = 0; j < arr.length; j++) {
          var w = ctx.measureText(arr[j]).width; if (w > maxw) maxw = w;
          lines.push({t: arr[j], font: p.font, px: px, color: p.color, align: p.align || 'c', y: y + m.base, w: w, spc: (p.spc || 0) * PT * ppi * f});
          y += m.lh;
        }
        if (i < paras.length - 1) y += (p.after || 0) * PT * ppi * f;
      }
      best = {lines: lines, total: y, f: f};
      if ((y <= H * 1.002 && maxw <= W * 1.002) || f < 0.35) return best;
      f *= 0.96;
    }
    return best;
  }
  function draw(ctx, L, x, y, W, H, anchor) {
    var top = anchor === 'm' ? y + (H - L.total) / 2 : anchor === 'b' ? y + H - L.total : y;
    ctx.textBaseline = 'alphabetic';
    L.lines.forEach(function (ln) {
      ctx.font = fontCss(ln.font, ln.px); spacing(ctx, ln.spc); ctx.fillStyle = ln.color;
      var lx = ln.align === 'c' ? x + (W - ln.w) / 2 : ln.align === 'r' ? x + W - ln.w : x;
      ctx.fillText(ln.t, lx, top + ln.y);
    });
  }
  function style(e, o) { return {font: o.font || e.font, size: o.size || e.size, color: o.color || e.color, ls: o.ls || e.ls || 1, align: o.align || e.align, spc: o.spc != null ? o.spc : e.spc, before: o.before || 0, after: o.after || 0}; }
  function parasFor(e) {
    if (e.t === 'verse') {
      var v = curVerse(); if (!v) return [];
      var out = [], lines = v.lines.map(pron);
      if (v.form === 'poem') {
        lines.forEach(function (ln, i) {
          if (!ln.trim()) { if (out.length) out[out.length - 1].after = e.poem.stanza; return; }
          var p = style(e, e.poem); p.text = ln; p.after = 0; out.push(p);
        });
      } else {
        lines.filter(function (l) { return l.trim(); }).forEach(function (ln) { var p = style(e, e.prose); p.text = ln; out.push(p); });
      }
      if (v.source && e.source) { var s = style(e, e.source); s.text = pron(v.source); if (out.length) out[out.length - 1].after = 0; out.push(s); }
      return out;
    }
    if (e.t === 'multi') {
      return e.paras.map(function (p) { var q = style(e, p); q.text = p.bind ? val(p.bind) : (p.text || ''); return q; }).filter(function (p) { return p.text; });
    }
    if (e.t === 'story') {
      var t = val(e.bind); if (!t.trim()) return [];
      return t.split(/\n\s*\n/).map(function (para) { var q = style(e, {after: e.after}); q.text = para.replace(/\n/g, ' ').trim(); return q; }).filter(function (p) { return p.text; });
    }
    var txt = e.bind ? val(e.bind) : (e.text || '');
    if (e.upper) txt = txt.toUpperCase();
    if (!String(txt).trim()) return [];
    var p = style(e, {}); p.text = txt; return [p];
  }
  function hidden(e) {
    if (!e.hideIfEmpty) return false;
    return e.hideIfEmpty.every(function (b) { return !String(val(b)).trim(); });
  }
  function drawRows(ctx, e, ppi) {
    var rows = val(e.bind).split('\n').map(function (r) { return r.trim(); }).filter(Boolean).map(function (r) {
      var i = r.indexOf('|'); return i < 0 ? [r, ''] : [r.slice(0, i).trim(), r.slice(i + 1).trim()];
    });
    if (!rows.length) return;
    var X = e.x * ppi, Y = e.y * ppi, W = e.w * ppi, H = e.h * ppi, f = 1, gap = 0.12 * ppi;
    for (var it = 0; it < 50; it++) {
      var lpx = e.left.size * PT * ppi * f, rpx = e.right.size * PT * ppi * f, m = lm(e.left.font, lpx, e.ls || 1.2);
      var rowH = m.lh + (e.after || 0) * PT * ppi * f, total = rows.length * rowH - (e.after || 0) * PT * ppi * f, ok = total <= H;
      ctx.font = fontCss(e.left.font, lpx); var lw = rows.map(function (r) { return ctx.measureText(r[0]).width; });
      ctx.font = fontCss(e.right.font, rpx); var rw = rows.map(function (r) { return ctx.measureText(r[1]).width; });
      for (var k = 0; k < rows.length; k++) if (lw[k] + rw[k] + (rw[k] ? gap : 0) > W) ok = false;
      if (ok || f < 0.4) {
        var top = Y + Math.max(0, (H - total) / 2) * (e.anchor === 'm' ? 1 : 0);
        rows.forEach(function (r, k) {
          var by = top + k * rowH + m.base;
          ctx.font = fontCss(e.left.font, lpx); ctx.fillStyle = e.left.color; ctx.fillText(r[0], X, by);
          if (r[1]) { ctx.font = fontCss(e.right.font, rpx); ctx.fillStyle = e.right.color; ctx.fillText(r[1], X + W - rw[k], by); }
        });
        return;
      }
      f *= 0.96;
    }
  }

  // ------------------------------------------------------------------ photos
  var phImg = null;
  function drawPhoto(ctx, e, ppi, preview) {
    var x = e.x * ppi, y = e.y * ppi, w = e.w * ppi, h = e.h * ppi, ph = S.photos[e.bind], round = e.shape === 'circle';
    var outline = function () { ctx.beginPath(); if (round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h); };
    ctx.save(); outline(); ctx.clip();
    if (ph && ph.img) {
      var iw = ph.img.naturalWidth || ph.img.width, ih = ph.img.naturalHeight || ph.img.height;
      var s = Math.max(w / iw, h / ih) * ph.zoom, dw = iw * s, dh = ih * s;
      var mx = (dw - w) / 2 / w, my = (dh - h) / 2 / h;
      ph.ox = Math.max(-mx, Math.min(mx, ph.ox)); ph.oy = Math.max(-my, Math.min(my, ph.oy));
      ctx.drawImage(ph.img, x + (w - dw) / 2 + ph.ox * w, y + (h - dh) / 2 + ph.oy * h, dw, dh);
    } else if (S.placeholder) {
      var pi = S.placeholder, ps = Math.max(w / pi.width, h / pi.height);
      ctx.drawImage(pi, x + (w - pi.width * ps) / 2, y + (h - pi.height * ps) / 2, pi.width * ps, pi.height * ps);
      if (preview) { ctx.fillStyle = '#6b6357'; ctx.font = fontCss('LA', Math.max(9, w * 0.075)); var t0 = T('add_photo'), tw0 = ctx.measureText(t0).width; ctx.fillText(t0, x + (w - tw0) / 2, y + h * (round ? 0.84 : 0.93)); }
    } else {
      var d = design();
      ctx.fillStyle = d.bg || '#f4f1ea'; ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.22; ctx.fillStyle = d.accent || '#999';
      ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.40, w * 0.18, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.92, w * 0.36, h * 0.30, 0, Math.PI, 0); ctx.fill();
      ctx.globalAlpha = 1;
      if (preview) { ctx.fillStyle = d.ink || '#333'; ctx.font = fontCss('LA', Math.max(9, w * 0.075)); var t = T('add_photo'), tw = ctx.measureText(t).width; ctx.fillText(t, x + (w - tw) / 2, y + h * 0.66); }
    }
    ctx.restore();
    if (e.border && e.bw) { ctx.strokeStyle = e.border; ctx.lineWidth = e.bw * PT * ppi; outline(); ctx.stroke(); }
  }

  // ------------------------------------------------------------------ pages
  function bg(name) {
    if (bgCache[name]) return bgCache[name];
    bgCache[name] = new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = name; });
    return bgCache[name];
  }
  function stackShifts(page) {
    var st = page.stack, out = {hide: {}, dy: {}};
    if (!st) return out;
    var removed = 0;
    st.groups.forEach(function (g) {
      var empty = g.content.every(function (b) { return !String(val(b)).trim(); });
      if (empty) { out.hide[g.id] = true; removed += g.y1 - g.y0; } else out.dy[g.id] = -removed;
    });
    if (st.center) Object.keys(out.dy).forEach(function (k) { out.dy[k] += removed / 2; });
    return out;
  }
  async function drawPage(ctx, page, ppi, preview) {
    var im = await bg(page.bg), sh = stackShifts(page);
    ctx.drawImage(im, 0, 0, page.w * ppi, page.h * ppi);
    page.els.forEach(function (e0) {
      var e = e0;
      if (e0.group) { if (sh.hide[e0.group]) return; if (sh.dy[e0.group]) e = Object.assign({}, e0, {y: e0.y + sh.dy[e0.group]}); }
      if (hidden(e)) return;
      if (e.t === 'photo') return drawPhoto(ctx, e, ppi, preview);
      if (e.t === 'rows') return drawRows(ctx, e, ppi);
      var paras = parasFor(e); if (!paras.length) return;
      var W = e.w * ppi, H = e.h * ppi, one = lm(paras[0].font, paras[0].size * PT * ppi, paras[0].ls);
      var nowrap = e.t === 'text' && !e.wrap && H < one.lh * 1.7;
      draw(ctx, layout(ctx, paras, W, H, ppi, nowrap), e.x * ppi, e.y * ppi, W, H, e.anchor);
    });
  }
  async function pageCanvas(page, dpi) {
    var c = document.createElement('canvas'); c.width = Math.round(page.w * dpi); c.height = Math.round(page.h * dpi);
    var ctx = c.getContext('2d'); await drawPage(ctx, page, dpi, false); return c;
  }

  // ------------------------------------------------------------------ preview
  var pending = false, curSide = 0;
  function refresh() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; renderPreview(); }); }
  var viewW = 0, viewH = 0;
  async function renderPreview() {
    var ps = pages(), wrapEl = $('cm-preview'), tabs = $('cm-sides');
    if (curSide >= ps.length) curSide = 0;
    tabs.innerHTML = '';
    if (ps.length > 1) ps.forEach(function (p, i) {
      tabs.appendChild(el('button', {type: 'button', class: 'cm-tab' + (i === curSide ? ' on' : ''), text: p.label || (UI[p.side] ? T(p.side) : p.side.charAt(0).toUpperCase() + p.side.slice(1)), onclick: function () { curSide = i; refresh(); }}));
    });
    var page = ps[curSide], cv = $('cm-canvas'), maxW = wrapEl.clientWidth || 360, vh = viewH || window.innerHeight,
      maxH = window.innerWidth < 900 ? Math.max(300, vh * 0.5) : Math.max(320, vh * 0.62);
    var cssPpi = Math.min(maxW / page.w, maxH / page.h), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.style.width = (page.w * cssPpi) + 'px'; cv.style.height = (page.h * cssPpi) + 'px';
    cv.width = Math.round(page.w * cssPpi * dpr); cv.height = Math.round(page.h * cssPpi * dpr);
    S.view = {page: page, ppi: cssPpi};
    await drawPage(cv.getContext('2d'), page, cssPpi * dpr, true);
  }
  function photoHit(px, py) {
    if (!S.view) return null;
    var ppi = S.view.ppi, hit = null;
    S.view.page.els.forEach(function (e) { if (e.t === 'photo' && px >= e.x * ppi && px <= (e.x + e.w) * ppi && py >= e.y * ppi && py <= (e.y + e.h) * ppi) hit = e; });
    return hit;
  }
  function bindDrag(cv) {
    var drag = null;
    cv.addEventListener('pointerdown', function (ev) {
      var r = cv.getBoundingClientRect(), e = photoHit(ev.clientX - r.left, ev.clientY - r.top);
      if (!e || !S.photos[e.bind] || !S.photos[e.bind].img) return;
      drag = {e: e, x: ev.clientX, y: ev.clientY, ox: S.photos[e.bind].ox, oy: S.photos[e.bind].oy};
      cv.setPointerCapture(ev.pointerId); ev.preventDefault();
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var ph = S.photos[drag.e.bind], ppi = S.view.ppi;
      ph.ox = drag.ox + (ev.clientX - drag.x) / (drag.e.w * ppi); ph.oy = drag.oy + (ev.clientY - drag.y) / (drag.e.h * ppi); refresh();
    });
    ['pointerup', 'pointercancel'].forEach(function (t) { cv.addEventListener(t, function () { if (drag) save(); drag = null; }); });
  }

  // ------------------------------------------------------------------ form
  function setVal(id, v) { S.values[id] = v; save(); if (id === 'pronoun') syncInputs(); refresh(); }
  function save() {
    try {
      var pos = {}; Object.keys(S.photos).forEach(function (k) { var p = S.photos[k]; pos[k] = {zoom: p.zoom, ox: p.ox, oy: p.oy}; });
      var o = {size: S.size, design: S.design, values: S.values, touched: S.touched, photoPos: pos};
      localStorage.setItem('cm-' + spec.id, JSON.stringify(o));
    } catch (e) {}
  }
  function savePos() { save(); }

  // photos are kept in this browser only (IndexedDB), so a buyer who comes back to fix a typo keeps the photo and its position
  var MAXPX = 4096;
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var rq = indexedDB.open('clearfileco-cm', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('photos'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      } catch (e) { rej(e); }
    });
  }
  function idbPut(key, blob) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(blob, key);
        tx.oncomplete = function () { db.close(); res(); }; tx.onerror = tx.onabort = function () { db.close(); res(); };
      });
    }).catch(function () {});
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('photos', 'readonly'), rq = tx.objectStore('photos').get(key);
        rq.onsuccess = function () { db.close(); res(rq.result || null); }; rq.onerror = function () { db.close(); res(null); };
      });
    }).catch(function () { return null; });
  }
  function loadPhoto(fid, blob, pos) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var w = im.naturalWidth, h = im.naturalHeight, src = im;
        if (!w || !h) { rej(new Error('empty image')); return; }
        var s = Math.min(1, MAXPX / Math.max(w, h));
        if (s < 1) { src = document.createElement('canvas'); src.width = Math.round(w * s); src.height = Math.round(h * s); src.getContext('2d').drawImage(im, 0, 0, src.width, src.height); }
        var p = pos || {};
        S.photos[fid] = {img: src, zoom: p.zoom || 1, ox: p.ox || 0, oy: p.oy || 0};
        var ui = S.photoUI[fid]; if (ui) { ui.zoom.disabled = false; ui.zoom.value = String(S.photos[fid].zoom); }
        savePos(); refresh(); res();
      };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('could not open image')); };
      im.src = url;
    });
  }
  function shown(id) { var v = S.values[id] == null ? '' : String(S.values[id]); return S.touched[id] ? v : pron(v); }
  function syncInputs() {
    spec.fields.forEach(function (f) {
      if (!f.id || S.touched[f.id] || (f.type !== 'text' && f.type !== 'textarea')) return;
      var inp = document.querySelector('[data-f="' + f.id + '"] input[type=text], [data-f="' + f.id + '"] textarea');
      if (inp) inp.value = shown(f.id);
    });
    // verse names in the list follow the pronoun too ("Remember Him / Her in Your Du'a")
    var vs = document.getElementById('cm-verse');
    if (vs) [].forEach.call(vs.querySelectorAll('option'), function (o) { var v = vmap[o.value]; if (v) o.textContent = pron(v.title); });
  }
  function applySizeDefaults(sz) {
    var df = (sz && sz.defaults) || {};
    Object.keys(df).forEach(function (k) { if (!S.touched[k]) S.values[k] = df[k]; });
    syncInputs();
  }
  function applyDesignDefaults(d) {
    var df = d.defaults || {};
    Object.keys(df).forEach(function (k) { if (!S.touched[k]) S.values[k] = df[k]; });
    syncInputs();
  }
  function usedBinds() {
    var u = {pronoun: 1, design: 1, size: 1};
    function add(b) {
      if (!b || u[b]) return; u[b] = 1;
      var c = spec.computed && spec.computed[b];
      if (c) { (c.join || []).forEach(add); if (c.split) add(c.split); if (c.template) c.template.replace(/\{(\w+)\}/g, function (_, k) { add(k); }); }
    }
    pages().forEach(function (pg) { pg.els.forEach(function (e) {
      add(e.bind); (e.paras || []).forEach(function (p) { add(p.bind); }); (e.hideIfEmpty || []).forEach(add);
      if (e.t === 'verse') { add('verse'); add('verse_text'); add('verse_custom_title'); add('verse_source'); }
    }); });
    return u;
  }
  function applyVisibility() {
    var u = usedBinds(), boxes = document.querySelectorAll('#cm-form [data-f]');
    [].forEach.call(boxes, function (b) { b.style.display = u[b.getAttribute('data-f')] ? '' : 'none'; });
    [].forEach.call(document.querySelectorAll('#cm-form .cm-sec'), function (h) {
      var n = h.nextElementSibling, any = false;
      while (n && !n.classList.contains('cm-sec')) { if (n.getAttribute('data-f') && n.style.display !== 'none') any = true; if (n.tagName === 'DETAILS') any = true; n = n.nextElementSibling; }
      h.style.display = any ? '' : 'none';
    });
  }
  function field(f) {
    var lab = el('label', {class: 'cm-label', text: f.label});
    var help = f.help ? el('div', {class: 'cm-help', text: f.help}) : null;
    var box = el('div', {class: 'cm-field' + (f.more ? ' cm-more' : ''), 'data-f': f.id});
    if (f.type === 'design') {
      var row = el('div', {class: 'cm-swatches'});
      spec.designs.forEach(function (d) {
        var b = el('button', {type: 'button', class: 'cm-sw' + (d.id === S.design ? ' on' : ''), title: d.name, onclick: function () {
          S.design = d.id;
          if (!S.touched.kicker && d.kicker) { S.values.kicker = d.kicker; var k = document.querySelector('[data-f="kicker"] input'); if (k) k.value = d.kicker; }
          if (!S.touched.verse && d.verse && vmap[d.verse]) { S.values.verse = d.verse; var vs = $('cm-verse'); if (vs) vs.value = d.verse; }
          applyDesignDefaults(d);
          [].forEach.call(row.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); save(); refresh();
        }}, [el('span', {class: 'cm-dot', style: 'background:' + d.bg + ';border-color:' + d.accent}), el('span', {text: d.name})]);
        row.appendChild(b);
      });
      box.appendChild(lab); box.appendChild(row); return box;
    }
    if (f.type === 'size') {
      var sel = el('select', {onchange: function () { S.size = this.value; applySizeDefaults(size()); save(); buildExports(); applyVisibility(); refresh(); }});
      spec.sizes.forEach(function (s) { var o = el('option', {value: s.id, text: s.label}); if (s.id === S.size) o.selected = true; sel.appendChild(o); });
      box.appendChild(lab); box.appendChild(sel); if (help) box.appendChild(help); return box;
    }
    if (f.type === 'photo') {
      var inp = el('input', {type: 'file', accept: 'image/*', class: 'cm-file'});
      var zoom = el('input', {type: 'range', min: '1', max: '3', step: '0.01', value: '1', class: 'cm-zoom', disabled: 'disabled'});
      var stat = el('div', {class: 'cm-photostat'});
      S.photoUI[f.id] = {zoom: zoom, stat: stat, input: inp};
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0]; if (!file) return;
        stat.textContent = T('opening');
        loadPhoto(f.id, file, null).then(function () {
          stat.textContent = T('photo_added');
          idbPut(spec.id + ':' + f.id, file);
        }, function () {
          inp.value = '';
          stat.textContent = '';
          alert(T('photo_bad'));
        });
      });
      zoom.addEventListener('input', function () { var p = S.photos[f.id]; if (p) { p.zoom = parseFloat(zoom.value); savePos(); refresh(); } });
      box.appendChild(lab); box.appendChild(inp); box.appendChild(stat);
      box.appendChild(el('div', {class: 'cm-zoomrow'}, [el('span', {text: T('zoom')}), zoom]));
      box.appendChild(el('div', {class: 'cm-help', text: f.help || T('photo_help')}));
      return box;
    }
    if (f.type === 'choice') {
      var sel2 = el('select', {onchange: function () { setVal(f.id, this.value); }});
      f.options.forEach(function (o) { var op = el('option', {value: o[0], text: o[1]}); if (S.values[f.id] === o[0]) op.selected = true; sel2.appendChild(op); });
      box.appendChild(lab); box.appendChild(sel2); if (help) box.appendChild(help); return box;
    }
    if (f.type === 'verse') {
      var vs = el('select', {id: 'cm-verse', onchange: function () { S.touched.verse = true; setVal('verse', this.value); custom.style.display = this.value === '__custom' ? '' : 'none'; }});
      var groups = {};
      verses.forEach(function (v) { if (f.groups && f.groups.indexOf(v.group) < 0 && v.group !== 'Classic') return; (groups[v.group] = groups[v.group] || []).push(v); });
      Object.keys(groups).forEach(function (g) {
        var og = el('optgroup', {label: g});
        groups[g].forEach(function (v) { var o = el('option', {value: v.id, text: pron(v.title)}); if (v.id === S.values.verse) o.selected = true; og.appendChild(o); });
        vs.appendChild(og);
      });
      var oc = el('optgroup', {label: T('your_own')});
      oc.appendChild(el('option', {value: '__custom', text: T('write_own')}));
      if (f.allowNone) oc.appendChild(el('option', {value: '__none', text: T('no_verse')}));
      vs.appendChild(oc); vs.value = S.values.verse;
      var custom = el('div', {class: 'cm-custom', style: S.values.verse === '__custom' ? '' : 'display:none'}, [
        el('input', {type: 'text', placeholder: T('title_opt'), value: S.values.verse_custom_title || '', oninput: function () { setVal('verse_custom_title', this.value); }}),
        el('textarea', {rows: '6', placeholder: T('verse_ph'), oninput: function () { setVal('verse_text', this.value); }}, []),
        el('input', {type: 'text', placeholder: T('source_opt'), value: S.values.verse_source || '', oninput: function () { setVal('verse_source', this.value); }})
      ]);
      custom.children[1].value = S.values.verse_text || '';
      box.appendChild(lab); box.appendChild(vs); box.appendChild(custom); if (help) box.appendChild(help); return box;
    }
    var input = f.type === 'textarea' ? el('textarea', {rows: String(f.rows || 4), placeholder: f.placeholder || ''}) : el('input', {type: 'text', placeholder: f.placeholder || ''});
    input.value = shown(f.id);
    input.addEventListener('input', function () { S.touched[f.id] = true; setVal(f.id, input.value); });
    box.appendChild(lab); box.appendChild(input); if (help) box.appendChild(help); return box;
  }
  function buildForm() {
    var form = $('cm-form'), more = null;
    form.innerHTML = '';
    spec.fields.forEach(function (f) {
      if (f.section) { form.appendChild(el('h3', {class: 'cm-sec', text: f.section})); return; }
      if (f.more && !more) {
        more = el('details', {class: 'cm-moreblock'}, [el('summary', {text: spec.moreLabel || T('more')})]);
        form.appendChild(more);
      }
      (f.more ? more : form).appendChild(field(f));
    });
  }

  // ------------------------------------------------------------------ export
  function jpegBytes(c, q) { return new Promise(function (res) { c.toBlob(function (b) { b.arrayBuffer().then(res); }, 'image/jpeg', q || 0.93); }); }
  function pngBlob(c) { return new Promise(function (res) { c.toBlob(res, 'image/png'); }); }
  function download(blob, name) {
    var a = el('a', {href: URL.createObjectURL(blob), download: name}); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function slug() { return (val(spec.fileNameFrom || 'name') || spec.id).replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || spec.id; }
  async function doExport(x) {
    var sz = size(), ps = pages(), dpi = x.dpi || sz.dpi || 300;
    var noPhoto = spec.fields.some(function (f) { return f.type === 'photo' && !f.optional && !(S.photos[f.id] && S.photos[f.id].img); });
    if (noPhoto && !confirm(T('no_photo'))) return;
    var btn = $('cm-busy'); btn.style.display = '';
    var cs = [], extra = [];
    try {
      for (var i = 0; i < ps.length; i++) cs.push(await pageCanvas(ps[i], dpi));
      if (x.kind === 'png' || x.kind === 'jpg') {
        for (var j = 0; j < cs.length; j++) {
          var c = cs[j];
          if (x.px) { var t = document.createElement('canvas'); t.width = x.px[0]; t.height = x.px[1]; t.getContext('2d').drawImage(c, 0, 0, x.px[0], x.px[1]); c = t; extra.push(t); }
          var blob = x.kind === 'png' ? await pngBlob(c) : new Blob([await jpegBytes(c, 0.95)], {type: 'image/jpeg'});
          download(blob, slug() + '_' + spec.id + (ps.length > 1 ? '_' + ps[j].side : '') + '.' + x.kind);
          await new Promise(function (r) { setTimeout(r, 600); });
        }
        return;
      }
      var doc = await PDFLib.PDFDocument.create();
      doc.setTitle((val('name') || spec.product) + ' - ' + spec.product); doc.setCreator('ClearFileCo Card Maker');
      var imgs = []; for (var k = 0; k < cs.length; k++) imgs.push(await doc.embedJpg(await jpegBytes(cs[k], 0.94)));
      var cw = sz.w * 72, ch = sz.h * 72;
      if (x.kind === 'sheet' && !sz.sheet) x = {id: x.id, kind: 'single'};
      if (x.kind === 'single') {
        imgs.forEach(function (im) { var pg = doc.addPage([cw, ch]); pg.drawImage(im, {x: 0, y: 0, width: cw, height: ch}); });
      } else if (x.kind === 'fit') {
        var land = sz.w > sz.h, PW = land ? 792 : 612, PH = land ? 612 : 792, s = Math.min((PW - 36) / cw, (PH - 36) / ch, 1);
        imgs.forEach(function (im) { var pg = doc.addPage([PW, PH]); pg.drawImage(im, {x: (PW - cw * s) / 2, y: (PH - ch * s) / 2, width: cw * s, height: ch * s}); });
      } else {
        var sh = sz.sheet, land2 = sh.paper === 'letter-l', W = land2 ? 792 : 612, H = land2 ? 612 : 792;
        var gx = (W - sh.cols * cw) / 2, gy = (H - sh.rows * ch) / 2, grey = PDFLib.rgb(0.55, 0.55, 0.55), L = 14, G = 5;
        imgs.forEach(function (im, side) {
          var pg = doc.addPage([W, H]);
          for (var r = 0; r < sh.rows; r++) for (var c2 = 0; c2 < sh.cols; c2++) {
            var col = side % 2 === 1 ? sh.cols - 1 - c2 : c2;
            pg.drawImage(im, {x: gx + col * cw, y: gy + r * ch, width: cw, height: ch});
          }
          for (var cx = 0; cx <= sh.cols; cx++) { var X = gx + cx * cw;
            pg.drawLine({start: {x: X, y: gy - G}, end: {x: X, y: gy - G - L}, thickness: 0.5, color: grey});
            pg.drawLine({start: {x: X, y: gy + sh.rows * ch + G}, end: {x: X, y: gy + sh.rows * ch + G + L}, thickness: 0.5, color: grey}); }
          for (var ry = 0; ry <= sh.rows; ry++) { var Y = gy + ry * ch;
            pg.drawLine({start: {x: gx - G, y: Y}, end: {x: gx - G - L, y: Y}, thickness: 0.5, color: grey});
            pg.drawLine({start: {x: gx + sh.cols * cw + G, y: Y}, end: {x: gx + sh.cols * cw + G + L, y: Y}, thickness: 0.5, color: grey}); }
        });
      }
      var bytes = await doc.save();
      download(new Blob([bytes], {type: 'application/pdf'}), slug() + '_' + spec.id + '_' + x.id + '.pdf');
    } catch (err) {
      alert(T('error').replace('{m}', err.message));
    } finally {
      btn.style.display = 'none';
      // free the big canvases now (phones, especially iPhones, cap total canvas memory)
      cs.concat(extra).forEach(function (c) { c.width = 0; c.height = 0; });
    }
  }
  function buildExports() {
    var box = $('cm-exports'); box.innerHTML = '';
    var sz = size();
    (sz.exports || spec.exports).forEach(function (x) {
      box.appendChild(el('button', {type: 'button', class: 'cm-dl' + (x.primary ? ' primary' : ''), onclick: function () { doExport(x); }}, [
        el('b', {text: x.label}), x.note ? el('span', {text: x.note}) : null]));
    });
  }

  // ------------------------------------------------------------------ start
  async function start(opts) {
    var base = opts.base || '';
    var r = await fetch(base + opts.spec); spec = await r.json();
    if (opts.verses) { var rv = await fetch(base + opts.verses); verses = await rv.json(); verses.forEach(function (v) { vmap[v.id] = v; }); }
    S = {size: spec.sizes[0].id, design: spec.designs[0].id, values: {}, photos: {}, photoUI: {}, touched: {}};
    spec.fields.forEach(function (f) { if (f.id && f.default != null) S.values[f.id] = f.default; });
    S.values.kicker = S.values.kicker || spec.designs[0].kicker;
    if (spec.fields.some(function (f) { return f.type === 'verse'; })) S.values.verse = S.values.verse || spec.designs[0].verse;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('cm-' + spec.id) || 'null'); if (saved && saved.values) { S.values = Object.assign(S.values, saved.values); if (spec.pages[saved.size]) S.size = saved.size; if (saved.design && spec.pages[S.size][saved.design]) S.design = saved.design; S.touched = saved.touched || {kicker: true, verse: true}; } } catch (e) {}
    var d0 = design(); Object.keys(d0.defaults || {}).forEach(function (k) { if (!S.touched[k] && S.values[k] == null) S.values[k] = d0.defaults[k]; });
    var s0 = size(); Object.keys(s0.defaults || {}).forEach(function (k) { if (!S.touched[k]) S.values[k] = s0.defaults[k]; });
    var fl = Object.keys(FONTS).map(function (k) { var f = new FontFace('cm' + k, 'url(' + base + 'cm-font-' + FONTS[k] + '.woff2)'); return f.load().then(function (ff) { document.fonts.add(ff); }); });
    await Promise.all(fl);
    await new Promise(function (res) { var pi = new Image(); pi.onload = function () { S.placeholder = pi; res(); }; pi.onerror = function () { res(); }; pi.src = base + 'cm-photo-placeholder.jpg'; });
    buildForm(); buildExports(); bindDrag($('cm-canvas'));
    applyVisibility();
    spec.fields.forEach(function (f) {
      if (f.type !== 'photo') return;
      idbGet(spec.id + ':' + f.id).then(function (blob) {
        if (!blob || S.photos[f.id]) return;
        return loadPhoto(f.id, blob, ((saved && saved.photoPos) || {})[f.id]).then(function () {
          var ui = S.photoUI[f.id]; if (ui) ui.stat.textContent = T('photo_reused');
        });
      }).catch(function () {});
    });
    // only re-size the preview when the width changes (rotation, desktop resize); phone toolbars and keyboards change
    // the height constantly and would make the page jump
    viewW = window.innerWidth; viewH = window.innerHeight;
    window.addEventListener('resize', function () { if (window.innerWidth !== viewW) { viewW = window.innerWidth; viewH = window.innerHeight; refresh(); } });
    $('cm-loading').style.display = 'none';
    await renderPreview();
    window.CM._ready = true;
  }
  window.CM = {start: start, _state: function () { return S; }, _export: function (id) { var x = (size().exports || spec.exports).filter(function (e) { return e.id === id; })[0]; return doExport(x); }, _ready: false};
})();
