import * as THREE from 'three';
import { createNoise, smoothstep } from '../util/noise.js';
import { qualityTier } from '../util/quality.js';
import { HORIZON, HORIZON_LINK, HORIZON_TINT_GLSL } from './sky.js';

// 月面「皺の大地」。ridged fbm の皺と遠景の山稜、遠くほど地平線色（HORIZON）へ溶かす頂点ヘイズ。
// 地形の高さは 0.018·d（仰角 1°）で頭打ちにし、地球下端（仰角 2.9°）の視線を遮らない。
// ヘイズ色は sky.js の HORIZON_LINK（太陽方位・時代の太陽色）を同じ uniform で参照し、ドームの地平線色と一致させる。

const SIZE = 2000;
const BASE_Y = -0.35; // 別荘の床(y=0)より少し低い
/** 地平線色（月面ヘイズ＝黄昏ドームの地平線色）。sky.js の値をそのまま再公開（同値が構造的に保証される）。 */
export { HORIZON };

/** qualityTier は location/document を触るので、ヘッドレス（テスト）や埋め込みで失敗しても high で続行する。 */
function tierSafe() {
  try {
    return qualityTier();
  } catch {
    return 'high';
  }
}

function makeRegolithTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const noise = createNoise(99);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // タイル可能にするため周期座標でサンプリング
      const a = (x / s) * Math.PI * 2;
      const b = (y / s) * Math.PI * 2;
      const nx = Math.cos(a) * 3;
      const ny = Math.sin(a) * 3;
      const nz = Math.cos(b) * 3;
      const nw = Math.sin(b) * 3;
      const n = noise.fbm3(nx + nz, ny + nw, nz - nx, 4) * 0.5 + 0.5;
      const grain = (noise.noise3(x * 0.9, y * 0.9, 3.3) * 0.5 + 0.5) * 0.25;
      // 平均 ≈ 0.70 (sRGB) ≈ 0.46 (linear)。頂点色（≈0.29 linear）との積で反射率 ≈ 0.12〜0.16（月の高地並み）
      const v = Math.round(255 * Math.min(1, Math.max(0, 0.7 + (n - 0.5) * 0.5 + grain - 0.12)));
      const i = (y * s + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** タイル可能な法線マップ。トーラス座標の fbm を 1−|n| で皺にし、Sobel で法線化する。 */
function makeRegolithNormalMap() {
  const s = 512;
  const noise = createNoise(131);
  const h = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const a = (x / s) * Math.PI * 2;
      const b = (y / s) * Math.PI * 2;
      const nx = Math.cos(a) * 2.5;
      const ny = Math.sin(a) * 2.5;
      const nz = Math.cos(b) * 2.5;
      const nw = Math.sin(b) * 2.5;
      const n = noise.fbm3(nx + nz, ny + nw, nz - nx, 4);
      h[y * s + x] = 1 - Math.abs(n);
    }
  }
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const strength = 20;
  const at = (x, y) => h[((y + s) % s) * s + ((x + s) % s)];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const gx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      // canvas の y は下向き・テクスチャは flipY なので、+y(=+v) 成分は canvas 下方向の勾配
      let vx = (-gx / 8) * strength;
      let vy = (gy / 8) * strength;
      let vz = 1;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx /= len;
      vy /= len;
      vz /= len;
      const i = (y * s + x) * 4;
      img.data[i] = Math.round((vx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((vy * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 多項式 smooth-min。常に min(a,b) 以下（上限の保証を崩さない）。 */
function smin(a, b, k) {
  const t = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - t * t * k * 0.25;
}

/** 月面地形。heightAt(x,z) を公開し、岩や別荘の基礎が同じ高さを使えるようにする。 */
export function createMoonSurface() {
  const tier = tierSafe();
  const SEG = tier === 'low' ? 200 : 320;
  const ROCKS = 300;

  const noise = createNoise(7);
  const rand = noise.rand;

  // クレーター（別荘周辺 40m は空ける）。リムが視線を遮るもの（rim/dist > 0.015）は棄却して置き直す。
  const craters = [];
  let guard = 0;
  while (craters.length < 70 && guard++ < 4000) {
    const ang = rand() * Math.PI * 2;
    const dist = 45 + Math.pow(rand(), 0.7) * 800;
    const r = 3 + Math.pow(rand(), 2.2) * 45;
    const depth = r * (0.12 + rand() * 0.12);
    if ((depth * 0.32) / dist > 0.015) continue;
    craters.push({ x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, r, depth });
  }
  // 遠景の大クレーター 3 つ（地平線の起伏）
  craters.push({ x: -420, z: -620, r: 260, depth: 34 });
  craters.push({ x: 560, z: -480, r: 190, depth: 26 });
  craters.push({ x: 120, z: 720, r: 220, depth: 24 });

  // heightAt の副産物（頂点色用の皺の強さ）。毎頂点のオブジェクト生成を避けるためモジュール変数で受け渡す。
  let lastRidge = 0;

  function heightAt(x, z) {
    const d = Math.sqrt(x * x + z * z);
    // 皺（ridged fbm）：遠くほど高く、山稜になる
    const ridge = 1 - Math.abs(noise.fbm2(x * 0.02 + 200, z * 0.02, 3));
    lastRidge = ridge;
    let h =
      noise.fbm2(x * 0.0035, z * 0.0035, 4) * 5.0 +
      ridge * ridge * (0.6 + 2.2 * smoothstep(80, 500, d)) +
      (1 - Math.abs(noise.noise2(x * 0.09, z * 0.09))) * 0.3;
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const dd = Math.sqrt(dx * dx + dz * dz) / c.r;
      if (dd < 1.7) {
        const bowl = dd < 1 ? -(1 - dd * dd) * c.depth : 0;
        const rim = Math.exp(-(dd - 1.0) * (dd - 1.0) * 16) * c.depth * 0.32;
        h += bowl + rim;
      }
    }
    h *= smoothstep(9, 24, d);
    // 地平線を仰角 1° 以下に抑える（地球下端 2.9° の視線を遮らない）。角は上限の 12% 幅で丸めるが上限は超えない。
    if (d > 9) {
      const cap = 0.018 * d;
      h = smin(h, cap, 0.12 * cap);
    }
    return BASE_Y + h;
  }

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const haze = new Float32Array(pos.count);
  const base = new THREE.Color(0x8e9aa6);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    const ridge = lastRidge;
    pos.setY(i, y);
    const d = Math.sqrt(x * x + z * z);
    const k = 0.9 + 0.12 * noise.fbm2(x * 0.01 + 50, z * 0.01, 3) + 0.15 * ridge * ridge;
    colors[i * 3] = base.r * k;
    colors[i * 3 + 1] = base.g * k;
    colors[i * 3 + 2] = base.b * k;
    haze[i] = smoothstep(150, 1000, d) * 0.97;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('haze', new THREE.BufferAttribute(haze, 1));
  geo.computeVertexNormals();

  const uHaze = { value: new THREE.Color(HORIZON) };
  // 色味は頂点色（base × k）が持つ。material.color まで灰色にすると 3 つの灰色の積で反射率が 3% まで落ちて月面が黒くなる。
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: makeRegolithTexture(),
    normalMap: makeRegolithNormalMap(),
    normalScale: new THREE.Vector2(0.6, 0.6),
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHaze = uHaze;
    // sky.js と同じ uniform オブジェクト（sky.update / setSunDir が書く）。main.js の結線は不要。
    shader.uniforms.uSunDir = HORIZON_LINK.uSunDir;
    shader.uniforms.uSunColor = HORIZON_LINK.uSunColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float haze;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying float vHaze;
varying vec3 vHazeCol;
${HORIZON_TINT_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vHaze = haze;
// ヘイズ色 = 地平線色 × ドームの地平線（仰角 0）と同じ倍率。方位は原点基準（ドームと同じ）。y=0 にして xz だけ渡す
vec3 hzDir = (modelMatrix * vec4(transformed, 1.0)).xyz;
hzDir.y = 0.0;
vHazeCol = uHaze * horizonTint(hzDir, uSunDir, uSunColor, 1.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHaze;\nvarying vec3 vHazeCol;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, vHazeCol, vHaze);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'moonHaze';

  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.name = 'moon';

  const group = new THREE.Group();
  group.name = 'moonSurface';
  group.add(ground);

  // 岩（InstancedMesh 1 draw）
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockPos = rockGeo.attributes.position;
  for (let i = 0; i < rockPos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rockPos, i);
    const n = 1 + noise.noise3(v.x * 1.7, v.y * 1.7, v.z * 1.7) * 0.28;
    v.multiplyScalar(n);
    rockPos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d8590, roughness: 1, metalness: 0 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
  rocks.name = 'rocks';
  {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    for (let i = 0; i < ROCKS; i++) {
      const ang = rand() * Math.PI * 2;
      const dist = 14 + Math.pow(rand(), 1.4) * 406;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const s = 0.25 + Math.pow(rand(), 2.5) * 3.25;
      p.set(x, heightAt(x, z) - s * 0.25, z);
      e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      q.setFromEuler(e);
      sc.set(s * (0.8 + rand() * 0.5), s * (0.6 + rand() * 0.5), s * (0.8 + rand() * 0.5));
      m.compose(p, q, sc);
      rocks.setMatrixAt(i, m);
    }
    rocks.instanceMatrix.needsUpdate = true;
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  group.add(rocks);

  // 別荘の基礎スラブ（暗いコンクリート）。部屋 x∈[−6.5,6.5] z∈[−4.5,5] と壁厚をまとめて受ける。
  // 上面は別荘の床（y=0）と同一平面にすると Z ファイトするので 2 cm 下げる。底面 −0.52 は地形（−0.35）より下＝浮かない。
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(14.2, 0.5, 11),
    new THREE.MeshStandardMaterial({ color: 0x2e2b29, roughness: 0.9 }),
  );
  slab.position.set(0, -0.27, 0.25);
  slab.receiveShadow = true;
  slab.name = 'slab';
  group.add(slab);

  return { group, heightAt };
}
