# 月の別荘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月面の別荘から地球の 46 億年（〜50 億年後）を早送りで眺め、ラジオで音楽を流し、隕石衝突を再現する Web 3D 空間を GitHub Pages に公開する。

**Architecture:** タイムライン（純粋関数・テスト付き）が毎フレーム `state = {year, t, params}` を出し、地球シェーダ／照明／隕石／HUD はそれを読むだけ。全アセットはプロシージャル。post は Bloom → 粒子/ビネット → OutputPass。

**Tech Stack:** three 0.185.1 (WebGL) / Vite 8.2.2 / ES Modules JS / WebAudio / Node 24 `node --test`

## Global Constraints

- three は `0.185.1` 固定、Vite `8.2.2` 固定（package.json のとおり）
- 外部モデル・外部テクスチャは使わない（Google Fonts の明朝のみ許可、失敗時はシステムフォント）
- `vite.config.js` の `base` は `/moon-villa/`
- UI 文言は日本語。年表示は 億/万 表記（例: 46億年前 / 6600万年前 / 西暦2026年 / 10億年後）
- `state` の出典は `timeline.js` の 1 箇所。他モジュールは year を自前計算しない

---

### Task 1: 骨格（index.html / vite.config / workflow / gitignore / README）

**Files:** Create `index.html`, `vite.config.js`, `.gitignore`, `.github/workflows/deploy.yml`, `README.md`, `public/music/playlist.json`, `public/music/README.md`

**Produces:** `<canvas id="scene">` と `<div id="ui">`。`import.meta.env.BASE_URL` でアセット参照。

- [ ] index.html は `src/main.js` を module 読込
- [ ] deploy.yml は checkout → setup-node 22 → npm ci → npm test → build → upload dist → deploy-pages
- [ ] `git init` → 初回コミット

### Task 2: 時間モデル（テスト先行）

**Files:** Create `src/time/epochs.js`, `src/time/timeline.js`, `test/time.test.mjs`

**Produces:**
- `TIME_KEYS: [{t, year}]` 単調増加。`yearFromT(t)`, `tFromYear(year)`（互いに逆関数）
- `formatYear(year) -> string`
- `epochParams(year) -> {magma, ocean, land, supercontinent, drift, vegetation, haze, ice, snowball, clouds, city, scorch, sunColor:[r,g,b], sunIntensity}` 全て有限・[0,1]（drift と sunIntensity を除く）
- `EVENTS: [{year, title, body, kind: 'caption'|'impact'|'giantImpact', hold?: seconds}]` 年で昇順
- `createTimeline({speed}) -> { state, play(), pause(), toggle(), setSpeed(n), seek(t), hold(sec), update(dt) -> firedEvents[] }`

- [ ] テストを書く: 逆関数性（|tFromYear(yearFromT(t)) − t| < 1e-9）、単調性、formatYear の 8 例、epochParams の 6 例（-4.6e9 magma=1 / 2026 city≥0.95 / -7e8 snowball≥0.9 / +2e9 ocean≤0.05 / -3e8 supercontinent≥0.9 / 全キーが有限）、EVENTS 昇順、timeline が再生中にイベントを 1 回だけ発火し hold 中は year が進まない
- [ ] `node --test test/` で FAIL を確認 → 実装 → PASS
- [ ] **壊して確認**: epochParams の city キーフレームを一時的に 0 にして city テストが落ちることを見る（戻す）

### Task 3: world / sky / moonSurface / noise

**Files:** Create `src/util/noise.js`（simplex 2D/3D + fbm）, `src/scene/world.js`, `src/scene/sky.js`, `src/scene/moonSurface.js`

**Produces:** `createWorld(canvas) -> {renderer, scene, camera, resize()}`；`createSky() -> Points`；`createMoonSurface() -> Mesh`

### Task 4: 地球

**Files:** Create `src/scene/earthShader.js`（vert/frag 文字列）, `src/scene/earth.js`

**Produces:** `createEarth({radius}) -> {group, update(dt, state), setImpact({dir, flash, dust, heat, ring})}`。ユニフォーム名は params のキー名に `u` を付ける（`uMagma` …）。大気殻は BackSide の別 ShaderMaterial。

### Task 5: 別荘の内装と照明

**Files:** Create `src/scene/villa.js`, `src/scene/lighting.js`

**Produces:** `createVilla() -> {group, radio: Mesh (name 'radio'), seat: Vector3, setRadioOn(bool)}`；`createLighting(scene, earthDir) -> {update(state)}`

### Task 6: 隕石演出

**Files:** Create `src/scene/meteor.js`

**Produces:** `createImpactFX({scene, earth, camera, look, radio}) -> {trigger({giant}), update(dt), active}`。trigger は `earth.setImpact` を毎フレーム駆動し、終了時に dust を残して減衰。

### Task 7: 着座視点・ポスト処理

**Files:** Create `src/controls/seatedLook.js`, `src/scene/postfx.js`

**Produces:** `createSeatedLook(camera, dom, {yaw, pitch}) -> {update(dt), shake(amount)}`；`createPostFX(renderer, scene, camera) -> {render(dt), resize(w,h)}`

### Task 8: ラジオ（音）

**Files:** Create `src/audio/radio.js`

**Produces:** `createRadio() -> {tracks, index, playing, load(playlistUrl), select(i), toggle(), next(), prev(), addFiles(FileList), setVolume(v), setAM(bool), impactSound(giant), ensureContext(), onChange(cb)}`。内蔵局「静寂」は index 0 の合成ドローン。

### Task 9: HUD

**Files:** Create `src/ui/hud.js`, `src/ui/styles.css`

**Produces:** `createHUD({timeline, radio, onMeteor}) -> {update(state), caption(ev), setRadioOpen(bool)}`。入場オーバーレイ、年代表示、キャプション、スクラバー、再生/速度、☄ 隕石、📻 ラジオパネル、アイドル時の自動非表示。

### Task 10: 結線・実機確認・公開

**Files:** Create `src/main.js`

- [ ] `vite build` が通る
- [ ] Browser pane で入場 → 地球 → 隕石 → ラジオをスクリーンショット。コンソールエラー 0
- [ ] `gh repo create moon-villa --public --source . --push` → Pages を Actions ソースで有効化 → デプロイ確認
