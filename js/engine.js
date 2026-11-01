/* Tactile brush engine
 * 筆觸 → 浮點高度場 (CPU 蓋章) → WebGL2 模糊 / 法線 / 材質著色。
 * 每個圖層保存筆觸資料 (點 + 種子)，所以任何參數都能事後調整並重新算繪。
 */
(function () {
  const TB = (window.TB = window.TB || {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  TB.clamp = clamp;

  TB.rng = function (seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  // 1D 平滑噪聲 (用於筆觸粗細的抖動)
  TB.noise1 = function (rng) {
    const tbl = new Float32Array(256);
    for (let i = 0; i < 256; i++) tbl[i] = rng() * 2 - 1;
    return function (x) {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return tbl[i & 255] * (1 - u) + tbl[(i + 1) & 255] * u;
    };
  };

  TB.hexToRgb = function (hex) {
    const h = (hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  const MODE = { MAX: 0, LIFT: 1, ADD: 2, DENT: 3, CARVE: 4, ERASE: 5 };
  const PROF = { DOME: 0, SOFT: 1, FLAT: 2, CONE: 3 };
  TB.MODE = MODE;
  TB.PROF = PROF;

  /* ---------------- 高度場 ---------------- */
  class Raster {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.d = new Float32Array(w * h * 2); // R = 高度(px) G = 屬性(泡泡密度等)
      this.base = null;
      this.dirty = { x0: 0, y0: 0, x1: w, y1: h };
    }
    clear() { this.d.fill(0); this.markAll(); }
    markAll() { this.dirty = { x0: 0, y0: 0, x1: this.w, y1: this.h }; }
    mark(x0, y0, x1, y1) {
      const d = this.dirty;
      if (!d) this.dirty = { x0, y0, x1, y1 };
      else {
        if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
        if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
      }
    }
    snapshot() {
      const n = this.w * this.h;
      if (!this.base || this.base.length !== n) this.base = new Float32Array(n);
      const d = this.d, b = this.base;
      for (let i = 0; i < n; i++) b[i] = d[i * 2];
    }
    stamp(cx, cy, r, h, mode, prof, attr, k) {
      if (!(r > 0.35)) r = 0.35;
      const W = this.w, Hh = this.h;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(Hh - 1, Math.ceil(cy + r));
      if (x0 > x1 || y0 > y1) return;
      const d = this.d, base = this.base, ir = 1 / r;
      attr = attr || 0; k = k || 0;
      for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5 - cy) * ir, dy2 = dy * dy;
        if (dy2 >= 1) continue;
        let i = (y * W + x0) * 2;
        for (let x = x0; x <= x1; x++, i += 2) {
          const dx = (x + 0.5 - cx) * ir, q = dx * dx + dy2;
          if (q >= 1) continue;
          let p;
          if (prof === 0) p = Math.sqrt(1 - q);
          else if (prof === 1) { const u = 1 - q; p = u * u; }
          else if (prof === 2) p = Math.min(1, (1 - Math.sqrt(q)) * r * 0.6);
          else p = 1 - Math.sqrt(q);
          const v = p * h;
          switch (mode) {
            case 0: if (v > d[i]) d[i] = v; break;
            case 1: { const t = (base ? base[i >> 1] * k : 0) + v; if (t > d[i]) d[i] = t; break; }
            case 2: d[i] += v; break;
            case 3: { const t = Math.max(0, (base ? base[i >> 1] : d[i]) - v); if (t < d[i]) d[i] = t; break; }
            case 4: { const t = d[i] - v; d[i] = t > 0 ? t : 0; break; }
            case 5: { const f = 1 - Math.min(1, p * h); d[i] *= f; d[i + 1] *= f; break; }
          }
          if (attr > 0 && mode < 3) {
            const a = attr * Math.min(1, p * 2);
            if (a > d[i + 1]) d[i + 1] = a;
          }
        }
      }
      this.mark(x0, y0, x1 + 1, y1 + 1);
    }
  }
  TB.Raster = Raster;

  /* ---------------- 路徑重取樣 ---------------- */
  class Walker {
    constructor() { this.px = null; this.need = 0; this.dist = 0; this.speed = 0; this.tx = 1; this.ty = 0; this.n = 0; }
    // spacing(): 下一個印章距離, cb(x, y, tx, ty, speed px/ms, dist, first)
    feed(x, y, t, spacing, cb) {
      if (this.px === null) {
        this.px = x; this.py = y; this.pt = t;
        cb(x, y, this.tx, this.ty, this.speed, 0, true);
        this.need = Math.max(0.5, spacing());
        return;
      }
      const dx = x - this.px, dy = y - this.py, len = Math.hypot(dx, dy);
      if (len < 0.01) return;
      const dt = Math.max(1, t - this.pt), inst = len / dt;
      this.speed = this.n++ === 0 ? inst : this.speed * 0.8 + inst * 0.2;
      const tx = dx / len, ty = dy / len;
      this.tx = tx; this.ty = ty;
      let s = 0, need = this.need;
      while (s + need <= len) {
        s += need;
        this.dist += need;
        cb(this.px + tx * s, this.py + ty * s, tx, ty, this.speed, this.dist, false);
        need = Math.max(0.5, spacing());
      }
      this.need = need - (len - s);
      this.dist += len - s;
      this.px = x; this.py = y; this.pt = t;
    }
  }
  TB.Walker = Walker;

  /* ---------------- 筆觸執行 ---------------- */
  // op = { pts:[x,y,t,...], seed, erase, alt, mx, my, er (eraser size), es (eraser strength) }
  class StrokeSession {
    constructor(raster, brush, params, op) {
      this.R = raster; this.brush = brush; this.op = op; this.i = 0;
      const W = raster.w, H = raster.h, mx = !!op.mx, my = !!op.my;
      const emit = function (x, y, r, h, mode, prof, attr, k) {
        raster.stamp(x, y, r, h, mode, prof, attr, k);
        if (mx) raster.stamp(W - x, y, r, h, mode, prof, attr, k);
        if (my) raster.stamp(x, H - y, r, h, mode, prof, attr, k);
        if (mx && my) raster.stamp(W - x, H - y, r, h, mode, prof, attr, k);
      };
      const rng = TB.rng(op.seed || 1);
      this.c = { p: params, rng, emit, alt: !!op.alt, noise: TB.noise1(TB.rng((op.seed || 1) * 7 + 3)), W, H };
      if (op.erase) {
        this.s = { w: new Walker() };
      } else {
        if (brush.stack || op.alt) raster.snapshot(); else raster.base = null;
        this.s = brush.begin ? brush.begin(this.c) : {};
      }
    }
    feed() {
      const pts = this.op.pts, c = this.c, s = this.s;
      if (this.op.erase) {
        const r = this.op.er || 20, st = this.op.es == null ? 1 : this.op.es;
        while (this.i + 2 < pts.length) {
          const x = pts[this.i], y = pts[this.i + 1], t = pts[this.i + 2];
          this.i += 3;
          s.w.feed(x, y, t, () => r * 0.25, (x, y) => c.emit(x, y, r, st, MODE.ERASE, PROF.FLAT));
        }
        return;
      }
      while (this.i + 2 < pts.length) {
        const x = pts[this.i], y = pts[this.i + 1], t = pts[this.i + 2];
        this.i += 3;
        this.brush.point(c, s, x, y, t);
      }
    }
    end() { if (!this.op.erase && this.brush.end) this.brush.end(this.c, this.s); }
  }
  TB.StrokeSession = StrokeSession;

  TB.rasterLayer = function (layer, raster) {
    const brush = TB.BRUSHES[layer.brush];
    raster.clear();
    for (const op of layer.ops) {
      const ss = new StrokeSession(raster, brush, layer.params, op);
      ss.feed();
      ss.end();
    }
    raster.markAll();
  };

  /* ---------------- 預設材質 ---------------- */
  TB.SHADE_DEFAULTS = {
    color: '#888888', opacity: 1, blur: 2, thr: 0.6, soft: 0.8, relief: 1,
    amb: 0.3, spec: 0.4, shine: 24, metal: 0,
    envTop: '#ffffff', envMid: '#6d7480', envBot: '#15171b',
    grain: 0, grainSize: 1, grainLit: 0,
    holes: 0, holeScale: 12, holeSize: 0.5, bubbles: 0,
    shadow: 0, shadowDist: 8, stipple: 0, dotSize: 2, density: 1, sheet: 0
  };

  /* ---------------- WebGL2 renderer ---------------- */
  const VS = `#version 300 es
  void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

  const BLUR_FS = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma; uniform ivec2 uSize;
  out vec4 o;
  void main(){
    ivec2 p = ivec2(gl_FragCoord.xy);
    float s = max(uSigma, 0.01);
    float R = ceil(s * 2.5);
    float st = max(1.0, R / 24.0);
    vec4 acc = vec4(0.0); float ws = 0.0;
    for (int i = -24; i <= 24; i++) {
      float d = float(i) * st;
      if (abs(d) > R) continue;
      float w = exp(-d * d / (2.0 * s * s));
      ivec2 q = clamp(p + ivec2(uDir * d), ivec2(0), uSize - 1);
      acc += texelFetch(uTex, q, 0) * w; ws += w;
    }
    o = acc / ws;
  }`;

  const SHADE_FS = `#version 300 es
  precision highp float; precision highp sampler2D;
  uniform sampler2D uTex; uniform ivec2 uSize;
  uniform vec3 uLight; uniform vec3 uColor; uniform vec3 uEnvTop, uEnvMid, uEnvBot;
  uniform float uOpacity, uThr, uSoft, uRelief, uAmb, uSpec, uShine, uMetal;
  uniform float uGrain, uGrainSize, uGrainLit, uHoles, uHoleScale, uHoleSize, uBubbles;
  uniform float uShadow, uShadowDist, uStipple, uDot, uDensity, uSheet, uLive;
  out vec4 o;

  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2 hash2(vec2 p){ return vec2(hash(p), hash(p + 17.17)); }
  vec2 worley(vec2 p){
    vec2 i = floor(p), f = fract(p); float d = 9.0, id = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y); vec2 r = g + hash2(i + g) * 0.8 + 0.1 - f; float dd = dot(r, r);
      if (dd < d) { d = dd; id = hash(i + g + 3.1); }
    }
    return vec2(sqrt(d), id);
  }
  vec4 fetch(vec2 p){ return texelFetch(uTex, clamp(ivec2(floor(p)), ivec2(0), uSize - 1), 0); }

  // x = 著色用高度, y = 遮罩用高度
  vec2 procH(vec2 p){
    vec4 t = fetch(p); float h = t.r; float hm = h;
    if (uHoles > 0.0) {
      vec2 w = worley(p / uHoleScale);
      float rr = uHoleSize * (0.45 + 0.55 * fract(w.y * 7.31));
      h *= mix(1.0, smoothstep(rr * 0.5, rr, w.x), step(w.y, uHoles));
      vec2 w2 = worley(p / (uHoleScale * 0.42) + 11.0);
      float r2 = uHoleSize * 0.85 * (0.4 + 0.6 * fract(w2.y * 5.13));
      h *= mix(1.0, smoothstep(r2 * 0.5, r2, w2.x), step(w2.y, uHoles * 0.55));
      hm = h;
    }
    if (uBubbles > 0.0) {
      float dens = t.g * uBubbles;
      vec2 w = worley(p / uHoleScale);
      float rr = uHoleSize * (0.35 + 0.65 * fract(w.y * 9.71));
      float pr = sqrt(max(0.0, 1.0 - (w.x * w.x) / (rr * rr)));
      h -= step(w.y, dens) * pr * uHoleScale * rr * 0.9;
      vec2 w2 = worley(p / (uHoleScale * 0.45) + 5.0);
      float r2 = uHoleSize * (0.3 + 0.6 * fract(w2.y * 3.7));
      float pr2 = sqrt(max(0.0, 1.0 - (w2.x * w2.x) / (r2 * r2)));
      h -= step(w2.y, dens * 0.8) * pr2 * uHoleScale * 0.45 * r2 * 0.9;
    }
    return vec2(h, hm);
  }

  void main(){
    vec2 p = vec2(gl_FragCoord.x, float(uSize.y) - gl_FragCoord.y);
    vec2 c = procH(p);
    float h = c.x;
    float m = uSheet > 0.5 ? 1.0 : smoothstep(uThr, uThr + uSoft, c.y);

    float hx = procH(p + vec2(1, 0)).x - procH(p - vec2(1, 0)).x;
    float hy = procH(p + vec2(0, 1)).x - procH(p - vec2(0, 1)).x;
    vec3 n = normalize(vec3(-hx * 0.5 * uRelief, -hy * 0.5 * uRelief, 1.0));
    vec3 L = normalize(uLight);
    float dif = max(dot(n, L), 0.0);
    vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
    float sp = pow(max(dot(n, Hv), 0.0), uShine) * uSpec;

    vec2 gp = floor(p / max(uGrainSize, 0.5));
    vec3 base = uColor * (1.0 + (hash(gp) - 0.5) * uGrain * 2.0);
    vec3 col = base * (uAmb + (1.0 - uAmb) * dif);

    if (uMetal > 0.0) {
      vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
      vec2 ld = normalize(L.xy + 1e-5);
      float y = dot(R.xy, ld);
      vec3 env = y > 0.0 ? mix(uEnvMid, uEnvTop, smoothstep(0.0, 0.55, y))
                         : mix(uEnvMid * 0.6, uEnvBot, smoothstep(0.0, 0.45, -y));
      env *= 1.0 - 0.45 * exp(-y * y * 600.0);
      float mx = max(max(base.r, base.g), base.b);
      vec3 tint = base / max(0.35, mx);
      col = mix(col, env * tint, uMetal);
    }
    col += sp * mix(vec3(1.0), base, uMetal * 0.5);

    if (uGrainLit > 0.0) {
      float slope = clamp(dot(n.xy, L.xy) * 4.0, 0.0, 1.0);
      col = mix(col, col * 1.45 + 0.1, step(hash(gp + 7.0), slope * uGrainLit * 0.7));
      // 受光側的邊緣碎成砂粒
      float lit = smoothstep(0.0, 0.25, dot(normalize(n.xy + 1e-5), normalize(L.xy + 1e-5))) * smoothstep(0.02, 0.12, length(n.xy));
      float prob = smoothstep(uThr * 0.55, uThr + uSoft + 3.0 * uGrainLit, c.y);
      m = mix(m, step(hash(gp + 3.0), prob), uGrainLit * lit);
    }

    float sa = 0.0;
    if (uShadow > 0.0) {
      vec2 dir = normalize(L.xy + 1e-5);
      float acc = 0.0;
      for (int i = 1; i <= 5; i++) {
        float hq = fetch(p + dir * uShadowDist * float(i) / 5.0).r;
        acc += smoothstep(h + 0.5, h + 1.0 + uShadowDist * 0.6, hq);
      }
      sa = clamp(acc / 3.0, 0.0, 1.0) * uShadow;
      col *= 1.0 - sa * 0.55;
    }

    if (uStipple > 0.5) {
      float tone = clamp(uAmb + (1.0 - uAmb) * dif + sp * 0.5, 0.0, 1.0);
      float dark = 1.0 - tone;
      vec2 q = p / uDot; vec2 cell = floor(q); vec2 f = fract(q) - 0.5;
      vec2 off = (hash2(cell) - 0.5) * 0.5;
      float on = step(hash(cell + 5.0), dark * uDensity * 1.3 + 0.06);
      float dotA = (1.0 - smoothstep(0.26, 0.4, length(f - off))) * on;
      col = uColor * (0.8 + 0.4 * hash(cell + 9.0));
      if (uLive > 0.5) {
        float e = smoothstep(uThr - 0.4, uThr, c.y) * (1.0 - smoothstep(uThr + 0.8, uThr + 2.2, c.y));
        m = e; col = uColor;
      } else m *= dotA;
      sa = 0.0;
    }

    float a = m * uOpacity;
    float sh = uSheet > 0.5 ? 0.0 : (1.0 - m) * sa * 0.55 * uOpacity;
    o = vec4(col * a, a + sh);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: false });
      if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
      this.gl = gl;
      this.canFloatFbo = !!gl.getExtension('EXT_color_buffer_float');
      this.blur = program(gl, BLUR_FS);
      this.shade = program(gl, SHADE_FS);
      this.vao = gl.createVertexArray();
      this.w = 0; this.h = 0;
      this.texCache = new WeakMap();
    }
    resize(w, h) {
      if (w === this.w && h === this.h) return;
      const gl = this.gl;
      this.canvas.width = w; this.canvas.height = h;
      this.w = w; this.h = h;
      if (this.fbo) this.fbo.forEach((f) => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
      this.fbo = null;
      if (this.canFloatFbo) {
        this.fbo = [0, 1].map(() => {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
          setNearest(gl);
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          return { tex, fb };
        });
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.fbo = null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
    // 將圖層高度場上傳至 GPU (只上傳變動範圍)
    upload(raster) {
      const gl = this.gl;
      let e = this.texCache.get(raster);
      if (!e || e.w !== raster.w || e.h !== raster.h) {
        if (e) gl.deleteTexture(e.tex);
        e = { tex: gl.createTexture(), w: raster.w, h: raster.h };
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, raster.w, raster.h, 0, gl.RG, gl.FLOAT, raster.d);
        setNearest(gl);
        this.texCache.set(raster, e);
        raster.dirty = null;
        return e.tex;
      }
      const d = raster.dirty;
      if (d) {
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, raster.w);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, d.x0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, d.y0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, gl.RG, gl.FLOAT, raster.d);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        raster.dirty = null;
      }
      return e.tex;
    }
    // items: [{raster, shade:{...}, live}], light: {az, el} (度)
    render(items, light) {
      const gl = this.gl, w = this.w, h = this.h;
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const az = (light.az * Math.PI) / 180, el = (light.el * Math.PI) / 180;
      const L = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
      for (const it of items) {
        const S = Object.assign({}, TB.SHADE_DEFAULTS, it.shade);
        let tex = this.upload(it.raster);
        if (this.fbo && S.blur > 0.3) {
          gl.disable(gl.BLEND);
          gl.useProgram(this.blur.p);
          gl.uniform1i(this.blur.u.uTex, 0);
          gl.uniform2i(this.blur.u.uSize, w, h);
          gl.uniform1f(this.blur.u.uSigma, S.blur);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0].fb);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform2f(this.blur.u.uDir, 1, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1].fb);
          gl.bindTexture(gl.TEXTURE_2D, this.fbo[0].tex);
          gl.uniform2f(this.blur.u.uDir, 0, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          tex = this.fbo[1].tex;
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const P = this.shade, u = P.u;
        gl.useProgram(P.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u.uTex, 0);
        gl.uniform2i(u.uSize, w, h);
        gl.uniform3fv(u.uLight, L);
        gl.uniform3fv(u.uColor, TB.hexToRgb(S.color));
        gl.uniform3fv(u.uEnvTop, TB.hexToRgb(S.envTop));
        gl.uniform3fv(u.uEnvMid, TB.hexToRgb(S.envMid));
        gl.uniform3fv(u.uEnvBot, TB.hexToRgb(S.envBot));
        const f = (n, v) => u[n] && gl.uniform1f(u[n], +v);
        f('uOpacity', S.opacity); f('uThr', S.thr); f('uSoft', S.soft); f('uRelief', S.relief);
        f('uAmb', S.amb); f('uSpec', S.spec); f('uShine', S.shine); f('uMetal', S.metal);
        f('uGrain', S.grain); f('uGrainSize', S.grainSize); f('uGrainLit', S.grainLit);
        f('uHoles', S.holes); f('uHoleScale', S.holeScale); f('uHoleSize', S.holeSize); f('uBubbles', S.bubbles);
        f('uShadow', S.shadow); f('uShadowDist', S.shadowDist); f('uStipple', S.stipple);
        f('uDot', S.dotSize); f('uDensity', S.density); f('uSheet', S.sheet); f('uLive', it.live ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    release(raster) {
      const e = this.texCache.get(raster);
      if (e) { this.gl.deleteTexture(e.tex); this.texCache.delete(raster); }
    }
  }
  function setNearest(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  TB.Renderer = Renderer;

  /* ---------------- 圖層工具 ---------------- */
  let uid = 1;
  TB.newId = () => 'L' + Date.now().toString(36) + (uid++).toString(36);

  TB.defaultParams = function (brushId) {
    const b = TB.BRUSHES[brushId];
    const p = Object.assign({}, TB.SHADE_DEFAULTS, b.shade);
    for (const d of b.params) p[d.key] = d.def;
    return p;
  };

  TB.makeLayer = function (brushId, overrides) {
    const b = TB.BRUSHES[brushId];
    return {
      id: TB.newId(),
      name: b.name,
      brush: brushId,
      params: Object.assign(TB.defaultParams(brushId), overrides || {}),
      ops: [],
      visible: true,
      rev: 0
    };
  };

  // 離屏算繪一組圖層 (作品頁、匯出用)
  let shared = null;
  TB.sharedRenderer = function () {
    if (!shared) shared = new Renderer(document.createElement('canvas'));
    return shared;
  };
  TB.renderLayersTo = function (layers, w, h, light, target, opts) {
    const R = TB.sharedRenderer();
    R.resize(w, h);
    const items = [];
    for (const L of layers) {
      if (L.visible === false) continue;
      const r = new Raster(w, h);
      TB.rasterLayer(L, r);
      items.push({ raster: r, shade: L.params });
    }
    R.render(items, light);
    const ctx = target.getContext('2d');
    if (!(opts && opts.keep)) ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(R.canvas, 0, 0, target.width, target.height);
    items.forEach((it) => R.release(it.raster));
  };
})();
