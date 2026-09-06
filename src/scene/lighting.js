import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { qualityTier } from '../util/quality.js';

/**
 * 「円窓の黄昏」の照明（設計書 §5.1）。室内灯は持たない。
 *  - sun        逆光の夕陽。窓の外・右上やや後方（main.js の SUN_DIR）。影はこれ 1 枚だけ。
 *  - windowLight 円窓から部屋へ差す暖色の面光源（RectAreaLight。影なし）。
 *  - earthshine 地球照。地球の状態（雲・氷・マグマ・衝突の熱と塵）で色と強さが変わる。
 *  - hemi       ごく薄い環境光（空＝桃、床＝苔）。
 *
 * createLighting(scene, { sunDir, earthDir, window?, shadowBox? })
 *   -> { sun, earthshine, hemi, windowLight, update(state, { heat, dust }), shadowBox, window }
 *
 * 幾何の出典（優先順）:
 *   影カメラの範囲   shadowBox 引数 → scene 内の 'villa' の外接箱 → ROOM_BOX（設計書の部屋）
 *   窓明かりの位置   window 引数 → scene 内の 'window' / 'windowGlass' / 'glass' の外接箱 → WINDOW_DEFAULT
 * main.js は createVilla() → scene.add → createLighting の順なので、実際の別荘に自動で合う。
 */

// 部屋の外接箱（設計書 §1・§2.2。壁厚と屋根・スラブを含む）。scene に別荘が無いときの既定。
export const ROOM_BOX = { minX: -6.8, maxX: 6.8, minY: -0.5, maxY: 6.8, minZ: -5.0, maxZ: 5.3 };
// 円窓の既定（設計書）。x,y,z はガラス面の中心、width/height は面の大きさ（m）。
export const WINDOW_DEFAULT = { x: 0, y: 3.2, z: -4.4, width: 6, height: 6 };
// 影カメラの余白（m）。窓の外へ張り出す枝葉と、別荘の外側の月面（別荘の影が落ちる）の分。
const SHADOW_MARGIN = 1.0;
// 太陽の距離（m）。位置 = 部屋中心 + sunDir × SUN_DIST。方向は sunDir と厳密に一致させる。
const SUN_DIST = 150;
// 面光源をガラス面から部屋側（+z）へ寄せる距離。壁の内面より手前に置き、壁自身に遮られない。
const WINDOW_INSET = 0.1;
// 自動検出で受け入れる大きさ。これを外れる箱は別荘/窓とみなさず既定へ落とす。
const MAX_ROOM_EXTENT = 40;
const MIN_WINDOW_SIZE = 0.5;
const VILLA_NAMES = ['villa'];
const WINDOW_NAMES = ['window', 'windowGlass', 'glass'];

const SUN_BASE = new THREE.Color(0xffc9a6);
const SUN_GAIN = 1.6;
const WINDOW_BASE = new THREE.Color(0xffc4b0);
const WINDOW_GAIN = 0.5; // 0.35〜0.8 で調整可（窓際 : 奥 ≈ 3:1 が目安）
const SHINE_BLUE = new THREE.Color(0x9fc4ff);
const SHINE_ORANGE = new THREE.Color(0xff8a3a);
const HEMI_SKY = new THREE.Color(0xe9c1b5);
const HEMI_GROUND = new THREE.Color(0x1c2419);
const HEMI_GAIN = 0.6;
const LANTERN_COLOR = new THREE.Color(0xffb068);
const LANTERN_GAIN = 2.2;
const WHITE = [1, 1, 1];

function tierSafe() {
  try {
    return qualityTier();
  } catch {
    return 'high';
  }
}

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp01 = (v) => Math.min(1, Math.max(0, num(v, 0)));

/** scene 内の名前付き物体（先に見つかった 1 つ）のワールド外接箱。無い・空・非有限なら null。 */
function boundsOfNamed(scene, names) {
  if (!scene || typeof scene.getObjectByName !== 'function') return null;
  for (const name of names) {
    const obj = scene.getObjectByName(name);
    if (!obj) continue;
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) continue;
    const ok = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);
    if (ok) return b;
  }
  return null;
}

/** 影カメラが覆う箱。引数 → 'villa' の外接箱（床下のスラブ分まで） → ROOM_BOX。 */
export function resolveShadowBox(scene, override) {
  if (override) return { ...ROOM_BOX, ...override };
  const b = boundsOfNamed(scene, VILLA_NAMES);
  if (!b) return ROOM_BOX;
  const size = b.getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > MAX_ROOM_EXTENT) return ROOM_BOX;
  return {
    minX: b.min.x,
    maxX: b.max.x,
    minY: Math.min(b.min.y, ROOM_BOX.minY),
    maxY: b.max.y,
    minZ: b.min.z,
    maxZ: b.max.z,
  };
}

/** 窓明かりの面。引数 → 'window'/'windowGlass'/'glass' の外接箱 → WINDOW_DEFAULT。 */
export function resolveWindow(scene, override) {
  if (override) return { ...WINDOW_DEFAULT, ...override };
  const b = boundsOfNamed(scene, WINDOW_NAMES);
  if (!b) return WINDOW_DEFAULT;
  const size = b.getSize(new THREE.Vector3());
  if (size.x < MIN_WINDOW_SIZE || size.y < MIN_WINDOW_SIZE) return WINDOW_DEFAULT;
  const c = b.getCenter(new THREE.Vector3());
  // 窓は -z 側の壁にある前提（契約）。ガラス面の部屋側の z を面の位置とする。
  return { x: c.x, y: c.y, z: b.max.z, width: size.x, height: size.y };
}

