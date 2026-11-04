/* 在瀏覽器頁面內執行的測試輔助 (由 tests/audit.js 注入)。只讀取 / 呼叫既有 API，不修改產品程式碼。 */
(function () {
  const H = (window.H = {});
  H.fnv = function (u8) {
    let h = 0x811c9dc5;
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  H.hashF32 = (f) => H.fnv(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  H.canvasPixels = function (src) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  H.hashCanvas = (src) => H.fnv(H.canvasPixels(src));

  H.fixtureLayer = function (brushId, overrides, opsFilter) {
    const L = TB.makeLayer(brushId, overrides || {});
    L.ops = FIX.allOps().filter(opsFilter || (() => true)).map((o) => ({ pts: o.pts.slice(), seed: o.seed }));
    return L;
  };

  // 每格有沒有產生高度
  H.cellCoverage = function (raster) {
    const out = [];
    for (let cell = 0; cell < 10; cell++) {
      const ox = (cell % 5) * FIX.CW, oy = Math.floor(cell / 5) * FIX.CH;
      let n = 0;
      for (let y = oy; y < oy + FIX.CH; y += 1) for (let x = ox; x < ox + FIX.CW; x += 1) if (raster.d[(y * raster.w + x) * 2] > 0.5) n++;
      out.push(n);
    }
    return out;
  };

  H.rasterFixture = function (brushId, overrides) {
    const L = H.fixtureLayer(brushId, overrides);
    const r = new TB.Raster(FIX.W, FIX.H);
    const t0 = performance.now();
    TB.rasterLayer(L, r);
    const ms = performance.now() - t0;
    return { L, r, ms };
  };

  // 一次餵完 vs 分段餵 (模擬即時繪製) 的高度場是否完全相同
  H.liveVsReplay = function (brushId) {
    const L = H.fixtureLayer(brushId);
    const a = new TB.Raster(FIX.W, FIX.H); TB.rasterLayer(L, a);
    const b = new TB.Raster(FIX.W, FIX.H); b.clear();
    const brush = TB.BRUSHES[brushId];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (const op of L.ops) {
      const live = { pts: [], seed: op.seed };
      const ss = new TB.StrokeSession(b, brush, L.params, live);
      let i = 0;
      while (i < op.pts.length) {
        const n = 3 * (1 + Math.floor(rnd() * 6));
        live.pts.push(...op.pts.slice(i, i + n)); i += n;
        ss.feed();
      }
      ss.end();
    }
    let diff = 0, maxd = 0;
    for (let i = 0; i < a.d.length; i++) { const d = Math.abs(a.d[i] - b.d[i]); if (d > 0) diff++; if (d > maxd) maxd = d; }
    return { equal: H.hashF32(a.d) === H.hashF32(b.d), diff, maxd };
  };

  // 鏡像對稱誤差
  H.mirror = function (brushId, mx, my) {
    const L = TB.makeLayer(brushId);
    L.ops = [Object.assign({ pts: FIX.strokes[3].ops[0].pts.map((v, i) => (i % 3 === 0 ? v * 0.5 + 40 : i % 3 === 1 ? v * 0.6 : v)), seed: 9 }, { mx, my })];
    const r = new TB.Raster(600, 400); TB.rasterLayer(L, r);
    let maxd = 0, n = 0, tot = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const a = r.d[(y * r.w + x) * 2];
      const xx = mx ? r.w - 1 - x : x, yy = my ? r.h - 1 - y : y;
      const b = r.d[(yy * r.w + xx) * 2];
      if (a > 0 || b > 0) tot++;
      const d = Math.abs(a - b); if (d > 1e-3) n++; if (d > maxd) maxd = d;
    }
    return { maxd: +maxd.toFixed(4), asymPixels: n, coveredPixels: tot };
  };

  H.renderToCanvas = function (layers, w, h, bg) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    const t0 = performance.now();
    TB.renderLayersTo(layers, w, h, { az: 225, el: 42 }, c, { keep: true });
    return { c, ms: performance.now() - t0 };
  };
  H.pixel = function (c, x, y) { const d = c.getContext('2d').getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
})();
