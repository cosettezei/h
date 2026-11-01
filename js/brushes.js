/* 十五支筆刷：每支各自的蓋章邏輯 (形體) + 預設材質 (著色)。
 * params  : 形體參數 → 改變後重新蓋章 (raster)
 * shade   : 預設材質 → 只改著色
 * ui      : 預設展開的材質控制，其餘收在「進階材質」
 */
(function () {
  const TB = window.TB;
  const { MODE, PROF, clamp } = TB;

  /* -------- 參數定義 -------- */
  const R = (key, label, min, max, step, def, extra) => Object.assign({ key, label, min, max, step, def, type: 'range' }, extra || {});
  const S = (key, label, options, def) => ({ key, label, type: 'select', options, def });

  TB.SHADE_UI = {
    color: { label: '主色 Color', type: 'color' },
    opacity: { label: '不透明度 Opacity', min: 0, max: 1, step: 0.01 },
    blur: { label: '融合 Merge', min: 0, max: 20, step: 0.1 },
    thr: { label: '輪廓門檻 Threshold', min: 0, max: 12, step: 0.05 },
    soft: { label: '輪廓柔化 Edge soft', min: 0.05, max: 6, step: 0.05 },
    relief: { label: '浮雕強度 Relief', min: 0.1, max: 4, step: 0.05 },
    amb: { label: '環境光 Ambient', min: 0, max: 1, step: 0.01 },
    spec: { label: '高光 Specular', min: 0, max: 2, step: 0.01 },
    shine: { label: '光澤銳利 Gloss', min: 2, max: 140, step: 1 },
    metal: { label: '金屬反射 Metal', min: 0, max: 1, step: 0.01 },
    envTop: { label: '反射亮部 Env light', type: 'color' },
    envMid: { label: '反射中間 Env mid', type: 'color' },
    envBot: { label: '反射暗部 Env dark', type: 'color' },
    grain: { label: '表面顆粒 Grain', min: 0, max: 1, step: 0.01 },
    grainSize: { label: '顆粒尺寸 Grain size', min: 0.5, max: 6, step: 0.1 },
    grainLit: { label: '受光面砂粒 Lit dust', min: 0, max: 1, step: 0.01 },
    holes: { label: '孔洞量 Holes', min: 0, max: 1, step: 0.01 },
    holeScale: { label: '孔洞/泡泡尺度 Scale', min: 3, max: 40, step: 0.5 },
    holeSize: { label: '孔洞/泡泡大小 Size', min: 0.1, max: 0.9, step: 0.01 },
    bubbles: { label: '泡泡量 Bubbles', min: 0, max: 1.5, step: 0.01 },
    shadow: { label: '投影 Shadow', min: 0, max: 1, step: 0.01 },
    shadowDist: { label: '投影距離 Shadow dist', min: 0, max: 40, step: 0.5 },
    stipple: { label: '點描模式 Stipple', type: 'toggle' },
    dotSize: { label: '點距 Dot size', min: 1, max: 10, step: 0.1 },
    density: { label: '點密度 Density', min: 0, max: 2, step: 0.01 },
    sheet: { label: '整張板材 Sheet', type: 'toggle' }
  };
  TB.SHADE_GROUPS = [
    ['形狀輪廓', ['blur', 'thr', 'soft', 'relief', 'opacity']],
    ['光與質感', ['color', 'amb', 'spec', 'shine', 'grain', 'grainSize', 'grainLit']],
    ['金屬反射', ['metal', 'envTop', 'envMid', 'envBot']],
    ['孔洞 / 泡泡', ['holes', 'bubbles', 'holeScale', 'holeSize']],
    ['投影 / 點描 / 板材', ['shadow', 'shadowDist', 'stipple', 'dotSize', 'density', 'sheet']]
  ];

  const common = (size, extra) => [
    R('size', '筆寬 Size', 1, 80, 0.5, size),
    R('height', '厚度 Height', 0.1, 2.5, 0.01, 1),
    R('spacing', '印距 Spacing', 0.05, 1, 0.01, 0.18),
    R('speedRef', '速度基準 Speed ref', 0.2, 4, 0.05, 1.2),
    ...(extra || [])
  ];

  /* -------- 通用管狀筆刷 -------- */
  function tube(cfg) {
    return {
      stack: cfg.mode === MODE.LIFT,
      begin(c) { return { w: new TB.Walker(), r: c.p.size * 0.4 }; },
      point(c, s, x, y, t) {
        const p = c.p;
        s.w.feed(x, y, t, () => Math.max(0.5, s.r * p.spacing), (x, y, tx, ty, sp, dist) => {
          const slow = clamp(1 - sp / p.speedRef, 0, 1);
          let r = p.size * Math.pow(1 + (p.slowGrow || 0), slow - 0.4);
          r *= 1 + (p.wobble || 0) * c.noise(dist / (p.size * 2.2 + 4));
          if (cfg.bulge) {
            const ph = Math.sin((dist / p.bulgeLen) * Math.PI * 2 + c.noise(dist * 0.013) * 2.5);
            r *= 1 + p.bulge * (0.4 + slow) * Math.pow(Math.max(0, ph), 2);
          }
          r *= Math.min(1, 0.3 + dist / (p.size * 3 + 1));
          s.r = Math.max(0.5, r);
          if (c.alt) {
            c.emit(x, y, s.r * 0.75, s.r * (p.dent || 0.6), MODE.DENT, PROF.DOME);
          } else {
            const attr = cfg.attr ? cfg.attr(slow, p) : 0;
            const prof = cfg.prof ? cfg.prof(p) : PROF.DOME;
            c.emit(x, y, s.r, s.r * p.height, cfg.mode, prof, attr, p.stack || 0);
          }
        });
      }
    };
  }

  const B = {};

  B.ceramic = Object.assign(tube({ mode: MODE.LIFT }), {
    no: 1, name: '釉面陶瓷', en: 'Glazed Ceramic',
    desc: '厚實的釉面管狀筆觸，表面光滑、高光銳利；慢畫變粗，交疊處融為一體。',
    params: common(16, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.6),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.18),
      R('stack', '堆疊 Stack', 0, 1, 0.01, 0.15)
    ]),
    shade: { color: '#ebe7df', blur: 3, thr: 0.8, amb: 0.22, spec: 1.1, shine: 70, shadow: 0.35, shadowDist: 8 },
    ui: ['color', 'blur', 'spec', 'shine', 'shadow'],
    paper: '#16161a'
  });

  B.stone = Object.assign(tube({ mode: MODE.MAX, prof: () => PROF.SOFT }), {
    no: 2, name: '石材', en: 'Stone',
    desc: '線條彼此融合成一整塊石頭，受光的斜面覆蓋砂粒。',
    params: common(20, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.5),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.3)
    ]),
    shade: { color: '#6a6a68', blur: 8, thr: 2.2, soft: 0.6, amb: 0.55, spec: 0.03, shine: 8, grain: 0.06, grainLit: 0.85, grainSize: 1.2 },
    ui: ['color', 'blur', 'grainLit', 'grain', 'relief'],
    paper: '#e5e2da'
  });

  B.metal = Object.assign(tube({ mode: MODE.LIFT }), {
    no: 3, name: '動態金屬', en: 'Kinetic Metal',
    desc: '拋光金屬，可調整反射色盤；快畫細、慢畫粗成水滴。',
    params: common(11, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 2.5, 0.01, 1.4),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.12),
      R('stack', '堆疊 Stack', 0, 1, 0.01, 0.1)
    ]),
    shade: { color: '#cfd3d9', blur: 2.5, thr: 0.6, amb: 0.2, spec: 1.2, shine: 90, metal: 1, envTop: '#ffffff', envMid: '#8a919c', envBot: '#2c3037', shadow: 0.3, shadowDist: 6 },
    ui: ['color', 'metal', 'envTop', 'envMid', 'envBot', 'blur'],
    presets: [
      { name: '鉻 Chrome', v: { color: '#d5d9df', envTop: '#ffffff', envMid: '#7c838e', envBot: '#1a1c21' } },
      { name: '金 Gold', v: { color: '#e4b85a', envTop: '#fff3c8', envMid: '#9a6a22', envBot: '#2a1a06' } },
      { name: '藍鋼 Blue steel', v: { color: '#9fb4d6', envTop: '#eef4ff', envMid: '#3f5a86', envBot: '#0b1222' } },
      { name: '銅 Copper', v: { color: '#d48a5c', envTop: '#ffe0cc', envMid: '#8a4524', envBot: '#200c04' } },
      { name: '霓虹 Iridescent', v: { color: '#e0d6ff', envTop: '#ffd1f0', envMid: '#5a7bd6', envBot: '#11293a' } }
    ],
    paper: '#e5e2da'
  });

  B.emboss = Object.assign(tube({ mode: MODE.MAX, prof: (p) => (p.edge === 'sharp' ? PROF.FLAT : PROF.DOME) }), {
    no: 4, name: '壓凸', en: 'Embossing',
    desc: '形體從一整張板材壓出：圓潤的脊線或銳利的邊。',
    params: common(7, [
      S('edge', '邊緣 Edge', [['round', '圓潤 Round'], ['sharp', '銳利 Sharp']], 'round'),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.1)
    ]),
    shade: { color: '#bdbcb7', sheet: 1, blur: 1.6, relief: 0.8, amb: 0.45, spec: 0.25, shine: 20, grain: 0.02 },
    ui: ['color', 'relief', 'blur', 'sheet', 'spec'],
    paper: '#bdbcb7'
  });

  B.paste = Object.assign(tube({ mode: MODE.LIFT }), {
    no: 5, name: '立體顏料', en: 'Volumetric Paste',
    desc: '一條條顏料可以疊在彼此上方，或融成一體。',
    params: common(15, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.8),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.3),
      R('stack', '疊放 / 融合 Stack', 0, 1, 0.01, 0.6)
    ]),
    shade: { color: '#8c9196', blur: 3.5, thr: 0.8, amb: 0.25, spec: 0.75, shine: 32, shadow: 0.55, shadowDist: 10, grain: 0.04 },
    ui: ['color', 'blur', 'spec', 'shadow'],
    paper: '#16161a'
  });

  B.foam = Object.assign(tube({ mode: MODE.MAX, attr: (slow) => slow }), {
    no: 6, name: '泡沫', en: 'Foam',
    desc: '快畫是一條平滑的線；慢畫線條變粗並沸騰出泡泡。',
    params: common(8, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 2.5, 0.01, 1.6),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.15)
    ]),
    shade: { color: '#8f8f8f', blur: 1.5, thr: 0.6, amb: 0.3, spec: 0.5, shine: 30, bubbles: 1.1, holeScale: 11, holeSize: 0.7 },
    ui: ['color', 'bubbles', 'holeScale', 'holeSize', 'spec'],
    paper: '#16161a'
  });

  B.volfoam = Object.assign(tube({ mode: MODE.LIFT, bulge: true }), {
    no: 7, name: '立體泡沫', en: 'Volumetric Foam',
    desc: '繩狀泡沫一層層疊放、膨起成珠，並在彼此身上投下陰影。',
    params: common(13, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.7),
      R('bulge', '膨起量 Bulge', 0, 2, 0.01, 0.9),
      R('bulgeLen', '膨起間距 Bulge length', 10, 200, 1, 60),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.1),
      R('stack', '疊放 Stack', 0, 1, 0.01, 0.85)
    ]),
    shade: { color: '#c8cdd3', blur: 2, thr: 0.7, amb: 0.3, spec: 0.55, shine: 22, shadow: 0.75, shadowDist: 14 },
    ui: ['color', 'shadow', 'shadowDist', 'spec', 'blur'],
    paper: '#e5e2da'
  });

  B.beads = {
    no: 8, name: '金屬珠鍊', en: 'Metallic Beads',
    desc: '珠子沿著線條串起：鉻、金、鋼、珍珠、塑膠。',
    params: [
      R('size', '珠子大小 Bead size', 1, 30, 0.5, 5.5),
      R('gap', '珠距 Gap', 0.8, 4, 0.01, 1.2),
      R('vary', '大小變化 Vary', 0, 1, 0.01, 0.1),
      R('height', '厚度 Height', 0.1, 2, 0.01, 1)
    ],
    shade: { color: '#d5d9df', blur: 0, thr: 0.3, soft: 0.6, amb: 0.2, spec: 1.3, shine: 80, metal: 1, envTop: '#ffffff', envMid: '#8a909a', envBot: '#202228', shadow: 0.35, shadowDist: 4 },
    ui: ['color', 'metal', 'spec', 'shadow'],
    presets: [
      { name: '鉻 Chrome', v: { color: '#d5d9df', metal: 1, envTop: '#ffffff', envMid: '#8a909a', envBot: '#202228', spec: 1.3 } },
      { name: '金 Gold', v: { color: '#e9bd5e', metal: 1, envTop: '#fff2c4', envMid: '#a87526', envBot: '#2b1905', spec: 1.2 } },
      { name: '鋼 Steel', v: { color: '#9aa2ab', metal: 0.85, envTop: '#e7ebef', envMid: '#5a626b', envBot: '#14171a', spec: 0.8 } },
      { name: '珍珠 Pearl', v: { color: '#f2ece4', metal: 0.25, envTop: '#ffffff', envMid: '#d9cfe6', envBot: '#8f8a9a', spec: 0.9, amb: 0.45 } },
      { name: '塑膠 Plastic', v: { color: '#3f5bd6', metal: 0, spec: 0.9, shine: 50, amb: 0.3 } }
    ],
    begin(c) { return { w: new TB.Walker(), r: c.p.size }; },
    point(c, s, x, y, t) {
      const p = c.p;
      s.w.feed(x, y, t, () => s.r * 2 * p.gap, (x, y) => {
        s.r = p.size * (1 + (c.rng() - 0.5) * 2 * p.vary);
        c.emit(x, y, s.r, s.r * p.height, MODE.MAX, PROF.DOME);
      });
    },
    paper: '#16161a'
  };

  B.sand = {
    no: 9, name: '沙', en: 'Sand Brush',
    desc: '慢畫時沙粒聚成水滴狀的團塊，快畫則向外散開。',
    params: [
      R('size', '散佈範圍 Spread', 2, 60, 0.5, 12),
      R('grain', '沙粒大小 Grain', 0.5, 6, 0.05, 1.9),
      R('count', '沙粒數量 Count', 1, 40, 1, 16),
      R('clump', '聚團 Clump', 0, 1.5, 0.01, 0.8),
      R('speedRef', '速度基準 Speed ref', 0.2, 4, 0.05, 1.2),
      R('height', '厚度 Height', 0.1, 2.5, 0.01, 1)
    ],
    shade: { color: '#727272', blur: 1.2, thr: 0.7, soft: 0.5, amb: 0.35, spec: 0.8, shine: 40 },
    ui: ['color', 'blur', 'thr', 'spec'],
    begin(c) { return { w: new TB.Walker() }; },
    point(c, s, x, y, t) {
      const p = c.p;
      s.w.feed(x, y, t, () => 2, (x, y, tx, ty, sp) => {
        const slow = clamp(1 - sp / p.speedRef, 0, 1);
        const n = Math.round(p.count * (0.45 + slow * 0.8));
        const spread = p.size * (0.35 + (1 - slow) * 0.65);
        for (let i = 0; i < n; i++) {
          const a = c.rng() * Math.PI * 2, d = spread * Math.pow(c.rng(), 0.9);
          const g = p.grain * (0.45 + c.rng() * 0.9) * (1 + slow * 0.6);
          c.emit(x + Math.cos(a) * d, y + Math.sin(a) * d, g, g * p.height, MODE.MAX, PROF.DOME);
        }
        // 聚團：慢的地方沙粒聚成一顆水滴
        const r = p.size * 0.42 * (0.25 + slow * p.clump) * (0.7 + c.rng() * 0.6);
        if (r > 0.8) c.emit(x + (c.rng() - 0.5) * r, y + (c.rng() - 0.5) * r, r, r * 0.7 * p.height, MODE.MAX, PROF.DOME);
      });
    },
    paper: '#e5e2da'
  };

  B.stipple = Object.assign(tube({ mode: MODE.LIFT }), {
    no: 10, name: '點描', en: 'Stipple Brush',
    desc: '繪製時只顯示輪廓，放開後依明暗以點填滿。',
    params: common(18, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.4),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.2),
      R('stack', '堆疊 Stack', 0, 1, 0.01, 0.2)
    ]),
    shade: { color: '#3b3b3b', stipple: 1, dotSize: 2.2, density: 1.25, blur: 4, thr: 1, amb: 0.15, spec: 0.2, shine: 12 },
    ui: ['color', 'dotSize', 'density', 'amb', 'blur'],
    paper: '#e5e2da'
  });

  B.porous = Object.assign(tube({ mode: MODE.MAX }), {
    no: 11, name: '多孔', en: 'Porous Brush',
    desc: '佈滿球狀孔洞的團塊 —— 像苔蘚或海綿。',
    params: common(16, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.7),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.35)
    ]),
    shade: { color: '#3e6a2b', blur: 4, thr: 1.2, soft: 0.5, amb: 0.4, spec: 0.12, shine: 10, grain: 0.3, grainSize: 1, holes: 0.38, holeScale: 17, holeSize: 0.62, shadow: 0.35, shadowDist: 5 },
    ui: ['color', 'holes', 'holeScale', 'holeSize', 'grain'],
    paper: '#e5e2da'
  });

  B.wire = {
    no: 12, name: '鐵絲網', en: 'Barbed Wire',
    desc: '兩股扭絞的金屬線，固定間距長出刺結。',
    params: [
      R('size', '線粗 Wire', 0.6, 8, 0.05, 1.8),
      R('twist', '扭絞週期 Twist', 6, 80, 0.5, 22),
      R('gap', '股距 Strand gap', 0, 3, 0.01, 1.1),
      R('barbGap', '刺結間距 Barb gap', 15, 200, 1, 55),
      R('barbLen', '刺長 Barb length', 2, 30, 0.5, 8),
      R('height', '厚度 Height', 0.1, 2.5, 0.01, 1)
    ],
    shade: { color: '#b4bac2', blur: 0.7, thr: 0.35, soft: 0.5, amb: 0.25, spec: 1, shine: 60, metal: 0.85, envTop: '#ffffff', envMid: '#7d848d', envBot: '#1d2024', shadow: 0.45, shadowDist: 6 },
    ui: ['color', 'metal', 'shadow', 'spec'],
    presets: [
      { name: '鋼 Steel', v: { color: '#b4bac2', metal: 0.85, envMid: '#7d848d' } },
      { name: '鏽 Rust', v: { color: '#9a4b25', metal: 0.25, spec: 0.4, grain: 0.25, envMid: '#5a2a12' } },
      { name: '淺藍 Pale blue', v: { color: '#9fb6d8', metal: 0.5, envMid: '#5d7298' } }
    ],
    begin(c) { return { w: new TB.Walker(), next: c.p.barbGap * 0.5, side: 1 }; },
    point(c, s, x, y, t) {
      const p = c.p;
      s.w.feed(x, y, t, () => Math.max(0.5, p.size * 0.4), (x, y, tx, ty, sp, dist) => {
        const nx = -ty, ny = tx;
        const off = Math.sin((dist / p.twist) * Math.PI * 2) * p.size * p.gap;
        c.emit(x + nx * off, y + ny * off, p.size, p.size * p.height, MODE.MAX, PROF.DOME);
        c.emit(x - nx * off, y - ny * off, p.size, p.size * p.height, MODE.MAX, PROF.DOME);
        if (dist >= s.next) {
          s.next = dist + p.barbGap * (0.85 + c.rng() * 0.3);
          const base = Math.atan2(ty, tx);
          for (let k = 0; k < 4; k++) {
            const a = base + (k < 2 ? 1 : -1) * (Math.PI / 2 + (k % 2 ? 0.75 : -0.75)) + (c.rng() - 0.5) * 0.3;
            const L = p.barbLen * (0.8 + c.rng() * 0.4);
            for (let u = 0; u <= L; u += 0.6) {
              const r = p.size * 0.85 * (1 - (u / L) * 0.65);
              c.emit(x + Math.cos(a) * u, y + Math.sin(a) * u, r, r * p.height, MODE.MAX, PROF.DOME);
            }
          }
          const r = p.size * 1.7;
          c.emit(x, y, r, r * p.height * 0.9, MODE.MAX, PROF.DOME);
        }
      });
    },
    paper: '#16161a'
  };

  B.thorns = {
    no: 13, name: '玫瑰刺', en: 'Rose Thorns',
    desc: '一根枝條，兩側交錯長出向後彎的尖刺。',
    params: [
      R('size', '枝條粗細 Stem', 0.8, 14, 0.1, 3.2),
      R('thornGap', '刺間距 Thorn gap', 8, 160, 1, 32),
      R('thornLen', '刺長 Thorn length', 2, 50, 0.5, 13),
      R('thornWidth', '刺根寬 Thorn base', 0.5, 3, 0.01, 1.4),
      R('angle', '刺角度 Angle', 10, 90, 1, 48),
      R('hook', '彎鉤 Hook', -1.5, 1.5, 0.01, 0.5),
      R('height', '厚度 Height', 0.1, 2.5, 0.01, 1)
    ],
    shade: { color: '#8b4a2b', blur: 0.9, thr: 0.4, soft: 0.5, amb: 0.3, spec: 0.45, shine: 26, shadow: 0.5, shadowDist: 6 },
    ui: ['color', 'spec', 'shadow', 'metal'],
    begin(c) { return { w: new TB.Walker(), next: c.p.thornGap * 0.6, side: 1 }; },
    point(c, s, x, y, t) {
      const p = c.p;
      s.w.feed(x, y, t, () => Math.max(0.5, p.size * 0.3), (x, y, tx, ty, sp, dist) => {
        const r = p.size * (1 + 0.15 * c.noise(dist * 0.03)) * Math.min(1, 0.4 + dist / 30);
        c.emit(x, y, r, r * p.height, MODE.MAX, PROF.DOME);
        if (dist >= s.next) {
          s.next = dist + p.thornGap * (0.75 + c.rng() * 0.5);
          s.side = -s.side;
          let a = Math.atan2(ty, tx) + Math.PI - s.side * ((180 - p.angle) * Math.PI) / 180;
          const L = p.thornLen * (0.75 + c.rng() * 0.5);
          let px = x, py = y;
          for (let u = 0; u <= L; u += 0.5) {
            const k = u / L;
            const rr = r * p.thornWidth * (1 - k) + 0.45;
            c.emit(px, py, rr, rr * p.height, MODE.MAX, PROF.DOME);
            a += (s.side * p.hook * 0.5) / L;
            px += Math.cos(a) * 0.5; py += Math.sin(a) * 0.5;
          }
        }
      });
    },
    paper: '#e5e2da'
  };

  B.laurel = {
    no: 14, name: '月桂', en: 'Laurel',
    desc: '沿著線條長出交錯的葉片，每片葉子有葉脈凹槽。',
    params: [
      R('size', '枝條粗細 Stem', 0.5, 8, 0.1, 1.8),
      R('leafLen', '葉長 Leaf length', 6, 80, 0.5, 24),
      R('leafW', '葉寬 Leaf width', 1, 30, 0.1, 6.5),
      R('leafGap', '葉距 Leaf gap', 4, 80, 0.5, 14),
      R('angle', '葉角度 Angle', 5, 85, 1, 38),
      S('pair', '排列 Layout', [['alt', '交錯 Alternate'], ['pair', '對生 Pairs']], 'alt'),
      R('vein', '葉脈深度 Vein', 0, 1, 0.01, 0.35),
      R('height', '厚度 Height', 0.1, 2.5, 0.01, 0.8)
    ],
    shade: { color: '#6d7f43', blur: 1.1, thr: 0.4, soft: 0.5, amb: 0.32, spec: 0.4, shine: 24, shadow: 0.45, shadowDist: 6 },
    ui: ['color', 'spec', 'shadow', 'metal'],
    begin(c) { return { w: new TB.Walker(), next: 4, side: 1 }; },
    point(c, s, x, y, t) {
      const p = c.p;
      const leaf = (x, y, a) => {
        const L = p.leafLen * (0.8 + c.rng() * 0.4), W = p.leafW * (0.85 + c.rng() * 0.3);
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let u = 0; u <= L; u += 0.6) {
          const k = u / L, r = W * Math.pow(Math.sin(Math.PI * Math.pow(k, 0.85)), 0.8) + 0.4;
          c.emit(x + ca * u, y + sa * u, r, r * p.height, MODE.MAX, PROF.DOME);
        }
        if (p.vein > 0) for (let u = W * 0.4; u <= L * 0.85; u += 0.6)
          c.emit(x + ca * u, y + sa * u, Math.max(0.6, W * 0.18), W * p.vein * 0.5, MODE.CARVE, PROF.DOME);
      };
      s.w.feed(x, y, t, () => Math.max(0.5, p.size * 0.35), (x, y, tx, ty, sp, dist) => {
        c.emit(x, y, p.size, p.size * p.height, MODE.MAX, PROF.DOME);
        if (dist >= s.next) {
          s.next = dist + p.leafGap * (0.85 + c.rng() * 0.3);
          const base = Math.atan2(ty, tx), ang = (p.angle * Math.PI) / 180;
          if (p.pair === 'pair') { leaf(x, y, base + ang); leaf(x, y, base - ang); }
          else { s.side = -s.side; leaf(x, y, base + s.side * ang); }
        }
      });
    },
    paper: '#e5e2da'
  };

  B.clay = Object.assign(tube({ mode: MODE.LIFT, prof: () => PROF.SOFT }), {
    no: 15, name: '雕塑黏土', en: 'Modeling Clay',
    desc: '先捏出形體，再按 Alt / 切換「壓痕」在上面壓出凹痕或堆高體積。',
    alt: '壓痕 Dent',
    params: common(22, [
      R('slowGrow', '慢速增粗 Slow grow', 0, 1.5, 0.01, 0.6),
      R('wobble', '粗細起伏 Wobble', 0, 0.8, 0.01, 0.35),
      R('stack', '堆高 Build up', 0, 1, 0.01, 0.7),
      R('dent', '壓痕深度 Dent depth', 0.1, 1.5, 0.01, 0.55)
    ]),
    shade: { color: '#bdbdbd', blur: 6, thr: 1.2, amb: 0.3, spec: 0.18, shine: 12, grain: 0.03, shadow: 0.35, shadowDist: 10 },
    ui: ['color', 'blur', 'spec', 'shadow', 'relief'],
    paper: '#16161a'
  });

  for (const k in B) B[k].id = k;
  TB.BRUSHES = B;
  TB.BRUSH_ORDER = Object.keys(B).sort((a, b) => B[a].no - B[b].no);
})();
