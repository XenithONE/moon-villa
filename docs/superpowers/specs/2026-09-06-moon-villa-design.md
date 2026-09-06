# 月の別荘 (Moon Villa) — 設計書

日付: 2026-09-06 ／ 状態: 自律モードで決定（ユーザー未承認の仮定は §7 に列挙）

## 1. 目的

月面に建つ別荘の居間に「座って」、大きな窓越しに地球を眺めるノスタルジックな Web 3D 空間。
時間は早送りで流れ、地球は誕生（46 億年前）から遠い未来（50 億年後）まで姿を変える。
傍らのラジオで音楽を選んで流せる（音源は後日ユーザーが用意）。
隕石が地球に衝突する瞬間（ジャイアント・インパクト／チクシュルーブ）を再現する。

## 2. 技術選定

| 項目 | 決定 | 理由 |
|---|---|---|
| 描画 | three.js 0.185 (WebGL) + Vite 8 | WebGPU 経路は罠が多い（Points 不描画・デバイスロスト等）。対象は普通のブラウザ全部 |
| 言語 | ES Modules の素の JavaScript | ビルド工程を減らす。型が要る規模ではない |
| アセット | 全部プロシージャル（Canvas テクスチャ・GLSL ノイズ・プリミティブ） | 外部モデル/テクスチャの入手と権利を避ける。リポジトリが軽い |
| 音 | `<audio>` + WebAudio | プレイリスト再生に加え、AM ラジオ風フィルタ・局間ノイズ・衝突音を合成 |
| 公開 | GitHub Pages (Actions) | `vite build` → `dist/` を配信。`base` はリポジトリ名 |

## 3. 構成

```
src/
  main.js               起動・ループ・各モジュールの結線
  util/noise.js         Simplex ノイズ（CPU 側：月面地形・雲用）
  scene/world.js        Renderer / Scene / Camera / resize
  scene/villa.js        別荘の内装（床・壁・窓枠・椅子・机・ラジオ・ランプ・小物）
  scene/moonSurface.js  窓の外の月面（ノイズ地形＋クレーター＋岩）
  scene/sky.js          星空（Points）＋天の川
  scene/earth.js        地球本体・大気殻（ShaderMaterial）
  scene/earthShader.js  地球の GLSL（時代パラメータで外観が連続変化）
  scene/meteor.js       隕石・閃光・衝撃波・噴出物・塵ベール
  scene/lighting.js     太陽光（時代で色が変わる）・地球照・室内灯
  scene/postfx.js       Bloom → 粒子/ビネット → OutputPass
  controls/seatedLook.js 着座視点（ドラッグ／マウス移動で見回す・上下左右に制限）
  time/epochs.js        年代→外観パラメータのキーフレーム表とイベント一覧（データ）
  time/timeline.js      正規化時間 t∈[0,1] ⇄ 年、再生/停止/速度/ホールド、イベント発火
  audio/radio.js        プレイリスト読込・再生・ノイズ・AM フィルタ・効果音
  ui/hud.js             入場画面・年代表示・キャプション・タイムライン・ラジオパネル
  ui/styles.css
public/music/playlist.json  ユーザーが曲を追記する場所
```

各モジュールは `create*(deps)` で生成し `{ object3d, update(dt, state) }` 形の小さな契約を返す。
`state` はタイムラインが毎フレーム計算する `{ year, t, params, playing }` の一点出典。
地球・照明・月面・隕石は **state を読むだけ** で、互いを参照しない。

## 4. 時間モデル

- 正規化時間 `t∈[0,1]` を折れ線で年に写像（`epochs.js` の `TIME_KEYS`）。
  46 億年前〜現在〜50 億年後を、各時代が画面上でほぼ均等に流れるよう区切る（人類の時代は対数的に密）。
- 既定速度で 1 周約 6 分。速度 0.5/1/2/4 倍。末尾で一旦止まり、数秒後に冒頭へ戻る。
- **外観パラメータ**（`epochParams(year)`）: magma / ocean / land / supercontinent / drift / vegetation / haze / ice / snowball / clouds / city / scorch / sunColor / sunIntensity。
  各パラメータは年代キーフレームを smoothstep 補間。地球シェーダはこれをユニフォームで受ける。
- **イベント**（`EVENTS`）: 年・見出し・説明・種別（caption / impact / giantImpact）。
  再生中に年を跨いだら発火。impact 系はタイムラインを **ホールド**（時間を止めて）演出を再生し、終わると再開。
  手動スクラブで跨いだ場合はキャプションだけ出す。

## 5. 地球シェーダの要点

- 大陸: 位置を `drift` でドメインワープした fbm の閾値。閾値は `land`、片寄りは `supercontinent`（パンゲア／ロディニア／未来の超大陸）。
- 表面色: マグマ（暗い地殻＋発光する亀裂・揺らぎ）→ 不毛の岩 → 緑（`vegetation`・緯度/標高で砂漠）→ 焦土（`scorch`）。
- 海: 深い青＋鏡面反射。`ocean` が減ると干上がった塩の平原に。
- 氷: 極冠（`ice`）と全球凍結（`snowball`）。
- 大気: リム発光。`haze` で初期のオレンジ（メタン）→ 青。
- 夜側: 都市の光（`city`、陸地上のノイズ点）とマグマの発光。
- 衝突: `impactDir` 周辺の閃光・広がる環・`dust`（塵ベールで全球が灰色に曇る）。

## 6. 隕石演出

1. 隕石（小さな岩＋火の尾の粒子）が画面外から地球へ 3 秒で突入
2. 衝突点で閃光スプライト＋接線方向の衝撃波リング＋噴出粒子（重力で戻る）
3. 地球ユニフォーム: `impact` → `dust` が立ち上がり数十秒かけて晴れる
4. ジャイアント・インパクトは 3 倍規模＋地球が再びマグマ化＋デブリ環（この月が生まれる、という一拍）
5. カメラ微振動・低周波の衝突音（WebAudio 合成）
6. タイムラインの該当年で自動発火するほか、HUD の「☄ 隕石」ボタンで任意に落とせる

## 7. ユーザー未確認の仮定

- リポジトリ名 `moon-villa`、**公開**（GitHub Pages を無料枠で使うため）。非公開にしたければ `gh repo edit --visibility private`
- 音源が無い間は、合成した環境音の内蔵局「静寂」だけが鳴る。曲は `public/music/` に置き `playlist.json` に追記
- UI は日本語。フォントは明朝系（Google Fonts の Shippori Mincho、失敗時はシステム明朝）
- 移動は無し（着座のまま見回すだけ）。歩き回る機能は要望があれば追加
- 未来は「海の蒸発（10 億年後）」「赤色巨星（50 億年後）」まで描く

## 8. 検証

- `vite build` が通る（ビルド成果物で確認、dev サーバでは計測しない）
- ブラウザで実際に見る: 入場 → 地球の時代変化 → 隕石 → ラジオ、のスクリーンショットを残す
- コンソールエラー 0、WebGL 警告 0
