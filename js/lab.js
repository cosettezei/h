/* 物件實驗頁 — 筆刷製作 / 編輯工具 */
(function () {
  const TB = window.TB;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const STORE = 'tactile-lab-v1';
  const PAPERS = ['#f7f5f0', '#e5e2da', '#bdbcb7', '#aeb6c8', '#16161a', '#2a2a2a', '#9a3f1f', '#df5f17', '#3c2224', '#a9bce6', '#ffacc8', '#24201a'];
  const COLORS = ['#ebe7df', '#bdbdbd', '#6a6a68', '#2f3036', '#d5d9df', '#e9bd5e', '#8fb6ec', '#3c5ae0', '#a99be0', '#3e6a2b', '#6d7f43', '#e76b13', '#ff2a12', '#e46a8c', '#8b4a2b', '#f2dcc8'];

  let revCounter = 1;
  const nextRev = () => ++revCounter;

  /* ---------------- 狀態 ---------------- */
  const st = {
    w: 1400, h: 900, bg: '#e5e2da', transparent: false, image: null, imageOpacity: 1,
    light: { az: 225, el: 42 },
    layers: [], active: null, brush: 'ceramic', tool: 'draw', alt: false, mx: false, my: false,
    er: 24, es: 1, smooth: 0.35, texts: [], selText: -1, textUnder: false
  };
  const rasters = new Map(); // layer.id -> {raster, rev}
  let renderer, imgEl = null;

  /* ---------------- 工具 ---------------- */
  const toast = (msg) => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 1800);
  };
  const activeLayer = () => st.layers.find((l) => l.id === st.active) || null;
  const brushOf = (L) => TB.BRUSHES[L ? L.brush : st.brush];

  function ensureRaster(L) {
    let e = rasters.get(L.id);
    if (!e || e.raster.w !== st.w || e.raster.h !== st.h) {
      if (e) renderer.release(e.raster);
      e = { raster: new TB.Raster(st.w, st.h), rev: -1 };
      rasters.set(L.id, e);
    }
    if (e.rev !== L.rev) { TB.rasterLayer(L, e.raster); e.rev = L.rev; }
    return e.raster;
  }

  /* ---------------- 算繪 ---------------- */
  let rafPending = false, drawingLayer = null;
  function requestRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderNow(); });
  }
  function renderNow() {
    const items = [];
    for (const L of st.layers) {
      if (!L.visible) continue;
      items.push({ raster: ensureRaster(L), shade: L.params, live: L === drawingLayer && L.brush === 'stipple' });
    }
    renderer.render(items, st.light);
  }
  let rerasterT = null;
  function scheduleReraster() {
    clearTimeout(rerasterT);
    rerasterT = setTimeout(requestRender, 90);
  }

  /* ---------------- 歷史 ---------------- */
  const hist = [], redoStack = [];
  const snap = () => ({
    layers: st.layers.map((l) => Object.assign({}, l, { params: Object.assign({}, l.params), ops: l.ops.slice() })),
    active: st.active,
    texts: JSON.parse(JSON.stringify(st.texts))
  });
  function pushHistory() {
    hist.push(snap());
    if (hist.length > 80) hist.shift();
    redoStack.length = 0;
    updateUndo();
  }
  function restore(s) {
    st.layers = s.layers; st.active = s.active; st.texts = s.texts;
    for (const id of Array.from(rasters.keys())) if (!st.layers.find((l) => l.id === id)) { renderer.release(rasters.get(id).raster); rasters.delete(id); }
    const L = activeLayer(); if (L) st.brush = L.brush;
    refreshAll();
  }
  function undo() { if (!hist.length) return; redoStack.push(snap()); restore(hist.pop()); updateUndo(); }
  function redo() { if (!redoStack.length) return; hist.push(snap()); restore(redoStack.pop()); updateUndo(); }
  function updateUndo() { $('#undoBtn').disabled = !hist.length; $('#redoBtn').disabled = !redoStack.length; }

  /* ---------------- 儲存 ---------------- */
  const serial = (withImage) => ({
    v: 1, w: st.w, h: st.h, bg: st.bg, transparent: st.transparent, light: st.light, smooth: st.smooth,
    image: withImage ? st.image : null, imageOpacity: st.imageOpacity,
    layers: st.layers.map((l) => ({ id: l.id, name: l.name, brush: l.brush, params: l.params, ops: l.ops, visible: l.visible })),
    active: st.active, brush: st.brush, texts: st.texts, textUnder: st.textUnder
  });
  let saveT = null;
  function autosave() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(serial(true))); }
      catch (e) { try { localStorage.setItem(STORE, JSON.stringify(serial(false))); } catch (e2) { /* 儲存空間不足 */ } }
    }, 400);
  }
  function load(data) {
    st.w = data.w || 1400; st.h = data.h || 900;
    st.bg = data.bg || '#e5e2da'; st.transparent = !!data.transparent;
    st.light = data.light || st.light; st.smooth = data.smooth == null ? st.smooth : data.smooth;
    st.imageOpacity = data.imageOpacity == null ? 1 : data.imageOpacity;
    st.layers = (data.layers || []).filter((l) => TB.BRUSHES[l.brush]).map((l) => ({
      id: l.id || TB.newId(), name: l.name || TB.BRUSHES[l.brush].name, brush: l.brush,
      params: Object.assign(TB.defaultParams(l.brush), l.params), ops: l.ops || [], visible: l.visible !== false, rev: nextRev()
    }));
    st.active = data.active && st.layers.find((l) => l.id === data.active) ? data.active : (st.layers[st.layers.length - 1] || {}).id || null;
    st.brush = data.brush && TB.BRUSHES[data.brush] ? data.brush : st.brush;
    st.texts = data.texts || [];
    st.textUnder = !!data.textUnder;
    setImage(data.image || null, false);
  }

  /* ---------------- 圖層操作 ---------------- */
  const pendingParams = (id) => (st.pending && st.pending.brush === id ? Object.assign({}, st.pending.params) : TB.defaultParams(id));
  function addLayer(brushId, select) {
    const L = TB.makeLayer(brushId);
    L.params = pendingParams(brushId);
    L.rev = nextRev();
    const i = st.layers.findIndex((l) => l.id === st.active);
    st.layers.splice(i < 0 ? st.layers.length : i + 1, 0, L);
    if (select !== false) st.active = L.id;
    return L;
  }
  // 選擇筆刷：目前圖層若是同一支筆刷就沿用，否則新增 (空圖層直接換筆刷)
  function layerForDrawing() {
    let L = activeLayer();
    if (L && L.brush === st.brush) return L;
    if (L && !L.ops.length) {
      L.brush = st.brush; L.name = TB.BRUSHES[st.brush].name; L.params = pendingParams(st.brush); L.rev = nextRev();
      return L;
    }
    return addLayer(st.brush);
  }
  function selectBrush(id) {
    st.brush = id;
    const L = activeLayer();
    if (L && L.brush !== id) {
      // 若已有此筆刷的圖層且位在最上方，就切過去；否則畫下時自動新增
      const top = st.layers[st.layers.length - 1];
      if (top && top.brush === id) st.active = top.id;
    }
    if (st.tool === 'text') setTool('draw');
    refreshAll();
  }

  /* ---------------- 畫布座標 / 尺寸 ---------------- */
  const doc = $('#doc'), stage = $('#stage');
  function fit() {
    const r = stage.getBoundingClientRect();
    const pad = window.innerWidth <= 820 ? 20 : 36;
    const s = Math.min((r.width - pad) / st.w, (r.height - pad) / st.h);
    const W = Math.max(50, Math.floor(st.w * s)), H = Math.max(50, Math.floor(st.h * s));
    doc.style.width = W + 'px'; doc.style.height = H + 'px';
    doc.style.setProperty('--fw', W + 'px');
    st.viewScale = W / st.w;
    updateInfo();
  }
  function setDocSize(w, h, keepContent) {
    if (w === st.w && h === st.h) return;
    if (keepContent !== false) {
      const s = Math.min(w / st.w, h / st.h), dx = (w - st.w * s) / 2, dy = (h - st.h * s) / 2;
      for (const L of st.layers) {
        L.ops = L.ops.map((op) => {
          const pts = op.pts.slice();
          for (let i = 0; i < pts.length; i += 3) { pts[i] = pts[i] * s + dx; pts[i + 1] = pts[i + 1] * s + dy; }
          return Object.assign({}, op, { pts });
        });
        L.rev = nextRev();
      }
    }
    st.w = w; st.h = h;
    renderer.resize(w, h);
    $('#bgCanvas').width = w; $('#bgCanvas').height = h;
    fit(); drawBg(); requestRender(); autosave();
  }
  function toDoc(e) {
    const r = doc.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * st.w, ((e.clientY - r.top) / r.height) * st.h];
  }

  /* ---------------- 背景 ---------------- */
  function drawBg() {
    const c = $('#bgCanvas'), ctx = c.getContext('2d');
    if (c.width !== st.w || c.height !== st.h) { c.width = st.w; c.height = st.h; }
    ctx.clearRect(0, 0, c.width, c.height);
    if (!st.transparent) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, c.width, c.height); }
    if (imgEl) {
      ctx.globalAlpha = st.imageOpacity;
      ctx.drawImage(imgEl, 0, 0, st.w, st.h);
      ctx.globalAlpha = 1;
    }
    $('#checker').style.display = st.transparent ? '' : 'none';
  }
  function setImage(dataUrl, resizeDoc) {
    st.image = dataUrl;
    if (!dataUrl) { imgEl = null; drawBg(); return; }
    const im = new Image();
    im.onload = () => {
      imgEl = im;
      if (resizeDoc) {
        const long = 1600, s = long / Math.max(im.width, im.height);
        setDocSize(Math.round(im.width * s), Math.round(im.height * s));
      }
      drawBg();
    };
    im.src = dataUrl;
  }

  /* ---------------- 繪製 ---------------- */
  let drawing = null;
  const cursor = $('#cursor');
  function cursorSize() {
    if (st.tool === 'erase') return st.er * 2;
    const L = activeLayer(), p = L && L.brush === st.brush ? L.params : TB.defaultParams(st.brush);
    return Math.max(4, (p.size || 8) * 2);
  }
  function moveCursor(e) {
    if (st.tool === 'text') { cursor.style.display = 'none'; return; }
    const r = doc.getBoundingClientRect();
    const d = cursorSize() * st.viewScale;
    Object.assign(cursor.style, { display: 'block', left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', width: d + 'px', height: d + 'px' });
  }
  doc.addEventListener('pointerleave', () => (cursor.style.display = 'none'));

  doc.addEventListener('pointerdown', (e) => {
    if (st.tool === 'text') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    doc.setPointerCapture(e.pointerId);
    let L;
    if (st.tool === 'erase') {
      L = activeLayer();
      if (!L) { toast('沒有可擦除的圖層'); return; }
    }
    pushHistory();
    if (st.tool === 'draw') L = layerForDrawing();
    const [x, y] = toDoc(e);
    const op = {
      pts: [], seed: (Math.random() * 1e9) | 0, mx: st.mx, my: st.my,
      erase: st.tool === 'erase' || undefined,
      alt: (st.tool === 'draw' && (st.alt || e.altKey) && TB.BRUSHES[L.brush].alt) ? true : undefined,
      er: st.tool === 'erase' ? st.er : undefined, es: st.tool === 'erase' ? st.es : undefined
    };
    const raster = ensureRaster(L);
    const t0 = e.timeStamp || performance.now();
    drawing = { L, op, raster, t0, sx: x, sy: y, ss: new TB.StrokeSession(raster, TB.BRUSHES[L.brush], L.params, op) };
    drawingLayer = L;
    op.pts.push(+x.toFixed(2), +y.toFixed(2), 0);
    drawing.ss.feed();
    requestRender();
    refreshLayers();
  });
  doc.addEventListener('pointermove', (e) => {
    moveCursor(e);
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const k = 1 - st.smooth;
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = toDoc(ev);
      drawing.sx += (x - drawing.sx) * k;
      drawing.sy += (y - drawing.sy) * k;
      drawing.op.pts.push(+drawing.sx.toFixed(2), +drawing.sy.toFixed(2), Math.max(0, Math.round((ev.timeStamp || performance.now()) - drawing.t0)));
    }
    drawing.ss.feed();
    requestRender();
  });
  const endStroke = () => {
    if (!drawing) return;
    const d = drawing;
    // 收尾：讓平滑後的點追上游標
    d.ss.feed(); d.ss.end();
    d.L.ops.push(d.op);
    d.L.rev = nextRev();
    rasters.get(d.L.id).rev = d.L.rev;
    drawing = null; drawingLayer = null;
    requestRender(); refreshLayers(); autosave();
  };
  doc.addEventListener('pointerup', endStroke);
  doc.addEventListener('pointercancel', endStroke);

  /* ---------------- 文字 (拖曳 / 編輯) ---------------- */
  function renderTexts() {
    $('#texts').style.zIndex = st.textUnder && st.tool !== 'text' ? 0 : 2;
    $('#glCanvas').style.zIndex = 1;
    $('#cursor').style.zIndex = $('#guides').style.zIndex = 3;
    $('#textUnder').checked = st.textUnder;
    TB.buildTextOverlay($('#texts'), st.texts, {
      decorate(d, b, idx) {
        if (idx === st.selText) d.classList.add('sel');
        d.addEventListener('pointerdown', (e) => {
          if (st.tool !== 'text' || d.isContentEditable) return;
          e.preventDefault(); e.stopPropagation();
          if (st.selText !== idx) { st.selText = idx; $$('.tb-text', $('#texts')).forEach((n, i) => n.classList.toggle('sel', i === idx)); buildTextProps(); }
          const r = doc.getBoundingClientRect(), ox = b.x, oy = b.y, sx = e.clientX, sy = e.clientY;
          let moved = false;
          const mv = (ev) => {
            if (!moved) { pushHistory(); moved = true; }
            b.x = ox + (ev.clientX - sx) / r.width; b.y = oy + (ev.clientY - sy) / r.height;
            d.style.left = b.x * 100 + '%'; d.style.top = b.y * 100 + '%';
          };
          const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) { autosave(); buildTextProps(); } };
          window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
        });
        d.addEventListener('dblclick', () => {
          if (st.tool !== 'text') return;
          pushHistory();
          d.contentEditable = 'plaintext-only';
          if (d.contentEditable !== 'plaintext-only') d.contentEditable = 'true';
          d.focus();
          document.getSelection().selectAllChildren(d);
        });
        d.addEventListener('input', () => { b.t = d.innerText; autosave(); const ta = $('#tTxt'); if (ta && st.selText === idx) ta.value = b.t; });
        d.addEventListener('blur', () => { d.contentEditable = 'false'; d.removeAttribute('contenteditable'); });
      }
    });
  }
  function buildTextProps() {
    const box = $('#textProps');
    box.innerHTML = '';
    const b = st.texts[st.selText];
    if (!b) { box.innerHTML = '<p class="hint">尚未選取文字。切到「文字」工具後點選畫面上的文字。</p>'; return; }
    const ta = document.createElement('textarea');
    ta.className = 'ttxt'; ta.id = 'tTxt'; ta.value = b.t;
    ta.addEventListener('focus', pushHistory);
    ta.addEventListener('input', () => { b.t = ta.value; renderTexts(); autosave(); });
    box.appendChild(ta);
    const upd = () => { renderTexts(); autosave(); };
    const defs = [
      { key: 's', label: '字級 Size', min: 0.005, max: 0.3, step: 0.001 },
      { key: 'x', label: '水平位置 X', min: -0.2, max: 1.2, step: 0.001 },
      { key: 'y', label: '垂直位置 Y', min: -0.2, max: 1.2, step: 0.001 },
      { key: 'r', label: '旋轉 Rotate', min: -180, max: 180, step: 1 },
      { key: 'ls', label: '字距 Tracking', min: -0.15, max: 0.5, step: 0.005 },
      { key: 'lh', label: '行高 Leading', min: 0.7, max: 2, step: 0.01 },
      { key: 'w', label: '字重 Weight', min: 300, max: 800, step: 100 }
    ];
    box.appendChild(colorCtl('文字顏色 Color', b.c || '#000000', (v) => { b.c = v; upd(); }));
    box.appendChild(selectCtl('字體 Font', [['sans', 'Sans 無襯線'], ['serif', 'Serif 襯線'], ['mono', 'Mono 等寬'], ['tc', '黑體 中文']], b.f || 'sans', (v) => { b.f = v; upd(); }));
    box.appendChild(selectCtl('對齊 Align', [['left', '靠左'], ['center', '置中'], ['right', '靠右']], b.a || 'left', (v) => { b.a = v; upd(); }));
    box.appendChild(toggleCtl('斜體 Italic', !!b.i, (v) => { b.i = v ? 1 : 0; upd(); }));
    box.appendChild(toggleCtl('發光 Glow', !!b.glow, (v) => { b.glow = v ? 1 : 0; upd(); }));
    for (const d of defs) {
      const v = b[d.key] == null ? ({ r: 0, ls: 0, lh: 1.1, w: 600 })[d.key] : b[d.key];
      box.appendChild(rangeCtl(d, v, (nv) => { b[d.key] = nv; upd(); }));
    }
  }

  /* ---------------- 控制項元件 ---------------- */
  function rangeCtl(d, value, onInput, opts) {
    opts = opts || {};
    const w = document.createElement('div');
    w.className = 'ctl' + (opts.changed ? ' changed' : '');
    w.innerHTML = `<label><span>${d.label}</span>${opts.reset ? '<button class="reset" title="回到預設">↺</button>' : ''}</label>
      <input type="range" min="${d.min}" max="${d.max}" step="${d.step}"><input type="number" min="${d.min}" max="${d.max}" step="${d.step}">`;
    const r = $('input[type=range]', w), n = $('input[type=number]', w);
    r.value = n.value = value;
    const begin = () => pushHistory();
    r.addEventListener('pointerdown', begin); n.addEventListener('focus', begin);
    r.addEventListener('keydown', (e) => { if (!e.repeat) begin(); });
    r.addEventListener('input', () => { n.value = r.value; onInput(+r.value); });
    n.addEventListener('change', () => { r.value = n.value; onInput(+n.value); });
    if (opts.reset) $('.reset', w).addEventListener('click', () => { pushHistory(); r.value = n.value = opts.reset; onInput(+opts.reset); w.classList.remove('changed'); });
    return w;
  }
  function colorCtl(label, value, onInput, opts) {
    opts = opts || {};
    const w = document.createElement('div');
    w.className = 'ctl color' + (opts.changed ? ' changed' : '');
    w.innerHTML = `<label>${label}</label><input type="color">`;
    const c = $('input', w);
    c.value = value;
    c.addEventListener('click', () => pushHistory());
    c.addEventListener('input', () => onInput(c.value));
    return w;
  }
  function selectCtl(label, options, value, onChange) {
    const w = document.createElement('div');
    w.className = 'ctl select';
    w.innerHTML = `<label>${label}</label><select>${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
    const s = $('select', w);
    s.value = value;
    s.addEventListener('change', () => { pushHistory(); onChange(s.value); });
    return w;
  }
  function toggleCtl(label, value, onChange) {
    const w = document.createElement('div');
    w.className = 'ctl toggle';
    w.innerHTML = `<label>${label}</label><input type="checkbox">`;
    const c = $('input', w);
    c.checked = value;
    c.addEventListener('change', () => { pushHistory(); onChange(c.checked); });
    return w;
  }

  /* ---------------- 筆刷面板 ---------------- */
  function buildBrushPane() {
    const pane = $('#pane-brush');
    pane.innerHTML = '';
    const b = TB.BRUSHES[st.brush];
    let L = activeLayer();
    const editing = L && L.brush === st.brush;
    const params = editing ? L.params : (st.pending && st.pending.brush === st.brush ? st.pending.params : (st.pending = { brush: st.brush, params: TB.defaultParams(st.brush) }).params);
    const defs = TB.defaultParams(st.brush);

    const head = document.createElement('div');
    head.innerHTML = `<span class="label"><span class="num">(${String(b.no).padStart(2, '0')})</span> ${b.en}</span>
      <p class="bname">${b.name}</p><p class="bdesc">${b.desc}</p>
      <p class="hint">${editing ? `正在調整圖層「${L.name}」— 變更會套用到這層已畫的所有筆觸。` : '下筆後會建立新的圖層，以下設定會帶入該圖層。'}</p>`;
    pane.appendChild(head);

    const isRaster = new Set(b.params.map((d) => d.key));
    const apply = (key, v) => {
      params[key] = v;
      if (editing) {
        if (isRaster.has(key)) { L.rev = nextRev(); scheduleReraster(); } else requestRender();
        autosave();
      }
      if (key === 'size') updateInfo();
    };
    const changed = (k) => String(params[k]) !== String(defs[k]);

    if (st.tool === 'erase') {
      const h = document.createElement('h4'); h.textContent = '橡皮擦 Eraser'; pane.appendChild(h);
      const p = document.createElement('p'); p.className = 'hint'; p.textContent = '橡皮擦切的是形體本身 (高度場)，不是完成的圖，所以切口保有和筆觸一樣的浮雕。只作用在目前選取的圖層。'; pane.appendChild(p);
      pane.appendChild(rangeCtl({ label: '大小 Size', min: 2, max: 150, step: 1 }, st.er, (v) => { st.er = v; }));
      pane.appendChild(rangeCtl({ label: '強度 Strength', min: 0.05, max: 1, step: 0.01 }, st.es, (v) => { st.es = v; }));
    }

    if (b.presets) {
      const h = document.createElement('h4'); h.textContent = '材質預設 Presets'; pane.appendChild(h);
      const chips = document.createElement('div'); chips.className = 'chips';
      for (const pr of b.presets) {
        const bt = document.createElement('button'); bt.textContent = pr.name;
        bt.onclick = () => { pushHistory(); Object.assign(params, pr.v); if (editing) { requestRender(); autosave(); } buildBrushPane(); };
        chips.appendChild(bt);
      }
      pane.appendChild(chips);
    }

    let h = document.createElement('h4'); h.innerHTML = '形體 Shape <span class="label">重新算繪筆觸</span>'; pane.appendChild(h);
    for (const d of b.params) {
      if (d.type === 'select') pane.appendChild(selectCtl(d.label, d.options, params[d.key], (v) => { apply(d.key, v); }));
      else pane.appendChild(rangeCtl(d, params[d.key], (v) => apply(d.key, v), { reset: String(defs[d.key]), changed: changed(d.key) }));
    }

    h = document.createElement('h4'); h.innerHTML = '材質 Material <span class="label">即時</span>'; pane.appendChild(h);
    const shadeCtl = (key) => {
      const u = TB.SHADE_UI[key];
      if (u.type === 'color') {
        const el = colorCtl(u.label, params[key], (v) => apply(key, v), { changed: changed(key) });
        if (key === 'color') {
          const sw = document.createElement('div'); sw.className = 'swatches';
          COLORS.forEach((c) => { const bt = document.createElement('button'); bt.style.background = c; bt.title = c; bt.onclick = () => { pushHistory(); apply('color', c); $('input', el).value = c; }; sw.appendChild(bt); });
          const frag = document.createDocumentFragment(); frag.appendChild(el); frag.appendChild(sw); return frag;
        }
        return el;
      }
      if (u.type === 'toggle') return toggleCtl(u.label, !!params[key], (v) => apply(key, v ? 1 : 0));
      return rangeCtl(u, params[key], (v) => apply(key, v), { reset: String(defs[key]), changed: changed(key) });
    };
    for (const key of b.ui) pane.appendChild(shadeCtl(key));

    const adv = document.createElement('details'); adv.className = 'adv';
    adv.innerHTML = '<summary>進階材質 Advanced — 全部參數</summary>';
    for (const [g, keys] of TB.SHADE_GROUPS) {
      const gl = document.createElement('div'); gl.className = 'grp'; gl.textContent = g; adv.appendChild(gl);
      keys.filter((k) => !b.ui.includes(k)).forEach((k) => adv.appendChild(shadeCtl(k)));
    }
    adv.open = !!st.advOpen;
    adv.addEventListener('toggle', () => (st.advOpen = adv.open));
    pane.appendChild(adv);

    h = document.createElement('h4'); h.textContent = '光源 Light (所有圖層)'; pane.appendChild(h);
    pane.appendChild(rangeCtl({ label: '方向 Azimuth°', min: 0, max: 360, step: 1 }, st.light.az, (v) => { st.light.az = v; requestRender(); autosave(); }));
    pane.appendChild(rangeCtl({ label: '高度 Elevation°', min: 5, max: 89, step: 1 }, st.light.el, (v) => { st.light.el = v; requestRender(); autosave(); }));

    const row = document.createElement('div'); row.className = 'row';
    const rs = document.createElement('button'); rs.className = 'tbtn'; rs.textContent = '重設為預設值';
    rs.onclick = () => { pushHistory(); const d = TB.defaultParams(st.brush); Object.keys(params).forEach((k) => delete params[k]); Object.assign(params, d); if (editing) { L.rev = nextRev(); requestRender(); autosave(); } buildBrushPane(); };
    const cp = document.createElement('button'); cp.className = 'tbtn'; cp.textContent = '複製設定';
    cp.onclick = () => { st.clip = { brush: st.brush, params: Object.assign({}, params) }; toast('已複製「' + b.name + '」設定'); };
    const ps = document.createElement('button'); ps.className = 'tbtn'; ps.textContent = '貼上設定';
    ps.disabled = !(st.clip && st.clip.brush === st.brush);
    ps.onclick = () => { pushHistory(); Object.assign(params, st.clip.params); if (editing) { L.rev = nextRev(); requestRender(); autosave(); } buildBrushPane(); };
    row.append(rs, cp, ps);
    pane.appendChild(row);
  }

  /* ---------------- 圖層面板 ---------------- */
  function refreshLayers() {
    const ul = $('#layerList');
    ul.innerHTML = '';
    $('#layerCount').textContent = st.layers.length + ' 層';
    [...st.layers].reverse().forEach((L) => {
      const li = document.createElement('li');
      li.className = L.id === st.active ? 'on' : '';
      const b = TB.BRUSHES[L.brush];
      li.innerHTML = `<button class="vis" title="顯示/隱藏">${L.visible ? '●' : '○'}</button>
        <div><span class="nm" spellcheck="false">${escapeHtml(L.name)}</span><span class="meta">(${String(b.no).padStart(2, '0')}) ${b.en} · ${L.ops.length} 筆</span></div>
        <div class="acts"><button data-a="up" title="上移">↑</button><button data-a="down" title="下移">↓</button><button data-a="dup" title="複製圖層">⧉</button><button data-a="del" title="刪除">✕</button></div>`;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.acts') || e.target.closest('.vis')) return;
        st.active = L.id; st.brush = L.brush; refreshAll();
      });
      const nm = $('.nm', li);
      nm.addEventListener('dblclick', () => { nm.contentEditable = 'true'; nm.focus(); document.getSelection().selectAllChildren(nm); });
      nm.addEventListener('blur', () => { nm.contentEditable = 'false'; if (nm.textContent.trim() && nm.textContent !== L.name) { pushHistory(); L.name = nm.textContent.trim(); autosave(); } });
      nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } });
      $('.vis', li).onclick = () => { pushHistory(); L.visible = !L.visible; refreshLayers(); requestRender(); autosave(); };
      $$('.acts button', li).forEach((bt) => bt.onclick = () => {
        const i = st.layers.indexOf(L);
        pushHistory();
        if (bt.dataset.a === 'up' && i < st.layers.length - 1) [st.layers[i], st.layers[i + 1]] = [st.layers[i + 1], st.layers[i]];
        if (bt.dataset.a === 'down' && i > 0) [st.layers[i], st.layers[i - 1]] = [st.layers[i - 1], st.layers[i]];
        if (bt.dataset.a === 'dup') {
          const c = Object.assign({}, L, { id: TB.newId(), name: L.name + ' 複本', params: Object.assign({}, L.params), ops: L.ops.slice(), rev: nextRev() });
          st.layers.splice(i + 1, 0, c); st.active = c.id;
        }
        if (bt.dataset.a === 'del') {
          st.layers.splice(i, 1);
          const e = rasters.get(L.id); if (e) { renderer.release(e.raster); rasters.delete(L.id); }
          if (st.active === L.id) st.active = (st.layers[Math.min(i, st.layers.length - 1)] || {}).id || null;
        }
        refreshAll(); autosave();
      });
      ul.appendChild(li);
    });
    if (!st.layers.length) ul.innerHTML = '<li style="cursor:default"><span></span><span class="hint">還沒有圖層 — 選一支筆刷直接在畫布上畫。</span></li>';
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* ---------------- 其他 UI ---------------- */
  function buildBrushList() {
    const box = $('#brushList');
    box.innerHTML = '';
    TB.BRUSH_ORDER.forEach((id) => {
      const b = TB.BRUSHES[id];
      const bt = document.createElement('button');
      bt.dataset.id = id;
      bt.innerHTML = `<span class="num">${String(b.no).padStart(2, '0')}</span><span><b>${b.name}</b><span class="en">${b.en}</span></span>`;
      bt.onclick = () => selectBrush(id);
      box.appendChild(bt);
    });
  }
  function refreshBrushList() { $$('#brushList button').forEach((b) => b.classList.toggle('on', b.dataset.id === st.brush)); }
  function setTool(t) {
    st.tool = t;
    $$('.toolbar [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    doc.classList.toggle('texting', t === 'text');
    renderTexts();
    if (t === 'text') switchTab('text');
    buildBrushPane(); updateInfo();
  }
  function switchTab(t) {
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + t));
  }
  function updateMirror() {
    $('#mxBtn').classList.toggle('on', st.mx); $('#myBtn').classList.toggle('on', st.my);
    $('.guides .gx').hidden = !st.mx; $('.guides .gy').hidden = !st.my;
  }
  function updateAlt() {
    const b = TB.BRUSHES[st.brush];
    $('#altBtn').hidden = !b.alt;
    if (b.alt) $('#altBtn').textContent = b.alt;
    $('#altBtn').classList.toggle('on', st.alt);
  }
  function updateInfo() {
    const L = activeLayer();
    $('#info').textContent = `${st.w}×${st.h} · ${Math.round((st.viewScale || 1) * 100)}% · ${L ? L.name : '—'}`;
  }
  function refreshAll() {
    refreshBrushList(); buildBrushPane(); refreshLayers(); updateAlt(); updateMirror(); updateInfo();
    renderTexts(); buildTextProps();
    $('#bgColor').value = st.bg; $('#transparentBg').checked = st.transparent;
    $('#smooth').value = $('#smoothN').value = st.smooth;
    $('#imgOp').value = $('#imgOpN').value = st.imageOpacity;
    const sz = st.w + 'x' + st.h; const sel = $('#sizeSel');
    if (![...sel.options].some((o) => o.value === sz)) { const o = document.createElement('option'); o.value = sz; o.textContent = `${st.w} × ${st.h} 自訂`; sel.appendChild(o); }
    sel.value = sz;
    drawBg(); requestRender();
  }

  /* ---------------- 匯出 ---------------- */
  async function exportPng() {
    await document.fonts.ready;
    renderNow();
    const c = document.createElement('canvas'); c.width = st.w; c.height = st.h;
    const ctx = c.getContext('2d');
    const withText = $('#exText').checked;
    if ($('#exBg').checked) ctx.drawImage($('#bgCanvas'), 0, 0);
    if (withText && st.textUnder) TB.drawTexts(ctx, st.texts, st.w, st.h);
    ctx.drawImage($('#glCanvas'), 0, 0);
    if (withText && !st.textUnder) TB.drawTexts(ctx, st.texts, st.w, st.h);
    c.toBlob((blob) => download(blob, `tactile-${Date.now()}.png`), 'image/png');
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------- 樣板 ---------------- */
  function loadTemplate(id, variant) {
    const T = TB.TEMPLATES.find((t) => t.id === id);
    if (!T) return;
    pushHistory();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('tactile-works-texts') || '{}')[id]; } catch (e) { /* ignore */ }
    const v = T.variants ? T.variants[variant || 0] || T.variants[0] : null;
    st.w = T.w; st.h = T.h;
    renderer.resize(st.w, st.h);
    st.bg = v ? v.bg : T.bg; st.transparent = false;
    for (const e of rasters.values()) renderer.release(e.raster);
    rasters.clear();
    st.layers = TB.layersFromSpec(T.layers, T.w, T.h);
    st.layers.forEach((L) => { L.rev = nextRev(); if (v) L.params.color = v.color; });
    st.active = st.layers.length ? st.layers[st.layers.length - 1].id : null;
    st.brush = st.layers.length ? st.layers[st.layers.length - 1].brush : st.brush;
    st.texts = JSON.parse(JSON.stringify(saved || T.texts));
    st.textUnder = !!T.under;
    if (v && v.text) st.texts.forEach((t) => (t.c = v.text));
    st.selText = -1;
    setImage(null);
    fit(); refreshAll(); autosave();
    toast('已載入樣板「' + T.title + '」');
  }

  /* ---------------- 啟動 ---------------- */
  function init() {
    try { renderer = new TB.Renderer($('#glCanvas')); }
    catch (e) { document.querySelector('.stage').innerHTML = `<p class="hint" style="padding:40px">${e.message}。請改用最新版 Chrome / Safari / Firefox。</p>`; return; }

    buildBrushList();
    PAPERS.forEach((c) => { const b = document.createElement('button'); b.style.background = c; b.title = c; b.onclick = () => { st.bg = c; st.transparent = false; refreshAll(); autosave(); }; $('#paperSw').appendChild(b); });
    $('#tplSel').innerHTML = '<option value="">— 選擇樣板 —</option>' + TB.TEMPLATES.map((t) => `<option value="${t.id}">${t.title} · ${t.caption}</option>`).join('');

    // 讀取：URL 樣板 > URL 筆刷 > 自動儲存
    const q = new URLSearchParams(location.search);
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { data = null; }
    if (data && !q.get('t')) load(data);
    renderer.resize(st.w, st.h);
    if (q.get('t')) loadTemplate(q.get('t'), +q.get('v') || 0);
    if (q.get('brush') && TB.BRUSHES[q.get('brush')]) {
      st.brush = q.get('brush');
      const b = TB.BRUSHES[st.brush];
      if (!st.layers.length && b.paper) st.bg = b.paper;
    }
    if (q.get('t') || q.get('brush')) history.replaceState(null, '', location.pathname);

    // 工具列
    $$('.toolbar [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $('#altBtn').onclick = () => { st.alt = !st.alt; updateAlt(); };
    $('#mxBtn').onclick = () => { st.mx = !st.mx; updateMirror(); };
    $('#myBtn').onclick = () => { st.my = !st.my; updateMirror(); };
    $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
    $$('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

    // 圖層
    $('#addLayer').onclick = () => { pushHistory(); addLayer(st.brush); refreshAll(); autosave(); };
    $('#clearLayer').onclick = () => { const L = activeLayer(); if (!L || !L.ops.length) return; pushHistory(); L.ops = []; L.rev = nextRev(); refreshAll(); autosave(); };

    // 文字
    $('#addText').onclick = () => {
      pushHistory();
      st.texts.push({ t: '新文字\nNEW TEXT', x: 0.08, y: 0.08, s: 0.04, f: 'sans', w: 700, c: '#141210', lh: 1.05 });
      st.selText = st.texts.length - 1; setTool('text'); renderTexts(); buildTextProps(); autosave();
    };
    $('#textUnder').onchange = (e) => { pushHistory(); st.textUnder = e.target.checked; renderTexts(); autosave(); };
    $('#delText').onclick = () => { if (st.selText < 0) return; pushHistory(); st.texts.splice(st.selText, 1); st.selText = -1; renderTexts(); buildTextProps(); autosave(); };

    // 文件
    $('#tplSel').onchange = (e) => { if (e.target.value) loadTemplate(e.target.value); e.target.value = ''; };
    $('#sizeSel').onchange = (e) => { pushHistory(); const [w, h] = e.target.value.split('x').map(Number); setDocSize(w, h); refreshAll(); };
    $('#bgColor').oninput = (e) => { st.bg = e.target.value; st.transparent = false; $('#transparentBg').checked = false; drawBg(); autosave(); };
    $('#transparentBg').onchange = (e) => { st.transparent = e.target.checked; drawBg(); autosave(); };
    $('#imgIn').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { pushHistory(); setImage(rd.result, true); autosave(); toast('圖片已放入，畫布改為圖片比例'); };
      rd.readAsDataURL(f); e.target.value = '';
    };
    $('#imgDel').onclick = () => { setImage(null); autosave(); };
    const op = (v) => { st.imageOpacity = +v; $('#imgOp').value = $('#imgOpN').value = v; drawBg(); autosave(); };
    $('#imgOp').oninput = (e) => op(e.target.value); $('#imgOpN').onchange = (e) => op(e.target.value);
    const sm = (v) => { st.smooth = +v; $('#smooth').value = $('#smoothN').value = v; autosave(); };
    $('#smooth').oninput = (e) => sm(e.target.value); $('#smoothN').onchange = (e) => sm(e.target.value);
    $('#exportPng').onclick = exportPng;
    $('#saveJson').onclick = () => download(new Blob([JSON.stringify(serial(true))], { type: 'application/json' }), `tactile-project-${Date.now()}.json`);
    $('#loadJson').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((t) => { pushHistory(); for (const x of rasters.values()) renderer.release(x.raster); rasters.clear(); load(JSON.parse(t)); renderer.resize(st.w, st.h); fit(); refreshAll(); autosave(); toast('專案已開啟'); })
        .catch(() => toast('無法讀取這個檔案'));
      e.target.value = '';
    };
    $('#newDoc').onclick = () => {
      if (!confirm('清空所有圖層與文字？(可用「復原」找回)')) return;
      pushHistory(); st.layers = []; st.active = null; st.texts = []; st.selText = -1; setImage(null); refreshAll(); autosave();
    };

    // 鍵盤
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      const k = e.key.toLowerCase();
      if (k === 'b') setTool('draw');
      else if (k === 'e') setTool('erase');
      else if (k === 't') setTool('text');
      else if (k === 'x') { st.mx = !st.mx; updateMirror(); }
      else if (k === 'y') { st.my = !st.my; updateMirror(); }
      else if (k === '[' || k === ']') {
        const f = k === ']' ? 1.15 : 1 / 1.15;
        if (st.tool === 'erase') st.er = Math.max(2, Math.min(150, st.er * f));
        else { const L = activeLayer(); if (L && L.brush === st.brush) { L.params.size = Math.max(0.5, Math.min(80, L.params.size * f)); L.rev = nextRev(); scheduleReraster(); } }
        buildBrushPane();
      } else if (/^[0-9]$/.test(k)) {
        const idx = k === '0' ? 9 : +k - 1; if (TB.BRUSH_ORDER[idx]) selectBrush(TB.BRUSH_ORDER[idx]);
      }
    });

    new ResizeObserver(fit).observe(stage);
    document.fonts && document.fonts.ready.then(renderTexts);
    fit(); refreshAll(); updateUndo();
  }

  init();
  window.__lab = { st, renderNow, loadTemplate };
})();