/**
 * 平行光の正射影カメラを箱に合わせる。
 * 光軸に垂直な面での最大半径（基底に依らない）を一辺とし、near/far は光軸方向の奥行きから決める。
 * 範囲を狭く保つほど bias の実距離（bias × (far−near)）が小さくなり、接地の影が浮かない。
 */
export function fitShadowCamera(sun, sunDir, box, margin = SHADOW_MARGIN, dist = SUN_DIST) {
  const s = sunDir.clone().normalize();
  const c = new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
  const d = new THREE.Vector3();
  let maxR = 0;
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) {
        d.set(x, y, z).sub(c);
        const along = d.dot(s); // 光源へ向かう成分
        const r = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
        if (r > maxR) maxR = r;
        if (along < minAlong) minAlong = along;
        if (along > maxAlong) maxAlong = along;
      }
    }
  }
  const half = maxR + margin;
  const sc = sun.shadow.camera;
  sc.left = -half;
  sc.right = half;
  sc.top = half;
  sc.bottom = -half;
  // 光源から見た奥行き = dist − along。近側は屋根の上の余裕、遠側は別荘の影が落ちる月面の分を足す。
  sc.near = Math.max(1, dist - maxAlong - 40);
  sc.far = dist - minAlong + 60;
  sc.updateProjectionMatrix();

  sun.position.copy(c).addScaledVector(s, dist);
  sun.target.position.copy(c);
  return { center: c, half, near: sc.near, far: sc.far };
}

export function createLighting(scene, { sunDir, earthDir, window: windowOpt, shadowBox: shadowOpt } = {}) {
  RectAreaLightUniformsLib.init();
  const high = tierSafe() === 'high';
  const sDir = sunDir ? sunDir.clone() : new THREE.Vector3(0.53, 0.56, -0.64);
  const eDir = earthDir ? earthDir.clone() : new THREE.Vector3(0, 0.25, -1);
  if (sDir.lengthSq() < 1e-12) sDir.set(0, 1, 0);
  if (eDir.lengthSq() < 1e-12) eDir.set(0, 0, -1);

  // ---- 太陽（唯一の影付き光源）
  const sun = new THREE.DirectionalLight(SUN_BASE, SUN_GAIN);
  sun.castShadow = true;
  const mapSize = high ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.03;
  const shadowBox = resolveShadowBox(scene, shadowOpt);
  fitShadowCamera(sun, sDir, shadowBox);
  scene.add(sun, sun.target);

  // ---- 円窓の面光源（部屋側 +z へ放射）
  const win = resolveWindow(scene, windowOpt);
  const windowLight = new THREE.RectAreaLight(WINDOW_BASE, WINDOW_GAIN, win.width, win.height);
  windowLight.position.set(win.x, win.y, win.z + WINDOW_INSET);
  windowLight.lookAt(win.x, win.y, win.z + WINDOW_INSET + 1);
  scene.add(windowLight);

  // ---- 地球照
  const earthshine = new THREE.DirectionalLight(SHINE_BLUE, 0.25);
  earthshine.position.copy(eDir).normalize().multiplyScalar(100);
  earthshine.target.position.set(0, 0, 0);
  earthshine.castShadow = false;
  scene.add(earthshine, earthshine.target);

  // ---- 環境光
  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_GAIN);
  scene.add(hemi);

  // ---- ランタン（ラジオ台の上の油灯。歩き回るときに室内が読める最小限の暖色。影は落とさない）
  const lantern = new THREE.PointLight(LANTERN_COLOR, LANTERN_GAIN, 9, 2);
  lantern.position.set(2.55, 0.42, 0.75);
  lantern.castShadow = false;
  scene.add(lantern);

  const tint = new THREE.Color();
  const tmp = new THREE.Color();

  /** state / params が無ければ何もしない。個々の値が欠けても NaN にしない。 */
  function update(state, fx) {
    const p = state?.params;
    if (!p) return;
    const heat = clamp01(fx?.heat);
    const dust = clamp01(fx?.dust);
    const sc = Array.isArray(p.sunColor) && p.sunColor.length >= 3 ? p.sunColor : WHITE;
    tint.setRGB(num(sc[0], 1), num(sc[1], 1), num(sc[2], 1));
    const sunIntensity = Math.max(0, num(p.sunIntensity, 1));

    sun.color.copy(SUN_BASE).multiply(tint);
    sun.intensity = SUN_GAIN * sunIntensity;

    // 窓明かり＝空の照り返し＋地球の光。時代の太陽色を帯び、衝突の塵で少し弱まる。
    windowLight.color.copy(WINDOW_BASE).multiply(tint);
    windowLight.intensity = WINDOW_GAIN * (0.7 + 0.3 * sunIntensity) * (1 - 0.5 * dust);

    const glow = clamp01(Math.max(num(p.magma, 0), heat));
    const bright = 0.2 + 0.35 * clamp01(p.clouds) + 0.5 * clamp01(p.snowball) + 0.12 * clamp01(p.ice) + 0.1 * clamp01(p.ocean);
    earthshine.intensity = 0.25 * bright * (1 - 0.5 * dust) + glow * 0.3;
    tmp.copy(SHINE_BLUE).lerp(SHINE_ORANGE, glow);
    earthshine.color.copy(tmp);

    hemi.color.copy(HEMI_SKY).multiply(tint);
  }

  return { sun, earthshine, hemi, windowLight, lantern, update, shadowBox, window: win };
}
