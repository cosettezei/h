/* 路徑產生器 + 作品樣板資料 + 文字排版 (HTML 疊層 / Canvas 匯出 共用) */
(function () {
  const TB = window.TB;

  /* ---------------- 路徑 ---------------- */
  TB.paths = {
    // 類書寫體的連續圈線 (prolate cycloid + 噪聲)，迴圈頂端放慢
    script(w, h, o) {
      const rnd = TB.rng(o.seed || 1), nz = TB.noise1(rnd);
      const ax = o.a[0] * w, ay = o.a[1] * h, bx = o.b[0] * w, by = o.b[1] * h;
      const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
      const loops = o.loops || 4, r = L / (loops * Math.PI * 2);
      const amp = (o.amp || 0.14) * Math.min(w, h), loop = o.loop == null ? 1 : o.loop;
      const vmin = o.vmin || 0.2, vmax = o.vmax || 1.8;
      const N = Math.round(loops * (o.res || 180));
      const pts = [];
      let t = 0, px = null, py = null;
      for (let i = 0; i <= N; i++) {
        const s = i / N, th = s * loops * Math.PI * 2;
        const A = amp * (1 + 0.4 * nz(s * loops * 1.3 + 2));
        const along = r * th - A * loop * Math.sin(th + (o.phase || 0));
        const perp = A * Math.cos(th + (o.phase || 0)) * (o.squash || 1) + amp * 0.6 * nz(s * 3 + 9);
        const x = ax + ux * along + nx * perp, y = ay + uy * along + ny * perp;
        if (px !== null) {
          const v = vmax - (vmax - vmin) * Math.pow(0.5 + 0.5 * Math.cos(th + (o.phase || 0)), 2);
          t += Math.hypot(x - px, y - py) / v;
        }
        pts.push(+x.toFixed(2), +y.toFixed(2), Math.round(t));
        px = x; py = y;
      }
      return pts;
    },
    // 平滑的隨機漫步 (用於自由的筆觸 / 裝飾)
    wander(w, h, o) {
      const rnd = TB.rng(o.seed || 1), nz = TB.noise1(rnd);
      const box = o.box || [0.05, 0.05, 0.95, 0.95];
      let x = (o.start ? o.start[0] : 0.5) * w, y = (o.start ? o.start[1] : 0.5) * h;
      let a = o.angle || rnd() * Math.PI * 2;
      const steps = o.steps || 600, step = o.step || 3, turn = o.turn || 0.12;
      const pts = [];
      let t = 0;
      for (let i = 0; i < steps; i++) {
        a += nz(i * 0.02) * turn + (o.curl || 0);
        const cx = (box[0] + box[2]) * 0.5 * w, cy = (box[1] + box[3]) * 0.5 * h;
        if (x < box[0] * w || x > box[2] * w || y < box[1] * h || y > box[3] * h) {
          const back = Math.atan2(cy - y, cx - x);
          let d = back - a; d = Math.atan2(Math.sin(d), Math.cos(d));
          a += d * 0.15;
        }
        x += Math.cos(a) * step; y += Math.sin(a) * step;
        const v = (o.vmin || 0.3) + ((o.vmax || 2) - (o.vmin || 0.3)) * (0.5 + 0.5 * nz(i * 0.05 + 40));
        t += step / v;
        pts.push(+x.toFixed(2), +y.toFixed(2), Math.round(t));
      }
      return pts;
    }
  };

  // 由樣板規格產生可編輯圖層 (路徑變成真正的筆觸資料)
  TB.layersFromSpec = function (spec, w, h) {
    return spec.map((ls, li) => {
      const L = TB.makeLayer(ls.brush, ls.p);
      if (ls.name) L.name = ls.name;
      L.ops = ls.paths.map((ps, pi) => ({
        pts: TB.paths[ps.type || 'script'](w, h, ps),
        seed: (ps.seed || 1) * 31 + li * 7 + pi,
        mx: !!(ps.mx || ls.mx), my: !!(ps.my || ls.my)
      }));
      return L;
    });
  };

  /* ---------------- 樣板 ---------------- */
  const FONT = {
    sans: '"Inter Tight", "Noto Sans TC", system-ui, sans-serif',
    serif: '"Instrument Serif", "Noto Serif TC", serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
    tc: '"Noto Sans TC", "Inter Tight", sans-serif'
  };
  TB.FONT = FONT;

  TB.TEMPLATES = [
    {
      id: 'tactile', title: '觸感索引', caption: 'WIRE · THORNS', w: 1200, h: 620, bg: '#9a3f1f', under: true,
      layers: [
        { brush: 'thorns', p: { color: '#9fb6d8', size: 4, thornLen: 18, thornGap: 44 }, paths: [{ seed: 11, a: [0.05, 0.62], b: [0.98, 0.3], loops: 3, amp: 0.3, loop: 1.4 }] },
        { brush: 'wire', p: { color: '#c3d2ea', metal: 0.4, size: 1.6 }, paths: [{ seed: 4, a: [0.02, 0.85], b: [0.95, 0.12], loops: 2, amp: 0.36, loop: 1.6 }] }
      ],
      texts: [
        { t: 'TACTILE', x: 0.03, y: 0.18, s: 0.15, f: 'sans', w: 800, c: '#8ea6dc', ls: -0.04, lh: 0.9 },
        { t: 'MATTER', x: 0.97, y: 0.44, s: 0.15, f: 'sans', w: 800, c: '#8ea6dc', a: 'right', ls: -0.04, lh: 0.9 },
        { t: 'BRUSHES', x: 0.03, y: 0.7, s: 0.15, f: 'sans', w: 800, c: '#8ea6dc', ls: -0.04, lh: 0.9 },
        { t: '(2026)', x: 0.97, y: 0.2, s: 0.07, f: 'serif', w: 400, c: '#8ea6dc', a: 'right', i: 1 },
        { t: 'No.01', x: 0.04, y: 0.44, s: 0.06, f: 'serif', w: 400, c: '#8ea6dc', i: 1 },
        { t: 'FIFTEEN WAYS\nTO TURN A LINE\nINTO MATERIAL', x: 0.6, y: 0.05, s: 0.011, f: 'sans', w: 600, c: '#f1e6da', lh: 1.1 }
      ]
    },
    {
      id: 'quiet', title: '安靜的石頭', caption: 'STONE · STIPPLE', w: 1200, h: 820, bg: '#aeb6c8',
      layers: [
        { brush: 'stone', p: { color: '#5a5c61', size: 26, blur: 9 }, paths: [{ seed: 21, a: [0.02, 0.75], b: [1.0, 0.35], loops: 3, amp: 0.36, loop: 1.2, vmin: 0.2 }] },
        { brush: 'stipple', p: { color: '#2f3036', size: 12, dotSize: 2 }, paths: [{ seed: 8, a: [0.1, 0.95], b: [0.9, 0.85], loops: 3, amp: 0.12, loop: 1.6 }] }
      ],
      texts: [
        { t: '（靜）石頭沒有回答\n只是把光留下來', x: 0.16, y: 0.05, s: 0.017, f: 'tc', w: 700, c: '#e2552b', lh: 1.15 },
        { t: '慢慢地畫，\n線就會變重', x: 0.04, y: 0.17, s: 0.017, f: 'tc', w: 700, c: '#e2552b', lh: 1.15 },
        { t: '（靜）沒有什麼看不見的\n只是還沒被摸到', x: 0.95, y: 0.36, s: 0.017, f: 'tc', w: 700, c: '#e2552b', a: 'right', lh: 1.15 },
        { t: 'SLOW / HEAVY', x: 0.95, y: 0.6, s: 0.016, f: 'sans', w: 700, c: '#e2552b', a: 'right' }
      ]
    },
    {
      id: 'colourways', title: '四種配色', caption: 'POROUS · FOUR COLOURWAYS', w: 640, h: 640, bg: '#a9bce6',
      layers: [
        { brush: 'porous', p: { color: '#4a55c9', size: 20, holes: 0.45, grain: 0.15 }, paths: [{ seed: 5, a: [-0.05, 0.25], b: [0.95, 0.75], loops: 2, amp: 0.3, loop: 1.6 }] }
      ],
      variants: [
        { bg: '#a9bce6', color: '#4a55c9', text: '#ec4b3a' },
        { bg: '#efefef', color: '#a99be0', text: '#1a1a1a' },
        { bg: '#963407', color: '#e76b13', text: '#f2a85f' },
        { bg: '#ffacc8', color: '#ff2a12', text: '#ff2a12' }
      ],
      texts: [
        { t: 'A LINE IS A\nSLOW ANIMAL', x: 0.42, y: 0.04, s: 0.04, f: 'sans', w: 600, c: '#ec4b3a', r: 90, lh: 1 },
        { t: 'IT WALKS UNTIL\nYOU LET IT GO', x: 0.64, y: 0.04, s: 0.04, f: 'sans', w: 600, c: '#ec4b3a', r: 90, lh: 1 },
        { t: 'NO.03', x: 0.9, y: 0.04, s: 0.04, f: 'sans', w: 600, c: '#ec4b3a', r: 90 }
      ]
    },
    {
      id: 'sandorange', title: '沙的圖騰', caption: 'SAND · METAL', w: 1200, h: 680, bg: '#df5f17',
      layers: [
        { brush: 'sand', p: { color: '#f2dcc8', size: 16, grain: 1.4, count: 9 }, paths: [{ seed: 3, a: [0.02, 0.3], b: [0.5, 0.75], loops: 3, amp: 0.25, loop: 1.6, mx: 1 }] },
        { brush: 'metal', p: { color: '#8fb6ec', metal: 0.35, size: 10, envTop: '#e6f0ff', envMid: '#6f95cf', envBot: '#38558a' }, paths: [{ seed: 9, a: [0.04, 0.6], b: [0.98, 0.4], loops: 5, amp: 0.34, loop: 1.1 }] }
      ],
      texts: [
        { t: '沙粒落在皮膚上\n像細針 —— 什麼也留不住', x: 0.2, y: 0.03, s: 0.02, f: 'tc', w: 700, c: '#3b1a0a', lh: 1.1 },
        { t: '最安靜的\n一刻', x: 0.92, y: 0.08, s: 0.018, f: 'tc', w: 700, c: '#3b1a0a', a: 'right', lh: 1.1 },
        { t: 'TRACK\n03', x: 0.16, y: 0.86, s: 0.016, f: 'sans', w: 700, c: '#3b1a0a', lh: 1 },
        { t: '我們是被誰畫出來的？\n還是只是一次意外？', x: 0.5, y: 0.86, s: 0.017, f: 'tc', w: 700, c: '#3b1a0a', lh: 1.1 }
      ]
    },
    {
      id: 'emboss', title: '浮雕織面', caption: 'EMBOSSING · POROUS', w: 1000, h: 1000, bg: '#2c1015',
      layers: [
        { brush: 'emboss', p: { color: '#3c8e95', size: 5, sheet: 1, relief: 1.1 }, paths: [
          { type: 'wander', seed: 7, start: [0.3, 0.3], steps: 900, step: 2.5, turn: 0.35, box: [0.02, 0.02, 0.5, 0.5], mx: 1, my: 1 },
          { type: 'wander', seed: 19, start: [0.15, 0.2], steps: 700, step: 2.5, turn: 0.4, box: [0.02, 0.02, 0.5, 0.5], mx: 1, my: 1 }
        ] },
        { brush: 'porous', p: { color: '#e46a8c', size: 26, holes: 0.6, holeScale: 10, opacity: 0.92 }, paths: [{ seed: 2, a: [0.3, -0.05], b: [0.4, 1.05], loops: 2, amp: 0.15, loop: 0.6 }] }
      ],
      texts: [
        { t: 'TRACK\n03', x: 0.04, y: 0.3, s: 0.026, f: 'sans', w: 600, c: '#f3e9ce', lh: 1 },
        { t: '時間像沙一樣漂走\n在最深的風暴裡\n我們各自留下紋路', x: 0.26, y: 0.3, s: 0.026, f: 'tc', w: 700, c: '#f3e9ce', lh: 1.15 },
        { t: 'ORIGIN\nPARADOX', x: 0.04, y: 0.45, s: 0.026, f: 'sans', w: 600, c: '#f3e9ce', lh: 1 },
        { t: 'EDITION 2026', x: 0.04, y: 0.95, s: 0.022, f: 'sans', w: 600, c: '#f3e9ce' }
      ]
    },
    {
      id: 'ornament', title: '鏡像紋樣', caption: 'THORNS · MIRROR', w: 1000, h: 1100, bg: '#2a2a2a',
      layers: [
        { brush: 'thorns', p: { color: '#d7d9de', metal: 0.6, spec: 1, size: 2.6, thornLen: 16, thornGap: 30, envMid: '#77808a' }, paths: [
          { seed: 13, a: [0.02, 0.05], b: [0.5, 0.5], loops: 3, amp: 0.12, loop: 1.7, mx: 1, my: 1 },
          { type: 'wander', seed: 23, start: [0.2, 0.4], steps: 260, step: 3, turn: 0.5, box: [0.05, 0.05, 0.5, 0.5], mx: 1, my: 1 }
        ] }
      ],
      texts: [
        { t: '0208', x: 0.5, y: 0.03, s: 0.03, f: 'sans', w: 600, c: '#e6e6e6', a: 'center' },
        { t: 'ORNAMENT', x: 0.5, y: 0.43, s: 0.16, f: 'serif', w: 400, c: '#f4f4f4', a: 'center', glow: 1, ls: -0.02 }
      ]
    },
    {
      id: 'elsewhere', title: '別處', caption: 'SAND · STIPPLE', w: 1000, h: 1000, bg: '#d4692b', under: true,
      layers: [
        { brush: 'sand', p: { color: '#e9a63a', size: 34, grain: 1.5, count: 24, clump: 0.4 }, paths: [
          { type: 'wander', seed: 31, start: [0.1, 0.4], steps: 700, step: 4, turn: 0.1, curl: 0.004 },
          { type: 'wander', seed: 41, start: [0.8, 0.2], steps: 600, step: 4, turn: 0.1, curl: -0.004 }
        ] },
        { brush: 'stipple', p: { color: '#2e3170', size: 40, dotSize: 2.6, density: 1.7, amb: 0.05 }, paths: [{ seed: 17, a: [0.1, 0.3], b: [0.9, 0.7], loops: 1, amp: 0.3, loop: 0.8 }] }
      ],
      texts: [{ t: 'elsewhere.', x: 0.5, y: 0.47, s: 0.065, f: 'sans', w: 500, c: '#fbeee2', a: 'center', ls: -0.03 }]
    },
    {
      id: 'beads', title: '珠與線', caption: 'BEADS · WIRE', w: 1100, h: 1100, bg: '#3c2224',
      layers: [
        { brush: 'beads', p: { color: '#3c5ae0', metal: 0, spec: 0.8, size: 7, gap: 1.35 }, paths: [
          { type: 'wander', seed: 51, start: [0.25, 0.25], steps: 1300, step: 3, turn: 0.3, box: [0.0, 0.0, 0.5, 0.5], mx: 1, my: 1 }
        ] },
        { brush: 'sand', p: { color: '#d07a1e', size: 26, grain: 1.1, count: 16, clump: 0.2 }, paths: [{ seed: 61, a: [0.0, 0.7], b: [1.0, 0.4], loops: 2, amp: 0.4, loop: 1.4 }] },
        { brush: 'wire', p: { color: '#c7cfe0', size: 1.4, barbGap: 70 }, paths: [{ seed: 71, a: [0.0, 0.85], b: [1.0, 0.2], loops: 2, amp: 0.3, loop: 1.5 }] }
      ],
      texts: [
        { t: 'GROTESQUE', x: 0.55, y: 0.03, s: 0.02, f: 'sans', w: 600, c: '#b9a6a2' },
        { t: 'THE STILLEST\nHOUR', x: 0.72, y: 0.03, s: 0.02, f: 'sans', w: 600, c: '#b9a6a2', lh: 1 },
        { t: '時間漂走\n像沙丘上的風\n夜很冷\n只剩我們', x: 0.72, y: 0.5, s: 0.022, f: 'tc', w: 700, c: '#b9a6a2', lh: 1.1 }
      ]
    },
    {
      id: 'relic', title: '遺物', caption: 'THORNS · CLAY', w: 1000, h: 1000, bg: '#24201a',
      layers: [
        { brush: 'clay', p: { color: '#a9c7e8', size: 46, blur: 7, stack: 0.5 }, paths: [
          { type: 'wander', seed: 81, start: [0.3, 0.3], steps: 420, step: 4, turn: 0.3, box: [0.12, 0.12, 0.88, 0.88] },
          { type: 'wander', seed: 82, start: [0.7, 0.6], steps: 380, step: 4, turn: 0.3, box: [0.12, 0.12, 0.88, 0.88] }
        ] },
        { brush: 'porous', p: { color: '#8d8d92', size: 22, holes: 0.55, grain: 0.35, spec: 0.5 }, paths: [
          { type: 'wander', seed: 91, start: [0.4, 0.5], steps: 520, step: 4, turn: 0.3, box: [0.15, 0.15, 0.85, 0.85] }
        ] },
        { brush: 'thorns', p: { color: '#93492a', size: 2.4, thornLen: 12 }, paths: [{ seed: 101, a: [0.08, 0.95], b: [0.75, 0.08], loops: 2, amp: 0.32, loop: 1.5 }] }
      ],
      texts: []
    }
  ];

  /* ---------------- 文字 ---------------- */
  TB.textCss = function (b) {
    return {
      fontFamily: FONT[b.f || 'sans'],
      fontWeight: b.w || 600,
      fontStyle: b.i ? 'italic' : 'normal',
      color: b.c || '#000',
      letterSpacing: (b.ls || 0) + 'em',
      lineHeight: b.lh || 1.1,
      textAlign: b.a || 'left'
    };
  };

  // HTML 疊層 (可編輯)
  TB.buildTextOverlay = function (el, texts, opts) {
    opts = opts || {};
    el.innerHTML = '';
    texts.forEach((b, idx) => {
      const d = document.createElement('div');
      d.className = 'tb-text' + (b.glow ? ' glow' : '');
      d.dataset.idx = idx;
      Object.assign(d.style, TB.textCss(b));
      d.style.left = b.x * 100 + '%';
      d.style.top = b.y * 100 + '%';
      d.style.fontSize = `calc(var(--fw) * ${b.s})`;
      const tx = b.a === 'right' ? '-100%' : b.a === 'center' ? '-50%' : '0';
      d.style.transform = `translateX(${tx}) rotate(${b.r || 0}deg)`;
      d.style.transformOrigin = b.a === 'right' ? 'top right' : b.a === 'center' ? 'top center' : 'top left';
      d.textContent = b.t;
      if (opts.editable) {
        d.contentEditable = 'plaintext-only';
        d.spellcheck = false;
        d.addEventListener('input', () => { b.t = d.innerText; opts.onChange && opts.onChange(b, idx); });
      }
      opts.decorate && opts.decorate(d, b, idx);
      el.appendChild(d);
    });
  };

  // Canvas 匯出
  TB.drawTexts = function (ctx, texts, W, H) {
    for (const b of texts) {
      const size = b.s * W, lh = (b.lh || 1.1) * size;
      ctx.save();
      ctx.translate(b.x * W, b.y * H);
      ctx.rotate(((b.r || 0) * Math.PI) / 180);
      ctx.font = `${b.i ? 'italic ' : ''}${b.w || 600} ${size}px ${FONT[b.f || 'sans']}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = (b.ls || 0) * size + 'px';
      ctx.textAlign = b.a || 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = b.c || '#000';
      if (b.glow) { ctx.shadowColor = b.c || '#fff'; ctx.shadowBlur = size * 0.35; }
      const off = (lh - size) / 2;
      String(b.t).split('\n').forEach((line, i) => {
        ctx.fillText(line, 0, off + i * lh);
        if (b.glow) ctx.fillText(line, 0, off + i * lh);
      });
      ctx.restore();
    }
  };
})();
