/* 作品樣板頁：即時算繪樣板與筆刷樣本，文字可編輯 */
(function () {
  const TB = window.TB;
  const KEY = 'tactile-works-texts';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ } };
  const LIGHT = { az: 225, el: 42 };

  /* ---------- 算繪佇列 (進入視窗才算, 一次一張) ---------- */
  const queue = [];
  let busy = false;
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const job = queue.shift();
    setTimeout(() => {
      try { job(); } catch (e) { console.error(e); }
      busy = false; pump();
    }, 16);
  }
  const io = new IntersectionObserver((ents) => {
    ents.forEach((en) => {
      if (en.isIntersecting && en.target.__job) { queue.push(en.target.__job); en.target.__job = null; io.unobserve(en.target); pump(); }
    });
  }, { rootMargin: '400px' });
  const lazy = (el, job) => { el.__job = job; io.observe(el); };

  /* ---------- 樣板 ---------- */
  function frameFor(T, variant, texts) {
    const f = document.createElement('div');
    f.className = 'frame loading';
    f.style.aspectRatio = `${T.w} / ${T.h}`;
    f.style.background = variant ? variant.bg : T.bg;
    const cv = document.createElement('canvas');
    cv.width = T.w; cv.height = T.h;
    const tx = document.createElement('div');
    tx.className = 'tb-texts';
    if (T.under) f.append(tx, cv); else f.append(cv, tx);
    new ResizeObserver(() => f.style.setProperty('--fw', f.clientWidth + 'px')).observe(f);
    lazy(f, () => {
      let layers = TB.layersFromSpec(T.layers, T.w, T.h);
      if (variant) layers.forEach((L) => (L.params.color = variant.color));
      TB.renderLayersTo(layers, T.w, T.h, LIGHT, cv);
      f.classList.remove('loading');
    });
    const draw = () => TB.buildTextOverlay(tx, texts, {
      editable: true,
      onChange: () => { saved[T.id] = baseTexts(T); persist(); }
    });
    draw();
    f.__redrawText = draw;
    return { f, cv };
  }
  const textStore = {};
  function baseTexts(T) {
    if (!textStore[T.id]) textStore[T.id] = JSON.parse(JSON.stringify(saved[T.id] || T.texts));
    return textStore[T.id];
  }

  function exportFrame(T, frames) {
    document.fonts.ready.then(() => {
      const q = frames.length > 1 ? 2 : 1;
      const c = document.createElement('canvas');
      c.width = T.w * q; c.height = T.h * (frames.length > 1 ? 2 : 1);
      const ctx = c.getContext('2d');
      frames.forEach((fr, i) => {
        const ox = (i % q) * T.w, oy = Math.floor(i / q) * T.h;
        ctx.save(); ctx.translate(ox, oy);
        ctx.fillStyle = fr.bg; ctx.fillRect(0, 0, T.w, T.h);
        if (T.under) TB.drawTexts(ctx, fr.texts, T.w, T.h);
        ctx.drawImage(fr.cv, 0, 0);
        if (!T.under) TB.drawTexts(ctx, fr.texts, T.w, T.h);
        ctx.restore();
      });
      c.toBlob((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `tactile-${T.id}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    });
  }

  const works = document.getElementById('works');
  TB.TEMPLATES.forEach((T) => {
    const card = document.createElement('article');
    card.className = 'work' + (T.w / T.h > 1.5 ? ' wide' : '');
    const texts = baseTexts(T);
    let frames = [];
    let holder;
    if (T.variants) {
      holder = document.createElement('div');
      holder.className = 'quad';
      T.variants.forEach((v, i) => {
        const vt = texts.map((t) => Object.assign({}, t, { c: v.text }));
        // 四個配色共用文字內容
        const { f, cv } = frameFor(T, v, vt);
        f.addEventListener('input', () => {
          vt.forEach((t, k) => (texts[k].t = t.t));
          frames.forEach((fr, j) => { if (j !== i) { fr.texts.forEach((t, k) => (t.t = texts[k].t)); fr.f.__redrawText(); } });
          saved[T.id] = texts; persist();
        });
        frames.push({ f, cv, texts: vt, bg: v.bg });
        holder.appendChild(f);
      });
    } else {
      const { f, cv } = frameFor(T, null, texts);
      frames.push({ f, cv, texts, bg: T.bg });
      holder = f;
    }
    card.appendChild(holder);
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.innerHTML = `<div><span class="t">${T.title}</span> <span class="label">${T.caption}</span></div>
      <div class="acts">
        <a class="btn sm" href="lab.html?t=${T.id}">在實驗頁編輯 →</a>
        <button class="btn sm ghost" data-a="png">下載 PNG</button>
        <button class="btn sm ghost" data-a="reset">還原文字</button>
      </div>`;
    cap.querySelector('[data-a=png]').onclick = () => exportFrame(T, frames);
    cap.querySelector('[data-a=reset]').onclick = () => {
      delete saved[T.id]; persist();
      const fresh = JSON.parse(JSON.stringify(T.texts));
      textStore[T.id].splice(0, textStore[T.id].length, ...fresh);
      frames.forEach((fr) => {
        fr.texts.forEach((t, k) => (t.t = fresh[k].t));
        fr.f.__redrawText();
      });
    };
    card.appendChild(cap);
    works.appendChild(card);
  });

  /* ---------- 筆刷樣本 ---------- */
  const set = document.getElementById('set');
  const SW = 800, SH = 600;
  TB.BRUSH_ORDER.forEach((id) => {
    const b = TB.BRUSHES[id];
    const card = document.createElement('article');
    card.className = 'brush-card';
    const f = document.createElement('div');
    f.className = 'frame loading';
    f.style.background = b.paper || '#e5e2da';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `(${String(b.no).padStart(2, '0')})`;
    const cv = document.createElement('canvas');
    cv.width = SW; cv.height = SH;
    f.append(cv, tag);
    lazy(f, () => {
      const spec = [{
        brush: id,
        paths: [
          { seed: 3, a: [-0.04, 0.78], b: [1.04, 0.22], loops: 3, amp: 0.26, loop: 1.35 },
          { type: 'wander', seed: 12, start: [0.18, 0.22], steps: 40, step: 3, turn: 0.8, curl: 0.12 }
        ]
      }];
      TB.renderLayersTo(TB.layersFromSpec(spec, SW, SH), SW, SH, LIGHT, cv);
      f.classList.remove('loading');
    });
    card.appendChild(f);
    const h = document.createElement('h3');
    h.innerHTML = `${b.name} <small>${b.en}</small>`;
    const p = document.createElement('p');
    p.textContent = b.desc;
    const a = document.createElement('a');
    a.className = 'btn sm ghost'; a.href = `lab.html?brush=${id}`; a.textContent = '用這支筆刷開始 →';
    card.append(h, p, a);
    set.appendChild(card);
  });
})();
