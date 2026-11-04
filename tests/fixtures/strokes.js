/* 固定測試筆觸資料集 (Phase 2 baseline)
 * 完全決定性：固定座標、時間 (每 8ms 一點，模擬 125Hz 指標事件)、種子與畫布尺寸。
 * 畫布 1200×800，分成 5×2 格，每格 240×400，一格一種筆觸型態。
 * 每一筆 = { pts:[x,y,t,...], seed }，與專案 JSON 中 op 的格式相同。
 */
(function (root) {
  const W = 1200, H = 800, CW = 240, CH = 400, DT = 8;

  // 以等速 (px/ms) 沿著參數曲線取樣
  function trace(fn, speed, cell, seed, opts) {
    opts = opts || {};
    const ox = (cell % 5) * CW, oy = Math.floor(cell / 5) * CH;
    const pts = [];
    // 先密集取樣曲線，計算弧長
    const N = 4000, raw = [];
    for (let i = 0; i <= N; i++) raw.push(fn(i / N));
    const acc = [0];
    for (let i = 1; i <= N; i++) acc.push(acc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
    const L = acc[N];
    let t = 0, s = 0, j = 0;
    while (s <= L) {
      while (j < N && acc[j + 1] < s) j++;
      const f = j < N ? (s - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]) : 0;
      const a = raw[j], b = raw[Math.min(N, j + 1)];
      pts.push(+(ox + a[0] + (b[0] - a[0]) * f).toFixed(2), +(oy + a[1] + (b[1] - a[1]) * f).toFixed(2), t);
      const v = typeof speed === 'function' ? speed(s / L) : speed;
      s += v * DT; t += DT;
    }
    return { pts, seed };
  }
  const lerp = (a, b, u) => a + (b - a) * u;

  const strokes = [
    // 0 水平直線 (中速)
    { id: 'horizontal', label: '水平直線', ops: [trace((u) => [lerp(30, 210, u), 200], 0.8, 0, 101)] },
    // 1 垂直直線
    { id: 'vertical', label: '垂直直線', ops: [trace((u) => [120, lerp(40, 360, u)], 0.8, 1, 102)] },
    // 2 45 度斜線
    { id: 'diagonal', label: '45° 斜線', ops: [trace((u) => [lerp(30, 210, u), lerp(290, 110, u)], 0.8, 2, 103)] },
    // 3 S 曲線 (變速：中段快)
    { id: 's-curve', label: 'S 曲線', ops: [trace((u) => [120 + 70 * Math.sin(u * Math.PI * 2), lerp(40, 360, u)], (u) => 0.3 + 1.6 * Math.sin(u * Math.PI), 3, 104)] },
    // 4 螺旋 (由內而外)
    { id: 'spiral', label: '螺旋', ops: [trace((u) => { const a = u * Math.PI * 6, r = 8 + u * 90; return [120 + Math.cos(a) * r, 200 + Math.sin(a) * r]; }, 0.7, 4, 105)] },
    // 5 快速折返 (鋸齒, 2.6 px/ms)
    { id: 'fast-zigzag', label: '快速折返', ops: [trace((u) => { const k = u * 6, f = k - Math.floor(k), tri = f < 0.5 ? f * 2 : 2 - f * 2; return [lerp(30, 210, tri), lerp(40, 360, u)]; }, 2.6, 5, 106)] },
    // 6 慢速重疊 (0.12 px/ms，自我重疊的圈)
    { id: 'slow-overlap', label: '慢速重疊', ops: [trace((u) => { const a = u * Math.PI * 4; return [120 + Math.cos(a) * 60 + (u - 0.5) * 40, 200 + Math.sin(a) * 60]; }, 0.12, 6, 107)] },
    // 7 密集交叉 (8 筆短線互相交叉)
    { id: 'dense-cross', label: '密集交叉', ops: Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI;
      return trace((u) => [120 + Math.cos(a) * lerp(-90, 90, u), 200 + Math.sin(a) * lerp(-90, 90, u)], 1.0, 7, 200 + k);
    }) },
    // 8 極短筆觸 (點按、2~3 點、6px)
    { id: 'tiny', label: '極短筆觸', ops: [
      { pts: [(8 % 5) * CW + 80, Math.floor(8 / 5) * CH + 140, 0], seed: 301 },
      trace((u) => [lerp(120, 123, u), 200], 0.4, 8, 302),
      trace((u) => [lerp(160, 166, u), lerp(260, 266, u)], 0.8, 8, 303)
    ] },
    // 9 長時間連續 (約 2600 點、20 秒、變速)
    { id: 'long', label: '長時間連續', ops: [trace((u) => {
      const a = u * Math.PI * 14;
      return [120 + Math.sin(a * 1.3) * 90 * Math.cos(u * 3), 200 + Math.cos(a * 0.7) * 150 * (0.4 + 0.6 * u)];
    }, (u) => 0.06 + 0.6 * (0.5 + 0.5 * Math.sin(u * 40)), 9, 109)] }
  ];

  const api = { W, H, CW, CH, DT, strokes, allOps: () => strokes.reduce((a, s) => a.concat(s.ops), []) };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FIX = api;
})(typeof window !== 'undefined' ? window : globalThis);
