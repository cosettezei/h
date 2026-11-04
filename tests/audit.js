#!/usr/bin/env node
/* Phase 2 驗收測試 (Chromium headless + SwiftShader WebGL2)
 *
 *   node tests/audit.js              # 執行全部，輸出到 tests/out/
 *   node tests/audit.js --baseline   # 另外把基準圖寫入 tests/baseline/
 *   node tests/audit.js --only=E1,U4 # 只跑指定項目
 *
 * 不修改任何作者資料：每個測試用獨立的瀏覽器 context (localStorage 全新)。
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const BASE = path.join(__dirname, 'baseline');
const args = process.argv.slice(2);
const WRITE_BASELINE = args.includes('--baseline');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
if (WRITE_BASELINE) fs.mkdirSync(BASE, { recursive: true });

/* ---------- 靜態伺服器 ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

/* ---------- 小工具 ---------- */
function png(w, h, rgba) { // 產生 PNG (測試用底圖)
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const results = [];
let browser, ENV = {};
const BASEURL = () => `http://127.0.0.1:${server.address().port}`;

async function newPage(opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.dpr || 1, acceptDownloads: true });
  await ctx.addInitScript(() => {
    // 計數 GPU 資源配置 / 釋放 (只觀察，不改變行為)
    const P = WebGL2RenderingContext.prototype;
    window.__gpu = { tex: 0, fbo: 0 };
    const ct = P.createTexture, dt = P.deleteTexture, cf = P.createFramebuffer, df = P.deleteFramebuffer;
    P.createTexture = function () { window.__gpu.tex++; return ct.apply(this, arguments); };
    P.deleteTexture = function (t) { if (t) window.__gpu.tex--; return dt.apply(this, arguments); };
    P.createFramebuffer = function () { window.__gpu.fbo++; return cf.apply(this, arguments); };
    P.deleteFramebuffer = function (f) { if (f) window.__gpu.fbo--; return df.apply(this, arguments); };
  });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.__errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
async function openLab(page, small) {
  await page.goto(BASEURL() + '/lab.html', { waitUntil: 'load' });
  if (small) {
    await page.evaluate(() => localStorage.setItem('tactile-lab-v1', JSON.stringify({ v: 1, w: 600, h: 400, bg: '#e5e2da', layers: [], texts: [] })));
    await page.reload({ waitUntil: 'load' });
  }
  await page.addScriptTag({ path: path.join(__dirname, 'fixtures/strokes.js') });
  await page.addScriptTag({ path: path.join(__dirname, 'harness.js') });
  await page.waitForTimeout(300);
}
async function draw(page, pts, opts) { // pts 為 0..1 的文件座標
  opts = opts || {};
  const b = await (await page.$('#doc')).boundingBox();
  const at = ([x, y]) => [b.x + x * b.width, b.y + y * b.height];
  await page.mouse.move(...at(pts[0]));
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  for (const p of pts.slice(1)) { await page.mouse.move(...at(p)); if (opts.delay) await page.waitForTimeout(opts.delay); }
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
  await page.waitForTimeout(60);
}
const wave = (x0, x1, y, amp, n) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * (i / (n - 1)), y + Math.sin((i / (n - 1)) * Math.PI * 2) * amp]);
const stateOf = (page) => page.evaluate(() => {
  const s = window.__lab.st;
  return JSON.parse(JSON.stringify({ w: s.w, h: s.h, bg: s.bg, light: s.light, image: !!s.image, textUnder: s.textUnder, active: s.active,
    layers: s.layers.map((l) => ({ id: l.id, name: l.name, brush: l.brush, visible: l.visible, params: l.params, ops: l.ops.map((o) => ({ n: o.pts.length / 3, seed: o.seed, erase: !!o.erase, mx: !!o.mx, my: !!o.my, x0: o.pts[0], y0: o.pts[1] })) })),
    texts: s.texts }));
});
const glHash = (page) => page.evaluate(() => { window.__lab.renderNow(); return H.hashCanvas(document.getElementById('glCanvas')); });
const stable = (o) => JSON.stringify(o);

async function test(id, mod, title, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const t0 = Date.now();
  process.stdout.write(`${id} ${title} … `);
  const rec = { id, module: mod, title, status: 'NOT TESTED', steps: [], expected: '', actual: '', evidence: [], impact: '', notes: '' };
  try { await fn(rec); }
  catch (e) { rec.status = 'FAIL'; rec.actual = (rec.actual ? rec.actual + '\n' : '') + 'EXCEPTION: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | '); }
  rec.ms = Date.now() - t0;
  console.log(rec.status, `(${(rec.ms / 1000).toFixed(1)}s)`);
  results.push(rec);
}
const verdict = (ok, partial) => (ok ? 'PASS' : partial ? 'PARTIAL' : 'FAIL');

