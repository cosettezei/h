# TACTILE(lab) → 論文網站 `E:\gj_vu_3` 整合：第一輪檢查與方案

日期：2026-11-05　狀態：**只完成檢查，沒有搬移任何檔案。論文網站本身尚未被檢查 (無法存取)。**

---

## 1. 實際位置 (已驗證)

| 問題 | 答案 |
|---|---|
| 工作目錄 | `/home/user/h`：雲端 Linux 容器內，不是你的電腦 |
| Repo | GitHub `cosettezei/h` (public)，remote `https://github.com/cosettezei/h` |
| Branch / HEAD | `tactile-brush-lab` @ `ac17b3e8eb21dbae82074ab1982f5133fd09c6da`，已推送，與 `origin/tactile-brush-lab` 一致；工作目錄乾淨 |
| 與 `E:\gj_vu_3` 的關係 | **兩個獨立的 repo**。`h` 不是 `gj_vu_3` 的子目錄、分支或 fork。`h` 的歷史只有：`2f4e018` 上傳 `Unicorn.glb` → TACTILE 的 4 個 commit |
| 檔案位置 | repo 根目錄：`index.html`、`lab.html`、`js/engine.js`、`js/brushes.js`、`js/templates.js`、`js/lab.js`、`js/works.js`、`css/style.css`、`Unicorn.glb` |
| 能否存取 `E:\gj_vu_3` | **不能**。容器沒有 Windows 磁碟，沒有連線中的電腦資料夾，這個 session 可見的 GitHub repo 也只有 `cosettezei/h` |
| 程式碼只在雲端嗎 | 程式碼與歷史都在 GitHub (`cosettezei/h`)，不會因容器回收而遺失。**只存在於容器內**的有：本機 tag `phase2-start` (推送被代理拒絕)、`tests/out/` 的截圖與暫存輸出 |
| Phase 2 報告與 checkpoint | ✅ `docs/phase2-audit.md`、`tests/baseline/audit-before.json`、`audit-after.json`、`brush-params.json`、15 張基準圖都已提交<br>✅ checkpoint commit `239320e` (Phase 2 開始前) 在遠端<br>⚠ tag 不在遠端：到你的電腦後執行 `git tag phase2-start 239320e` 即可重建 |

所以**第二階段「檢查原論文網站」完全沒有執行**。下面關於 Next.js、Scope Guard、Works Registry、視窗系統、作者模式的內容，都是待確認的問題，不是檢查結果。

---

## 2. 讓兩個專案能同時被檢查的方式 (擇一)