/* =================================================================== */
async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  {
    const { ctx, page } = await newPage();
    await openLab(page);
    ENV = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return { userAgent: navigator.userAgent, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxRenderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), floatFbo: !!gl.getExtension('EXT_color_buffer_float') };
    });
    ENV.browserVersion = browser.version();
    ENV.git = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    ENV.date = new Date().toISOString();
    await ctx.close();
  }
  console.log('ENV', ENV);

  /* ---------------- 引擎層 ---------------- */
  const eng = await newPage();
  await openLab(eng.page);
  const P = eng.page;
  const BRUSHES = await P.evaluate(() => TB.BRUSH_ORDER);

  await test('E1', '筆刷切換', '15 支筆刷對 10 種固定筆觸都產生形體', async (r) => {
    r.steps = ['以固定資料集 (10 型態、14 筆) 對每支筆刷呼叫 TB.rasterLayer', '統計每格高度 > 0.5px 的像素數'];
    r.expected = '15×10 格全部有形體 (極短筆觸也應留下痕跡)';
    const rows = await P.evaluate((ids) => ids.map((id) => ({ id, cov: H.cellCoverage(H.rasterFixture(id).r) })), BRUSHES);
    const empty = [];
    rows.forEach((x) => x.cov.forEach((n, i) => { if (n === 0) empty.push(`${x.id}:${i}`); }));
    r.data = rows;
    r.status = verdict(!empty.length, empty.length < 10);
    r.actual = empty.length ? `空白格: ${empty.join(', ')}` : '150/150 格都有形體';
  });

  await test('E2', '材質引擎', '相同輸入重算兩次結果完全一致 (可重現)', async (r) => {
    r.steps = ['同一筆刷 / 種子 / 資料集算兩次高度場', '比較 Float32 位元雜湊'];
    r.expected = '15/15 雜湊一致';
    const rows = await P.evaluate((ids) => ids.map((id) => [id, H.hashF32(H.rasterFixture(id).r.d), H.hashF32(H.rasterFixture(id).r.d)]), BRUSHES);
    const bad = rows.filter((x) => x[1] !== x[2]).map((x) => x[0]);
    r.data = rows;
    r.status = verdict(!bad.length);
    r.actual = bad.length ? '不一致: ' + bad.join(',') : '15/15 一致';
  });

  await test('E3', '筆觸輸入', '即時分段繪製與重播的高度場一致', async (r) => {
    r.steps = ['把每筆以隨機 1–6 點的小段餵入 StrokeSession (模擬指標事件)', '與一次重播比較'];
    r.expected = '完全相同 — 否則畫完後重新開啟圖層形體會「跳動」';
    const rows = await P.evaluate((ids) => ids.map((id) => Object.assign({ id }, H.liveVsReplay(id))), BRUSHES);
    const bad = rows.filter((x) => !x.equal);
    r.data = rows;
    r.status = verdict(!bad.length);
    r.actual = bad.length ? bad.map((x) => `${x.id} diff=${x.diff} max=${x.maxd}`).join('; ') : '15/15 位元相同';
  });

  await test('E4', '材質引擎', '15 支筆刷基準圖 (固定資料集)', async (r) => {
    r.steps = ['1200×800、預設參數、光源 225°/42°、各筆刷 paper 底色', '輸出 PNG + 參數 JSON'];
    r.expected = '每支筆刷一張可比對的基準圖';
    const shots = await P.evaluate((ids) => ids.map((id) => {
      const { L } = H.rasterFixture(id);
      const { c, ms } = H.renderToCanvas([L], FIX.W, FIX.H, TB.BRUSHES[id].paper || '#e5e2da');
      return { id, ms, png: c.toDataURL('image/png'), hash: H.hashCanvas(c), params: L.params };
    }), BRUSHES);
    const dir = path.join(OUT, 'brushes'); fs.mkdirSync(dir, { recursive: true });
    const params = {};
    shots.forEach((s, i) => {
      const name = `${String(i + 1).padStart(2, '0')}-${s.id}.png`;
      const buf = Buffer.from(s.png.split(',')[1], 'base64');
      fs.writeFileSync(path.join(dir, name), buf);
      if (WRITE_BASELINE) { fs.mkdirSync(path.join(BASE, 'brushes'), { recursive: true }); fs.writeFileSync(path.join(BASE, 'brushes', name), buf); }
      params[s.id] = { pixelHash: s.hash, params: s.params };
    });
    fs.writeFileSync(path.join(OUT, 'brush-params.json'), JSON.stringify(params, null, 1));
    if (WRITE_BASELINE) fs.writeFileSync(path.join(BASE, 'brush-params.json'), JSON.stringify(params, null, 1));
    r.evidence = ['tests/out/brushes/*.png', 'tests/out/brush-params.json'];
    r.status = 'PASS';
    r.actual = `${shots.length} 張；渲染時間 (SwiftShader) ${shots.map((s) => s.id + ':' + Math.round(s.ms)).join(' ')} ms`;
    r.notes = '只證明「能顯示」，不代表材質品質已驗收 (見 Phase C)。';
  });

  await test('E5', '效能', '高度場生成時間 / 記憶體估算', async (r) => {
    r.steps = ['每支筆刷算固定資料集 3 次取中位數', '另以 long (1949 點) 單筆測最慢情況', '以文件尺寸估算每層記憶體'];
    r.expected = '建立基準數字 (無通過門檻，供之後比較)';
    const rows = await P.evaluate((ids) => ids.map((id) => {
      const t = [0, 1, 2].map(() => H.rasterFixture(id).ms).sort((a, b) => a - b)[1];
      const L = H.fixtureLayer(id, null, (o) => o.pts.length > 5000);
      L.ops = [{ pts: FIX.strokes[9].ops[0].pts.slice(), seed: 1 }];
      const rr = new TB.Raster(FIX.W, FIX.H); const a = performance.now(); TB.rasterLayer(L, rr);
      return { id, fixtureMs: +t.toFixed(1), longStrokeMs: +(performance.now() - a).toFixed(1) };
    }), BRUSHES);
    const bytesPerLayer = (w, h) => ({ cpuHeight: w * h * 2 * 4, cpuStackBase: w * h * 4, gpuTexture: w * h * 2 * 4 });
    r.data = { rows, perLayer1400x900: bytesPerLayer(1400, 900), sharedFbo1400x900: 1400 * 900 * 16 * 2 };
    r.status = 'PASS';
    const pl = r.data.perLayer1400x900;
    r.actual = `資料集: ${rows.map((x) => x.id + ' ' + x.fixtureMs).join(', ')} ms。長筆觸最慢 ${rows.reduce((a, b) => (a.longStrokeMs > b.longStrokeMs ? a : b)).id}。1400×900 每層 CPU 高度場 ${(pl.cpuHeight / 1048576).toFixed(1)}MB + 堆疊快照 ${(pl.cpuStackBase / 1048576).toFixed(1)}MB，GPU 紋理 ${(pl.gpuTexture / 1048576).toFixed(1)}MB；共用模糊 FBO ${(r.data.sharedFbo1400x900 / 1048576).toFixed(1)}MB`;
  });

  await test('E6', '鏡像', '水平 / 垂直 / 四向鏡像的對稱誤差', async (r) => {
    r.steps = ['600×400 畫布畫一筆 S 曲線，分別 mx / my / mx+my', '逐像素比較 h(x,y) 與鏡像位置'];
    r.expected = '最大誤差 ≈ 0 (浮點誤差內)';
    const rows = [];
    for (const id of ['ceramic', 'laurel', 'sand', 'clay']) {
      for (const [mx, my] of [[1, 0], [0, 1], [1, 1]]) rows.push(Object.assign({ id, mx, my }, await P.evaluate(([id, mx, my]) => H.mirror(id, !!mx, !!my), [id, mx, my])));
    }
    r.data = rows;
    const worst = rows.reduce((a, b) => (a.maxd > b.maxd ? a : b));
    const anyBig = rows.filter((x) => x.asymPixels / Math.max(1, x.coveredPixels) > 0.001);
    r.status = verdict(!anyBig.length, true);
    r.actual = `最大誤差 ${worst.maxd}px (${worst.id} mx=${worst.mx} my=${worst.my})；不對稱像素比例超過 0.1% 的組合: ${anyBig.map((x) => `${x.id}/${x.mx}${x.my} ${x.asymPixels}/${x.coveredPixels}`).join(', ') || '無'}`;
    r.notes = '若有誤差，來自鏡像軸附近原筆觸與鏡像筆觸互相重疊時，非交換運算 (CARVE/DENT) 的先後順序。';
  });

  await test('E7', '橡皮擦', '擦除切到形體，修改形體參數後擦除仍保留', async (r) => {
    r.steps = ['ceramic 水平線 (600×400)', '加一筆 erase op 垂直穿過中段', '量擦除帶中心高度', '把 size 改成 2 倍重算，再量一次'];
    r.expected = '擦除帶中心高度 ≈ 0；改參數後仍 ≈ 0；擦除帶以外保持原高度';
    const d = await P.evaluate(() => {
      const L = TB.makeLayer('ceramic');
      const line = []; for (let i = 0; i <= 100; i++) line.push(100 + i * 4, 200, i * 8);
      L.ops = [{ pts: line, seed: 1 }, { pts: [300, 120, 0, 300, 280, 200], seed: 2, erase: true, er: 20, es: 1 }];
      const r = new TB.Raster(600, 400);
      TB.rasterLayer(L, r);
      const at = (x, y) => r.d[(y * 600 + x) * 2];
      const a = { cut: at(300, 200), keep: at(200, 200) };
      L.params.size *= 2; TB.rasterLayer(L, r);
      const b = { cut: at(300, 200), keep: at(200, 200), edge: at(322, 200) };
      return { a, b };
    });
    r.data = d;
    const ok = d.a.cut < 0.01 && d.b.cut < 0.01 && d.a.keep > 5 && d.b.keep > d.a.keep;
    r.status = verdict(ok);
    r.actual = `擦除帶中心 ${d.a.cut.toFixed(3)} → 改參數後 ${d.b.cut.toFixed(3)}；保留區 ${d.a.keep.toFixed(1)} → ${d.b.keep.toFixed(1)}px；切口外緣 ${d.b.edge.toFixed(1)}px`;
    r.notes = '因為擦除是按筆觸順序重播，所以「改參數後重新生成」時切口仍在。限制：擦除半徑以像素記錄，不隨筆刷粗細改變。';
  });

  await test('E8', '材質引擎', '多層混合順序與材質不互相污染', async (r) => {
    r.steps = ['A: ceramic 紅色、metal=1；B: ceramic 藍色、metal=0，兩層在中央重疊', '比較 B 單獨渲染與 [A,B] 合成時，B 覆蓋區的像素', '互換順序看重疊點顏色是否交換'];
    r.expected = 'B 在上方時重疊點像素 = B 單獨渲染；互換後重疊點變成 A 的顏色';
    const d = await P.evaluate(() => {
      const mk = (color, metal, y) => { const L = TB.makeLayer('ceramic', { color, metal, shadow: 0 }); const p = []; for (let i = 0; i <= 60; i++) p.push(100 + i * 6, y, i * 8); L.ops = [{ pts: p, seed: 3 }]; return L; };
      const A = mk('#ff0000', 1, 200), B = mk('#0000ff', 0, 200);
      const B2 = mk('#0000ff', 0, 200);
      const onlyB = H.renderToCanvas([B2], 600, 400).c, AB = H.renderToCanvas([A, B], 600, 400).c, BA = H.renderToCanvas([B, A], 600, 400).c;
      return { onlyB: H.pixel(onlyB, 300, 200), AB: H.pixel(AB, 300, 200), BA: H.pixel(BA, 300, 200) };
    });
    r.data = d;
    const same = d.onlyB.every((v, i) => Math.abs(v - d.AB[i]) <= 1);
    const swapped = d.BA[0] > d.BA[2];
    r.status = verdict(same && swapped);
    r.actual = `B 單獨 ${d.onlyB} / A下B上 ${d.AB} / B下A上 ${d.BA}`;
  });

  await test('E9', '匯出', '透明背景邊緣是否有暗邊 (premultiplied 錯誤)', async (r) => {
    r.steps = ['ceramic 白色筆觸渲染到透明 2D canvas', '取 0<alpha<255 的邊緣像素，比較其還原後顏色與內部顏色'];
    r.expected = '邊緣像素的 RGB (un-premultiplied) 接近筆觸本色，不應明顯偏黑';
    const d = await P.evaluate(() => {
      const L = TB.makeLayer('ceramic', { color: '#ffffff', shadow: 0 }); const p = []; for (let i = 0; i <= 60; i++) p.push(100 + i * 6, 200, i * 8); L.ops = [{ pts: p, seed: 3 }];
      const c = H.renderToCanvas([L], 600, 400).c; const px = c.getContext('2d').getImageData(0, 0, 600, 400).data;
      let en = 0, el = 0, inn = 0, il = 0, shadowEdge = 0;
      for (let i = 0; i < px.length; i += 4) { const a = px[i + 3], l = (px[i] + px[i + 1] + px[i + 2]) / 3; if (a === 255) { inn++; il += l; } else if (a > 20 && a < 235) { en++; el += l; } }
      return { edgeLum: +(el / en).toFixed(1), innerLum: +(il / inn).toFixed(1), edgeN: en };
    });
    r.data = d;
    r.status = verdict(d.edgeLum > d.innerLum * 0.7, d.edgeLum > d.innerLum * 0.4);
    r.actual = `邊緣平均亮度 ${d.edgeLum} (n=${d.edgeN}) / 內部 ${d.innerLum}`;
    r.notes = '材質本身邊緣會因法線傾斜而變暗，這項只抓「明顯黑邊」。';
  });

  await test('E10', '材質引擎', 'WebGL context lost 後能否恢復', async (r) => {
    r.steps = ['在實驗頁 renderer 上呼叫 WEBGL_lose_context.loseContext()', 'restoreContext()', '重新渲染並讀取像素'];
    r.expected = '恢復後畫面重新出現，不丟失作品';
    const d = await P.evaluate(async () => {
      window.__lab.loadTemplate('tactile');
      window.__lab.renderNow();
      const c = document.getElementById('glCanvas');
      const before = H.hashCanvas(c);
      const gl = c.getContext('webgl2'); const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return { skipped: true };
      let err = null;
      ext.loseContext(); await new Promise((r) => setTimeout(r, 100));
      ext.restoreContext(); await new Promise((r) => setTimeout(r, 300));
      try { window.__lab.renderNow(); } catch (e) { err = e.message; }
      const px = H.canvasPixels(c); let nz = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) nz++;
      return { before, after: H.hashCanvas(c), nonTransparent: nz, err, glError: gl.getError() };
    });
    r.data = d;
    r.status = d.skipped ? 'NOT TESTED' : verdict(d.nonTransparent > 1000 && !d.err);
    r.actual = d.skipped ? '無 WEBGL_lose_context' : `恢復後非透明像素 ${d.nonTransparent}，錯誤: ${d.err || 'none'}，gl.getError=${d.glError}`;
    r.impact = '真實裝置在切換分頁、GPU 重置、記憶體不足時會發生；目前程式碼沒有 webglcontextlost / restored 處理。';
  });
  await eng.ctx.close();

  /* ---------------- 介面層 (600×400 小畫布以加速 SwiftShader) ---------------- */
  await test('U1', '筆觸輸入', '實際指標事件：連續 / 快速 / 慢速 / 轉折 / 停筆', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    r.steps = ['ceramic：慢速波浪 (每點間隔 40ms)', '快速直線 (無延遲)', '急轉折 Z 字', '停筆：按住不動 400ms 後繼續', '比較即時畫面與強制重算後畫面雜湊'];
    r.expected = '4 筆全部記錄；停筆不產生錯誤；即時結果 = 重播結果';
    await draw(page, wave(0.1, 0.9, 0.25, 0.08, 20), { delay: 40 });
    await draw(page, [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]]);
    await draw(page, [[0.1, 0.7], [0.9, 0.7], [0.1, 0.85], [0.9, 0.85]], { delay: 10 });
    const b = await (await page.$('#doc')).boundingBox();
    await page.mouse.move(b.x + 0.2 * b.width, b.y + 0.95 * b.height); await page.mouse.down();
    await page.mouse.move(b.x + 0.4 * b.width, b.y + 0.95 * b.height); await page.waitForTimeout(400);
    await page.mouse.move(b.x + 0.8 * b.width, b.y + 0.95 * b.height); await page.mouse.up();
    await page.waitForTimeout(100);
    const live = await glHash(page);
    const replay = await page.evaluate(() => { window.__lab.st.layers.forEach((l) => (l.rev = -12345)); window.__lab.renderNow(); return H.hashCanvas(document.getElementById('glCanvas')); });
    const s = await stateOf(page);
    await page.screenshot({ path: path.join(OUT, 'U1.png') });
    r.data = { ops: s.layers.map((l) => l.ops.map((o) => o.n)), live, replay };
    r.evidence = ['tests/out/U1.png'];
    const ops = s.layers.reduce((a, l) => a + l.ops.length, 0);
    r.status = verdict(ops === 4 && live === replay && !page.__errors.length);
    r.actual = `筆數 ${ops}；每筆點數 ${JSON.stringify(r.data.ops)}；即時=重播: ${live === replay}；頁面錯誤 ${page.__errors.length}`;
    await ctx.close();
  });

  await test('U2', '筆刷切換', '介面上逐一切換 15 支筆刷並下筆', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    r.steps = ['點左側筆刷 → 在畫布畫一筆 (15 次)'];
    r.expected = '15 個圖層，各 1 筆，筆刷 ID 對應';
    const ids = await page.evaluate(() => TB.BRUSH_ORDER);
    for (let i = 0; i < ids.length; i++) {
      await page.click(`#brushList button[data-id=${ids[i]}]`);
      const y = 0.08 + (i % 8) * 0.11, x0 = i < 8 ? 0.05 : 0.55;
      await draw(page, wave(x0, x0 + 0.4, y, 0.03, 8));
    }
    const s = await stateOf(page);
    await page.screenshot({ path: path.join(OUT, 'U2.png'), timeout: 120000 }).catch(() => {});
    r.evidence = ['tests/out/U2.png'];
    const okIds = s.layers.map((l) => l.brush).join() === ids.join() && s.layers.every((l) => l.ops.length === 1);
    r.status = verdict(okIds && !page.__errors.length);
    r.actual = `${s.layers.length} 層：${s.layers.map((l) => l.brush + '×' + l.ops.length).join(' ')}；錯誤 ${page.__errors.length}`;
    await ctx.close();
  });

  await test('U3', '圖層', '新增 / 刪除 / 隱藏 / 排序 / 複製 / 重新編輯', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    const log = [];
    await draw(page, wave(0.1, 0.9, 0.3, 0.05, 8));
    await page.click('#brushList button[data-id=beads]'); await draw(page, wave(0.1, 0.9, 0.6, 0.05, 8));
    await page.click('.tabs button[data-tab=layers]');
    let s = await stateOf(page); log.push('初始 ' + s.layers.map((l) => l.brush).join('>'));
    await page.click('#layerList li:nth-child(1) [data-a=down]'); s = await stateOf(page); log.push('下移後 ' + s.layers.map((l) => l.brush).join('>'));
    const orderOk = s.layers[1].brush === 'ceramic';
    await page.click('#layerList li:nth-child(1) .vis'); s = await stateOf(page); const hideOk = s.layers[1].visible === false;
    log.push('隱藏 ' + s.layers.map((l) => l.visible).join());
    await page.click('#layerList li:nth-child(2) [data-a=dup]'); s = await stateOf(page);
    const ids = s.layers.map((l) => l.id); const dupOk = s.layers.length === 3 && new Set(ids).size === 3;
    log.push('複製後 ' + s.layers.map((l) => l.brush + '/' + l.ops.length).join(' '));
    // 選回 ceramic 層 (先取消隱藏) 並改 size
    await page.click('#layerList li:nth-child(1) .vis');
    await page.click('#layerList li:nth-child(1) .nm');
    await page.click('.tabs button[data-tab=brush]');
    const before = await glHash(page);
    const num = await page.$('#pane-brush .ctl input[type=number]'); await num.fill('30'); await num.press('Enter'); await page.waitForTimeout(200);
    const after = await glHash(page);
    s = await stateOf(page);
    const reeditOk = before !== after && s.layers.find((l) => l.id === s.active).params.size === 30;
    await page.click('.tabs button[data-tab=layers]');
    await page.click('#layerList li:nth-child(1) [data-a=del]'); s = await stateOf(page); const delOk = s.layers.length === 2;
    await page.click('#addLayer'); s = await stateOf(page); const addOk = s.layers.length === 3;
    r.steps = ['畫 ceramic、beads 兩層', '下移、隱藏、複製、選取重新編輯 size、刪除、新增'];
    r.expected = '每項操作狀態正確、ID 不衝突、重新編輯會重算形體';
    r.data = log;
    const all = { orderOk, hideOk, dupOk, reeditOk, delOk, addOk };
    r.status = verdict(Object.values(all).every(Boolean), Object.values(all).some(Boolean));
    r.actual = JSON.stringify(all) + ' | ' + log.join(' | ');
    await ctx.close();
  });

  await test('U4', '復原', 'B3 連續操作：繪製→形體→材質→複製→隱藏→復原×5→重做×5→儲存→重新載入', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    const states = [];
    const snapNow = async (label) => states.push({ label, s: stable(await stateOf(page)), h: await glHash(page) });
    await snapNow('0 空白');
    await draw(page, wave(0.1, 0.9, 0.4, 0.08, 10)); await snapNow('1 繪製');
    const num = await page.$('#pane-brush .ctl input[type=number]'); await num.fill('28'); await num.press('Enter'); await page.waitForTimeout(150); await snapNow('2 形體 size=28');
    await page.click('#pane-brush .swatches button:nth-child(8)'); await snapNow('3 材質 color');
    await page.click('.tabs button[data-tab=layers]');
    await page.click('#layerList li:nth-child(1) [data-a=dup]'); await snapNow('4 複製圖層');
    await page.click('#layerList li:nth-child(1) .vis'); await snapNow('5 隱藏');
    const undoTrail = [];
    for (let i = 0; i < 5; i++) { await page.click('#undoBtn'); undoTrail.push(stable(await stateOf(page))); }
    const undoMatches = undoTrail.map((s, i) => s === states[4 - i].s);
    for (let i = 0; i < 5; i++) await page.click('#redoBtn');
    const afterRedo = stable(await stateOf(page)), afterRedoHash = await glHash(page);
    await page.waitForTimeout(700); // autosave debounce
    await page.reload({ waitUntil: 'load' }); await page.addScriptTag({ path: path.join(__dirname, 'harness.js') }); await page.waitForTimeout(300);
    const reloaded = stable(await stateOf(page)), reloadedHash = await glHash(page);
    const strip = (j) => { const o = JSON.parse(j); delete o.active; return JSON.stringify(o); };
    r.steps = states.map((x) => x.label).concat(['復原 ×5', '重做 ×5', '等待自動儲存', '重新整理']);
    r.expected = '每次復原依序回到前一狀態；重做回到最終狀態；重新整理後資料與畫面一致；ID 不衝突';
    const diffKeys = (a, b) => { const A = JSON.parse(a), B = JSON.parse(b), out = []; const walk = (x, y, p) => { if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p + ': ' + JSON.stringify(x) + ' → ' + JSON.stringify(y)); return; } for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); }; walk(A, B, ''); return out.slice(0, 8); };
    r.diff = diffKeys(strip(afterRedo), strip(reloaded));
    r.data = { undoMatches, redoOk: afterRedo === states[5].s, redoPixelsOk: afterRedoHash === states[5].h, reloadDataOk: strip(reloaded) === strip(afterRedo), reloadPixelsOk: reloadedHash === afterRedoHash };
    r.notes = '「移動筆觸」目前沒有對應功能 (單筆觸編輯不存在)，此步驟無法執行 → 見 B2。';
    const ok = undoMatches.every(Boolean) && r.data.redoOk && r.data.redoPixelsOk && r.data.reloadDataOk && r.data.reloadPixelsOk;
    r.status = verdict(ok, undoMatches.some(Boolean));
    r.actual = JSON.stringify(r.data) + (r.diff.length ? ' 差異: ' + r.diff.join(' ; ') : '');
    await ctx.close();
  });

  await test('U5', '復原', '改畫布尺寸 / 載入樣板 / 放入圖片後按復原', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    await draw(page, wave(0.1, 0.9, 0.5, 0.1, 10));
    const s0 = await stateOf(page);
    await page.click('.tabs button[data-tab=doc]');
    await page.selectOption('#sizeSel', '1200x1200'); await page.waitForTimeout(200);
    const s1 = await stateOf(page);
    await page.click('#undoBtn'); await page.waitForTimeout(200);
    const s2 = await stateOf(page);
    // 筆觸座標屬於哪個尺寸？
    const resizeOk = s2.w === s0.w && s2.h === s0.h && s2.layers[0].ops[0].x0 === s0.layers[0].ops[0].x0;
    // 樣板
    await page.selectOption('#tplSel', 'quiet'); await page.waitForTimeout(300);
    await page.click('#undoBtn'); await page.waitForTimeout(200);
    const s3 = await stateOf(page);
    const tplOk = s3.w === s2.w && s3.h === s2.h && s3.bg === s2.bg && s3.layers.length === s2.layers.length;
    // 光源
    const light0 = (await stateOf(page)).light.az;
    await page.click('.tabs button[data-tab=brush]');
    const az = page.locator('#pane-brush .ctl', { hasText: '方向 Azimuth' }).locator('input[type=number]');
    await az.fill('90'); await az.press('Enter');
    await page.click('#undoBtn'); await page.waitForTimeout(100);
    const lightOk = (await stateOf(page)).light.az === light0;
    // [ ] 鍵改大小
    await page.click('#brushList button[data-id=ceramic]');
    const sz0 = (await stateOf(page)).layers.find((l) => l.brush === 'ceramic');
    await page.mouse.move(5, 5); await page.keyboard.press(']'); await page.waitForTimeout(100);
    await page.click('#undoBtn'); await page.waitForTimeout(100);
    const sz1 = (await stateOf(page)).layers.find((l) => l.brush === 'ceramic');
    const keyOk = sz0 && sz1 && sz0.params.size === sz1.params.size;
    r.steps = ['畫一筆 → 改尺寸 1200×1200 → 復原', '載入樣板 → 復原', '改光源 → 復原', '按 ] 放大筆刷 → 復原'];
    r.expected = '每次復原都回到操作前 (尺寸 + 筆觸座標 + 背景 + 光源 + 參數一致)';
    r.data = { resize: { before: [s0.w, s0.h, s0.layers[0].ops[0].x0], resized: [s1.w, s1.h, s1.layers[0].ops[0].x0], undone: [s2.w, s2.h, s2.layers[0].ops[0].x0] }, tplUndo: [s3.w, s3.h, s3.bg, s3.layers.length], light: lightOk, key: [sz0 && sz0.params.size, sz1 && sz1.params.size] };
    const all = { resizeOk, tplOk, lightOk, keyOk };
    r.status = verdict(Object.values(all).every(Boolean), Object.values(all).some(Boolean));
    r.actual = JSON.stringify(all) + ' ' + JSON.stringify(r.data);
    r.impact = '復原後筆觸座標屬於舊尺寸、畫布卻是新尺寸 → 作品錯位；且不可再復原回正確狀態。';
    await ctx.close();
  });

  await test('U6', '鏡像 / 橡皮擦', '介面：鏡像旗標寫入筆觸；橡皮擦與之後的參數重新編輯', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    await page.click('#mxBtn'); await page.click('#myBtn');
    await draw(page, wave(0.05, 0.45, 0.25, 0.08, 10));
    await page.click('#mxBtn'); await page.click('#myBtn');
    const h0 = await glHash(page);
    await page.click('[data-tool=erase]');
    await draw(page, [[0.25, 0.05], [0.25, 0.45]]);
    const h1 = await glHash(page);
    await page.click('[data-tool=draw]');
    const num = await page.$('#pane-brush .ctl input[type=number]'); await num.fill('26'); await num.press('Enter'); await page.waitForTimeout(150);
    const s = await stateOf(page);
    await page.screenshot({ path: path.join(OUT, 'U6.png') });
    const op = s.layers[0].ops;
    r.steps = ['開 mx+my 畫一筆', '橡皮擦穿過', '回筆刷改 size'];
    r.expected = '第一筆 mx=my=true；擦除 op 存在並改變畫面；改 size 後兩個 op 都保留';
    r.evidence = ['tests/out/U6.png'];
    const ok = op.length === 2 && op[0].mx && op[0].my && op[1].erase && h0 !== h1 && s.layers[0].params.size === 26;
    r.status = verdict(ok);
    r.actual = JSON.stringify(op) + ` 畫面變化:${h0 !== h1}`;
    await ctx.close();
  });

  await test('U7', '文字', '新增 / 編輯 / 拖曳 / 旋轉 / 字距 / 上下關係', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    await draw(page, wave(0.1, 0.9, 0.2, 0.05, 8));
    await page.click('.tabs button[data-tab=text]');
    await page.click('#addText');
    await page.fill('#tTxt', '測試 TEXT\n第二行');
    const rot = page.locator('#textProps .ctl', { hasText: '旋轉' }).locator('input[type=number]'); await rot.fill('30'); await rot.press('Enter');
    const tr = page.locator('#textProps .ctl', { hasText: '字距' }).locator('input[type=number]'); await tr.fill('0.1'); await tr.press('Enter');
    const el = await page.$('#texts .tb-text'); const bb = await el.boundingBox();
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 100, cy + 50, { steps: 4 }); await page.mouse.up();
    await page.check('#textUnder');
    const s = await stateOf(page);
    const z = await page.evaluate(() => [document.getElementById('texts').style.zIndex, document.getElementById('glCanvas').style.zIndex]);
    await page.click('[data-tool=draw]');
    const z2 = await page.evaluate(() => document.getElementById('texts').style.zIndex);
    await page.click('#undoBtn'); const su = await stateOf(page);
    const t = s.texts[0];
    r.steps = ['新增文字、改內容、旋轉 30、字距 0.1、拖曳、勾選文字在下方、切回筆刷、復原'];
    r.expected = '各屬性寫入；拖曳改變 x/y；文字在下方時 z-index 低於筆觸；復原可撤回最後操作';
    r.data = { t, z, z2, undoTextUnder: su.textUnder };
    const ok = t.t === '測試 TEXT\n第二行' && t.r === 30 && t.ls === 0.1 && t.x > 0.09 && z2 === '0' && s.textUnder;
    r.status = verdict(ok && su.textUnder === false, ok);
    r.actual = `text=${JSON.stringify(t)} 下方模式 zIndex=${z2}；復原後 textUnder=${su.textUnder}`;
    r.notes = 'contenteditable 直接雙擊編輯未自動化 (headless 選取行為不可靠)，以側欄 textarea 驗證。';
    await ctx.close();
  });

  await test('U8', '樣板', '9 組樣板載入實驗頁：筆觸為向量資料、可編輯', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page);
    const rows = await page.evaluate(async () => {
      const out = [];
      for (const T of TB.TEMPLATES) {
        window.__lab.loadTemplate(T.id);
        window.__lab.renderNow();
        const s = window.__lab.st;
        out.push({ id: T.id, specLayers: T.layers.length, layers: s.layers.length, ops: s.layers.reduce((a, l) => a + l.ops.length, 0),
          ptsOk: s.layers.every((l) => l.ops.every((o) => Array.isArray(o.pts) && o.pts.length >= 3)), texts: s.texts.length, specTexts: T.texts.length, size: [s.w, s.h] });
      }
      return out;
    });
    await page.screenshot({ path: path.join(OUT, 'U8-last-template.png') });
    r.steps = ['依序 loadTemplate(9 組)', '檢查圖層數、每個 op 有點資料、文字數'];
    r.expected = '9/9 與樣板規格一致；樣板官方資料 (TB.TEMPLATES) 未被修改';
    const unchanged = await page.evaluate(() => TB.TEMPLATES.every((T) => T.layers.every((ls) => !('ops' in ls))));
    const bad = rows.filter((x) => x.layers !== x.specLayers || !x.ptsOk || x.texts !== x.specTexts);
    r.data = rows; r.evidence = ['tests/out/U8-last-template.png'];
    r.status = verdict(!bad.length && unchanged && !page.__errors.length);
    r.actual = rows.map((x) => `${x.id}:${x.layers}層/${x.ops}筆/${x.texts}字`).join(' ') + ` 官方資料未變:${unchanged}`;
    r.notes = '「另存為作者自己的樣板」功能不存在 → E3 待開發。';
    await ctx.close();
  });

  await test('U9', '樣板', '作品頁 9 組樣板 + 15 支樣本全部算繪、文字修改可保存與還原', async (r) => {
    const { ctx, page } = await newPage();
    await page.goto(BASEURL() + '/index.html', { waitUntil: 'load' });
    const Hh = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < Hh; y += 700) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(250); }
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 240000 });
    const frames = await page.$$eval('.frame', (f) => f.length);
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = page.locator('#works .tb-text').first();
    let clickable = true;
    try { await first.click({ timeout: 5000 }); } catch (e) { clickable = false; await first.click({ force: true }); }
    await page.keyboard.press('End'); await page.keyboard.type('X');
    await page.waitForTimeout(100);
    const savedTxt = await page.evaluate(() => JSON.parse(localStorage.getItem('tactile-works-texts') || '{}').tactile?.[0]?.t);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
    const after = await page.locator('#works .tb-text').first().textContent();
    await page.locator('#works .work').first().locator('[data-a=reset]').click();
    const reset = await page.locator('#works .tb-text').first().textContent();
    r.steps = ['捲動觸發延遲算繪，等全部完成', '修改第一組第一段文字 → 重新整理 → 還原文字'];
    r.expected = '全部 frame 完成且無錯誤；修改在重新整理後仍在；還原回原文';
    r.data = { frames, clickable, savedTxt, after, reset, errors: page.__errors };
    const ok = clickable && !page.__errors.length && savedTxt && savedTxt.endsWith('X') && after.endsWith('X') && reset === 'TACTILE';
    r.status = verdict(ok);
    r.actual = `${frames} 個 frame；文字可直接點擊: ${clickable}${clickable ? '' : ' (被筆觸 canvas 蓋住，需 force)'}；保存 "${savedTxt}" → 重新整理 "${after}" → 還原 "${reset}"；錯誤 ${page.__errors.length}`;
    await ctx.close();
  });

  await test('U10', '儲存', 'JSON 匯出 → 新瀏覽器 → 匯入，資料與畫面一致', async (r) => {
    const a = await newPage(); await openLab(a.page);
    await a.page.evaluate(() => window.__lab.loadTemplate('beads'));
    await a.page.click('.tabs button[data-tab=doc]');
    const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#saveJson')]);
    const file = path.join(OUT, 'U10-project.json'); await dl.saveAs(file);
    const s0 = stable(await stateOf(a.page)), h0 = await glHash(a.page);
    await a.ctx.close();
    const b = await newPage(); await openLab(b.page);
    await b.page.click('.tabs button[data-tab=doc]');
    await b.page.setInputFiles('#loadJson', file); await b.page.waitForTimeout(800);
    const s1 = stable(await stateOf(b.page)), h1 = await glHash(b.page);
    const strip = (j) => { const o = JSON.parse(j); delete o.active; return o; };
    const json = JSON.parse(fs.readFileSync(file));
    r.steps = ['載入 beads 樣板 → 存成檔案', '全新瀏覽器 context 開啟檔案'];
    r.expected = '資料一致、像素一致；檔案標示格式版本';
    r.data = { bytes: fs.statSync(file).size, version: json.v, dataEqual: stable(strip(s0)) === stable(strip(s1)), pixelEqual: h0 === h1 };
    r.evidence = ['tests/out/U10-project.json'];
    r.status = verdict(r.data.dataEqual && r.data.pixelEqual);
    r.actual = JSON.stringify(r.data);
    r.notes = '字體由 Google Fonts 載入，檔案不含字體；離線或字體載入失敗時沒有提示 (F2)。';
    await b.ctx.close();
  });

  await test('U11', '儲存', '自動儲存遇到容量上限時是否提示 (大圖)', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    const w = 2600, h = 2600, buf = Buffer.alloc(w * h * 4);
    require('crypto').randomFillSync(buf); for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    const f = path.join(OUT, 'U11-noise.png'); fs.writeFileSync(f, png(w, h, buf));
    await page.click('.tabs button[data-tab=doc]');
    await page.setInputFiles('#imgIn', f); await page.waitForTimeout(1500);
    await draw(page, wave(0.1, 0.9, 0.5, 0.1, 6));
    await page.waitForTimeout(800);
    const toastSeen = await page.evaluate(() => document.getElementById('toast').textContent);
    const stored = await page.evaluate(() => { const j = JSON.parse(localStorage.getItem('tactile-lab-v1')); return { image: !!j.image, layers: j.layers.length }; });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(500);
    const after = await stateOf(page);
    r.steps = [`上傳 ${(fs.statSync(f).size / 1048576).toFixed(1)}MB 雜訊 PNG`, '畫一筆、等待自動儲存', '重新整理'];
    r.expected = '若圖片存不下，應明確提示作者 (並保留圖片以外的資料)';
    r.data = { fileMB: +(fs.statSync(f).size / 1048576).toFixed(1), stored, toastSeen, afterReloadImage: after.image, afterLayers: after.layers.length };
    const silentLoss = !stored.image && !/儲存|容量|空間/.test(toastSeen);
    r.status = stored.image ? 'PASS' : silentLoss ? 'FAIL' : 'PARTIAL';
    r.actual = `localStorage 內含圖片: ${stored.image}；圖層 ${stored.layers}；提示文字: "${toastSeen}"；重新整理後圖片: ${after.image}`;
    r.impact = '作者重新整理後底圖消失，畫面上沒有任何警告。';
    await ctx.close();
  });

  await test('U12', '圖片', '上傳底圖 → 比例 → 再改畫布尺寸', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    const w = 400, h = 800, buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const c = ((x >> 5) + (y >> 5)) % 2 ? 230 : 40; buf[i] = c; buf[i + 1] = 80; buf[i + 2] = 255 - c; buf[i + 3] = 255; }
    const f = path.join(OUT, 'U12-checker.png'); fs.writeFileSync(f, png(w, h, buf));
    await page.click('.tabs button[data-tab=doc]');
    await page.setInputFiles('#imgIn', f); await page.waitForTimeout(800);
    const s1 = await stateOf(page);
    await draw(page, wave(0.1, 0.9, 0.5, 0.1, 6));
    await page.selectOption('#sizeSel', '1400x900'); await page.waitForTimeout(400);
    const s2 = await stateOf(page);
    await page.screenshot({ path: path.join(OUT, 'U12.png') });
    // 量 bg canvas 上一個格子的長寬 (若被拉伸則不是正方形)
    const cell = await page.evaluate(() => {
      const c = document.getElementById('bgCanvas'), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
      const row = Math.floor(c.height / 2), col = Math.floor(c.width / 2);
      const run = (get, n) => { let changes = [], prev = null; for (let i = 0; i < n; i++) { const v = get(i) > 128; if (prev !== null && v !== prev) changes.push(i); prev = v; } return changes.length > 2 ? changes[2] - changes[1] : null; };
      return { cw: run((i) => d[(row * c.width + i) * 4], c.width), ch: run((i) => d[(i * c.width + col) * 4], c.height) };
    });
    const aspectOk = Math.abs(s1.w / s1.h - 0.5) < 0.01;
    const stretch = cell.cw && cell.ch ? +(cell.cw / cell.ch).toFixed(2) : null;
    r.steps = ['上傳 400×800 棋盤圖', '畫一筆', '改畫布為 1400×900', '量底圖棋盤格的寬高比'];
    r.expected = '上傳後畫布 = 圖片比例；改尺寸後圖片保持比例 (fit/fill) 不變形';
    r.data = { afterUpload: [s1.w, s1.h], afterResize: [s2.w, s2.h], checkerCell: cell, stretch };
    r.evidence = ['tests/out/U12.png'];
    r.status = verdict(aspectOk && stretch && Math.abs(stretch - 1) < 0.05, aspectOk);
    r.actual = `上傳後 ${s1.w}×${s1.h}；改尺寸後棋盤格寬高比 ${stretch} (1 = 不變形)`;
    r.notes = '目前沒有底圖縮放 / 位移 / 裁切控制。';
    await ctx.close();
  });

  await test('U13', '匯出', '透明 PNG / 含背景 PNG / 文字混合', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    await draw(page, wave(0.1, 0.9, 0.5, 0.1, 8));
    await page.click('.tabs button[data-tab=text]'); await page.click('#addText'); await page.fill('#tTxt', 'EXPORT');
    await page.click('.tabs button[data-tab=doc]');
    const grab = async () => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportPng')]); const p = path.join(OUT, 'U13-' + Date.now() + '.png'); await dl.saveAs(p); return p; };
    const withBg = await grab();
    await page.uncheck('#exBg'); const transparent = await grab();
    await page.uncheck('#exText'); const noText = await grab();
    const probe = async (file) => page.evaluate(async (b64) => {
      const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, im.width, im.height).data; let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      return { w: im.width, h: im.height, corner: Array.from(x.getImageData(2, 2, 1, 1).data), opaque };
    }, fs.readFileSync(file).toString('base64'));
    const a = await probe(withBg), b = await probe(transparent), c = await probe(noText);
    r.steps = ['畫一筆 + 一段文字', '匯出：含背景+文字 / 透明+文字 / 透明無文字'];
    r.expected = '含背景角落 alpha=255；透明角落 alpha=0；有文字比無文字有更多非透明像素；尺寸 = 文件尺寸';
    r.data = { withBg: a, transparent: b, noText: c };
    r.evidence = [withBg, transparent, noText].map((p) => path.relative(ROOT, p));
    const ok = a.corner[3] === 255 && b.corner[3] === 0 && b.opaque > c.opaque && a.w === 600;
    r.status = verdict(ok);
    r.actual = `含背景角落 ${a.corner}；透明角落 ${b.corner}；非透明像素 有字 ${b.opaque} / 無字 ${c.opaque}；尺寸 ${a.w}×${a.h}`;
    r.notes = '只有 1× (文件解析度)；沒有 2×/4×/指定尺寸 (F1)。';
    await ctx.close();
  });

  await test('U14', '效能', '多圖層與連續操作：GPU 資源釋放、JS 記憶體', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page, true);
    const d = await page.evaluate(async () => {
      const lab = window.__lab, st = lab.st;
      const gc = () => { if (window.gc) window.gc(); };
      lab.renderNow(); gc();
      const base = { tex: window.__gpu.tex, heap: performance.memory ? performance.memory.usedJSHeapSize : null };
      // 30 層，每層一筆
      for (let i = 0; i < 30; i++) {
        const L = TB.makeLayer(TB.BRUSH_ORDER[i % 15]); L.rev = 100000 + i;
        const p = []; for (let k = 0; k <= 80; k++) p.push(20 + k * 7, 20 + i * 12, k * 8); L.ops = [{ pts: p, seed: i + 1 }];
        st.layers.push(L);
      }
      const t0 = performance.now(); lab.renderNow(); const first = performance.now() - t0;
      const t1 = performance.now(); lab.renderNow(); const cached = performance.now() - t1;
      gc();
      const loaded = { tex: window.__gpu.tex, heap: performance.memory ? performance.memory.usedJSHeapSize : null };
      // 透過介面刪除全部圖層 (走 refreshLayers 的刪除路徑)
      return { base, loaded, first, cached };
    });
    await page.click('#brushList button[data-id=ceramic]'); // 觸發 refreshAll 讓圖層列表更新
    await page.click('.tabs button[data-tab=layers]');
    for (let i = 0; i < 30; i++) await page.click('#layerList li:nth-child(1) [data-a=del]', { timeout: 120000 });
    const after = await page.evaluate(() => { window.__lab.renderNow(); if (window.gc) window.gc(); return { tex: window.__gpu.tex, heap: performance.memory ? performance.memory.usedJSHeapSize : null, layers: window.__lab.st.layers.length }; });
    // 復原 30 次是否把圖層帶回
    r.steps = ['加入 30 層 (每層一筆) 並渲染兩次', '透過介面逐一刪除 30 層', '比較紋理數量與 JS heap'];
    r.expected = '刪除後 GPU 紋理數回到基準；heap 不持續成長';
    const MB = (x) => (x == null ? 'n/a' : (x / 1048576).toFixed(1) + 'MB');
    r.data = Object.assign(d, { after });
    r.status = verdict(after.tex <= d.base.tex + 0, after.tex <= d.base.tex + 2);
    r.actual = `紋理 基準 ${d.base.tex} → 30 層 ${d.loaded.tex} → 刪除後 ${after.tex}；heap ${MB(d.base.heap)} → ${MB(d.loaded.heap)} → ${MB(after.heap)}；30 層首次渲染 ${Math.round(d.first)}ms、快取後 ${Math.round(d.cached)}ms (SwiftShader)`;
    r.notes = '刪除後 heap 仍高屬預期：80 步的復原歷史保留了被刪圖層的資料 (結構共享，非洩漏)；但高度場 Float32Array 不在歷史內，應被回收。';
    await ctx.close();
  });

  await test('U15', '材質引擎', '高 DPI (devicePixelRatio=2) 下畫布清晰度', async (r) => {
    const { ctx, page } = await newPage({ dpr: 2 }); await openLab(page);
    const d = await page.evaluate(() => { const c = document.getElementById('glCanvas'), b = c.getBoundingClientRect(); return { backing: [c.width, c.height], css: [Math.round(b.width), Math.round(b.height)], dpr: devicePixelRatio }; });
    const ratio = d.backing[0] / (d.css[0] * d.dpr);
    r.steps = ['DPR=2、1440×900 視窗開啟 1400×900 文件', '比較 canvas 像素與螢幕裝置像素'];
    r.expected = '顯示時 canvas 像素 ≥ 裝置像素 (不放大)';
    r.data = Object.assign(d, { ratio: +ratio.toFixed(2) });
    r.status = verdict(ratio >= 0.98, ratio >= 0.6);
    r.actual = `canvas ${d.backing.join('×')}，顯示 ${d.css.join('×')} CSS px × DPR ${d.dpr} → 每裝置像素 ${ratio.toFixed(2)} 個 canvas 像素`;
    r.notes = '畫布形體比例不受顯示縮放影響 (文件座標固定)；低於 1 代表在 Retina 螢幕上被放大而略糊。匯出不受影響。';
    await ctx.close();
  });

  await test('U16', '筆觸輸入', '極長筆觸的儲存大小與重算時間', async (r) => {
    const { ctx, page } = await newPage(); await openLab(page);
    const d = await page.evaluate(() => {
      const L = TB.makeLayer('paste'); const p = [];
      for (let i = 0; i < 20000; i++) { const a = i / 400; p.push(+(700 + Math.cos(a) * (100 + i * 0.02)).toFixed(2), +(450 + Math.sin(a * 1.3) * 300).toFixed(2), i * 8); }
      L.ops = [{ pts: p, seed: 1 }];
      const r = new TB.Raster(1400, 900); const t0 = performance.now(); TB.rasterLayer(L, r);
      return { points: 20000, seconds: 160, jsonKB: Math.round(JSON.stringify(L.ops).length / 1024), rasterMs: Math.round(performance.now() - t0) };
    });
    r.steps = ['合成 20000 點 (≈160 秒連續繪製) 的 paste 筆觸', '量 JSON 大小與完整重算時間'];
    r.expected = '建立基準：重算 < 1s、可放入 localStorage (≈5MB)';
    r.data = d;
    r.status = verdict(d.rasterMs < 1000 && d.jsonKB < 2048, true);
    r.actual = `JSON ${d.jsonKB}KB、重算 ${d.rasterMs}ms`;
    await ctx.close();
  });

  await test('X1', '跨環境', 'Firefox / Safari', async (r) => {
    r.status = 'NOT TESTED';
    r.actual = '此環境只安裝 Chromium (/opt/pw-browsers)。Firefox、Safari (WebKit) 沒有測試證據。';
    r.notes = 'WebGL2 + EXT_color_buffer_float + RG32F 紋理：Safari 15+ 理論上支援，但未驗證。contentEditable="plaintext-only" 在 Firefox 不支援，程式碼有 fallback 但未驗證。';
  });

  fs.writeFileSync(path.join(OUT, 'audit-results.json'), JSON.stringify({ env: ENV, results }, null, 1));
  const tally = results.reduce((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {});
  console.log('\nSUMMARY', tally);
  await browser.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