| 方式 | 作法 | 適合 |
|---|---|---|
| **A. 在你的電腦上跑 Claude Code (建議)** | 在 `E:\gj_vu_3` 開 Claude Desktop 或 CLI，把這份文件與 `cosettezei/h` 的 `tactile-brush-lab` 給它 | 能讀 `E:\`，也能沿用 G 槽備份流程與磁碟身分檢查。這是唯一能碰到 G 槽備份的方式 |
| B. 把 `gj_vu_3` 推到 GitHub | 推成 private repo → 在 claude.ai 授權 Claude GitHub App → 開新的雲端 session，同時選兩個 repo | 可以在雲端完成整合與測試，但 G 槽備份仍要在本機做 |

---

## 3. 保留 Git 歷史的遷移方式 (第二輪才執行)

在 `E:\gj_vu_3` 依序執行，每一步都先看結果再繼續：

```powershell
cd E:\gj_vu_3
git status                                   # 若有未提交修改：先停下，由作者決定 commit 或 stash，不自動處理
git tag pre-tactile-integration              # 整合前 checkpoint
git worktree add ..\gj_vu_3-tactile -b integrate/tactile-lab   # 原工作目錄完全不動
cd ..\gj_vu_3-tactile
git remote add tactile https://github.com/cosettezei/h.git
git fetch tactile tactile-brush-lab
git subtree add --prefix=vendor/tactile-lab tactile tactile-brush-lab   # 不加 --squash，保留完整歷史
```

- `vendor/tactile-lab/` 是原專案的完整原樣副本，靜態頁仍可獨立開啟。Next.js 的路由從這裡 import 引擎，不複製第二份。所以原 TACTILE 專案在整合成功前一直存在，`cosettezei/h` 本身也不動。
- ⚠ **需要你決定**：subtree 會把 `Unicorn.glb` (19.7MB) 一起帶進論文網站 repo。放在 `vendor/` 不會被網站對外提供；檔案本身不修改、不刪除。若不想讓網站 repo 增加 20MB，可以改用 git submodule (歷史留在 `h`，網站只記錄指標)。
- 備份：依照 `gj_vu_3` 既有的 G 槽備份機制，先確認磁碟身分，再建立新的備份版本，不覆蓋已驗證的版本。這需要在本機確認，我目前看不到那套機制。

---

## 4. 可直接重用 vs. 必須適配 (根據 TACTILE 程式碼實際檢查)

### 可直接重用，不改動
| 檔案 | 理由 |
|---|---|
| `js/engine.js` (23KB) | 高度場、筆觸重播、WebGL2 渲染、context lost 恢復。只依賴 `window` 與 `<canvas>`，不碰頁面 DOM |
| `js/brushes.js` (21KB) | 15 支筆刷規則，純資料 + 函式 |
| `js/templates.js` (15KB) | 路徑產生器、9 組樣板、文字排版 (`buildTextOverlay` 需要傳入容器元素) |
| `tests/fixtures/`、`tests/harness.js`、`tests/baseline/` | 引擎層測試 E1–E10 不依賴頁面結構，可以原樣對 vendor 目錄執行 |

這三個引擎檔案都是 classic script，透過 `window.TB` 共用。在 Next.js 中**只能在瀏覽器端載入** (client component 的 `useEffect` 裡 `import()`，或 `next/dynamic` 加 `ssr: false`)。不需要改寫成 React。

### 必須適配
| 項目 | 現況 (已驗證) | 適配方式 |
|---|---|---|
| `js/lab.js` (41KB) | 自行查詢 `lab.html` 的固定 ID；在 `window` 上掛 `keydown`、`pointermove`、`pointerup`；有 `ResizeObserver`；設定 `window.__lab`；讀 `location.search`、呼叫 `history.replaceState` | 改成 `mountLab(root, options) → { destroy() }`：查詢範圍限定在 root 內；卸載時移除監聽、斷開 observer、釋放 WebGL；URL 參數改由路由傳入。這是**最小必要修改**，邏輯不重寫 |
| `js/works.js` | 同上 (`IntersectionObserver`、`ResizeObserver`、`document.fonts`) | `mountWorks(root, registry)` |
| `css/style.css` | 有全域選擇器：`:root`、`*`、`html, body`、`a`、`button, input, select`、`body.lab { height:100dvh; overflow:hidden }`，以及自己的 `.top` 導覽列 | 全部限定在 `.tactile-root` 之下 (或改成 CSS Module)；刪除自己的導覽列、改用網站導覽；全螢幕版面改成跟隨容器大小 |
| 字體 | Google Fonts `<link>` (Inter Tight / Instrument Serif / IBM Plex Mono / Noto Sans TC) | 改用網站既有字體系統 (例如 `next/font`)，或保留在 TACTILE 範圍內，視網站規範決定 |
| 快捷鍵 | `B E T X Y [ ] 0–9 Ctrl+Z` 掛在整個 window | 只在畫布或面板取得焦點時生效，避免與網站或視窗系統的快捷鍵衝突 |
| 儲存 | `localStorage` 鍵 `tactile-lab-v1`、`tactile-works-texts`；JSON `v:1` | 對齊網站的版本保存與實驗紀錄規範；保留舊鍵的讀取以相容既有資料 |
| 側面板 | 固定 340px 的 grid 欄位 | 若網站有視窗系統，把面板放進那套系統 (可拖曳、縮放、隱藏)，不另做第二套 |
| 測試 | `tests/audit.js` 的 U 系列直接操作 `lab.html` | 引擎層 (E) 原樣保留；介面層 (U) 改成對 Next 開發伺服器的路由執行 |

---

## 5. 建議結構 (假設網站使用 App Router，需要確認)

```
gj_vu_3/
├── vendor/tactile-lab/             ← subtree，原樣 (含 tests/、docs/、Unicorn.glb)
├── src/lib/tactile/
│   ├── loadEngine.js               ← 瀏覽器端依序載入 vendor 的 engine/brushes/templates，回傳 TB
│   ├── mountLab.js                 ← 由 lab.js 最小修改而來
│   └── mountWorks.js
├── src/components/tactile/
│   ├── TactileLab.jsx              ← 'use client'；useEffect 中 mountLab / destroy
│   ├── TactileWorks.jsx
│   └── tactile.module.css          ← 由 style.css 限定範圍而來
├── app/lab/tactile-brush/page.*    ← 名稱待依現有 /lab 命名規範確認
├── app/works/tactile/page.*        ← 名稱待依 Works Registry 確認
└── (Works Registry / 導覽設定中新增一筆)
```

### 預估會修改的既有檔案 (**推測，需要讀過 gj_vu_3 才能確定**)
- Works Registry 資料檔：新增 TACTILE 條目。
- 導覽設定：新增 `/lab/tactile-brush`。
- 若引擎檔案放在 `src/` 之外：`next.config.*` 可能需要調整。
- 若網站使用 TypeScript：`tsconfig` 的 `allowJs`。
- ESLint 設定：可能需要忽略 `vendor/`。
- 不應碰到：現有作品頁、`/lab` 既有頁面、視窗系統、ASCII / 物件 / 錫滴實驗、作者權限。

---

## 6. 進入第二輪前必須先確認的技術衝突

這些都需要讀取 `gj_vu_3` 才能回答：

1. Next.js 版本、App Router 或 Pages Router、是否使用 `output: 'export'` (靜態匯出)。TACTILE 是純前端工具，兩種都可以，但掛載方式不同。
2. `CLAUDE.md` 與 Scope Guard 的實際規則：是否允許新增 `vendor/`、新增路由、修改 registry；研究模式是否限制寫入 localStorage。
3. `/lab` 底下的命名規範，以及 Works Registry 的 schema (ID、slug、狀態、可見性欄位)，確認 `tactile-brush` 與 `tactile` 不衝突。
4. 視窗系統的 API：TACTILE 面板能否成為它的視窗；畫布能否放進可縮放的視窗裡 (WebGL 畫布需要在視窗縮放時重新 fit)。
5. 作者模式如何判斷 (登入、環境變數、或 query)，以及 TACTILE 的編輯功能是否應該只對作者開放。
6. 版本保存與實驗紀錄機制是否能存放 TACTILE 的專案 JSON (含筆觸，約 40KB–400KB；含底圖會更大)。
7. CSP / headers：是否允許 Google Fonts、`blob:` 下載 (匯出 PNG 與 JSON 需要)、WebGL。
8. 網站現有測試指令 (`package.json` scripts)，以及 Playwright / Chromium 的版本是否與 TACTILE 測試相容。
9. TypeScript 嚴格度、ESLint、Prettier 是否會讓直接引入 JS 引擎失敗。

確認以上各點後才進入第二輪；第二輪結束時，以 `vendor/tactile-lab/tests/audit.js` 全套 + 網站原有回歸測試作為驗收。依指示，在架構確認前，單筆觸材質覆寫、IndexedDB 與高解析度匯出暫不開發。
