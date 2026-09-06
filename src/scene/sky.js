import * as THREE from 'three';
import { createRandom, smoothstep } from '../util/noise.js';
import { NOISE_GLSL } from './earthShader.js';

// 空：黄昏ドーム（地平線近くだけ桃色→水色のパステル、天頂は黒）＋太陽ディスク＋星（2 系統）。
// 月に大気は無いが、参考画像に寄せた「月の黄昏」という芸術的解釈。

/** 地平線色（黄昏ドームの地平線色＝月面ヘイズ色）。moonSurface.js と同値。 */
export const HORIZON = 0xedc6b4;
const DOME_RADIUS = 2400;
const SUN_DIST = 2300;
const DEFAULT_SUN_DIR = new THREE.Vector3(0.53, 0.56, -0.64).normalize();

/**
 * ドームの太陽方位と時代の太陽色（sunColor × sunIntensity）。setSunDir / update が書く。
 * moonSurface.js のヘイズは同じ uniform オブジェクトを参照するので、地平線で月面とドームの色が継ぎ目なく一致する。
 */
export const HORIZON_LINK = {
  uSunDir: { value: DEFAULT_SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
};

/**
 * 地平線色に掛ける倍率（太陽方位の増光 × 時代の太陽色）。ドームと月面ヘイズで同じ式を使う。
 * dir は原点基準の方向（xz だけ使う。天頂・原点で xz=0 でも NaN にならない）。wAz / wCol は仰角による減衰（地平線で 1）。
 */
export const HORIZON_TINT_GLSL = /* glsl */ `
vec3 horizonTint(vec3 dir, vec3 sunDir, vec3 sunColor, float wAz, float wCol) {
  vec2 hxz = dir.xz;
  float hl = max(length(hxz), 1e-4);
  vec2 sxz = sunDir.xz;
  float sl = max(length(sxz), 1e-4);
  float sunAz = max(0.0, dot(hxz / hl, sxz / sl));
  return (1.0 + 0.35 * pow(sunAz, 6.0) * wAz) * mix(vec3(1.0), sunColor, 0.5 * wCol);
}
`;

function makeStarSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSunSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const DOME_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

// 仰角 e（rad）で帯を積む。e<0 は地平線色のまま（月面の縁が溶ける）。
const DOME_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec3 uC5;
uniform vec3 uBand;
varying vec3 vWorldPos;

${NOISE_GLSL}
${HORIZON_TINT_GLSL}

// 端点が逆順でも定義される smoothstep
float ss(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec3 dir = normalize(vWorldPos);
  float e = asin(clamp(dir.y, -1.0, 1.0));

  vec3 c = uHorizon;
  c = mix(c, uC1, ss(0.0, 0.05, e));
  c = mix(c, uC2, ss(0.05, 0.16, e));
  c = mix(c, uC3, ss(0.16, 0.34, e));
  c = mix(c, uC4, ss(0.34, 0.62, e));
  c = mix(c, uC5, ss(0.62, 1.10, e));

  // 太陽方位の増光（地平線近くだけ）と時代の色（太陽の色・強さ）。月面ヘイズと同じ関数（地平線で一致）
  c *= horizonTint(dir, uSunDir, uSunColor, ss(0.7, 0.0, e), ss(0.5, 0.0, e));

  // 雲帯：地平線の少し上に横長の淡い筋。方位は dir.xz で継ぎ目無く回す
  float bandMask = ss(0.03, 0.09, e) * ss(0.30, 0.15, e);
  if (bandMask > 0.001) {
    vec3 np = vec3(dir.x * 2.2, e * 28.0, dir.z * 2.2) + vec3(0.0, 0.0, uTime * 0.01);
    float band = bandMask * ss(0.15, 0.55, fbm(np));
    c = mix(c, uBand, band * 0.45);
  }

  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * 空。黄昏ドーム（BackSide・不透明・先描き）、太陽ディスク（Sprite・加算・Bloom で滲む）、
 * 星（明るい星＋天の川。地平線近くはパステル帯に沈む）。
 * 戻り値: { group, update(dt, state), setSunDir(v3), uniforms }
 */
export function createSky({ radius = 2600 } = {}) {
  const group = new THREE.Group();
  group.name = 'sky';
  const sprite = makeStarSprite();
  const rand = createRandom(20260906);

  // --- 黄昏ドーム
  const uniforms = {
    uSunDir: HORIZON_LINK.uSunDir,
    uSunColor: HORIZON_LINK.uSunColor,
    uTime: { value: 0 },
    uHorizon: { value: new THREE.Color(HORIZON) },
    uC1: { value: new THREE.Color(0xf4c6a4) },
    uC2: { value: new THREE.Color(0xecc9cb) },
    uC3: { value: new THREE.Color(0xbfdce8) },
    uC4: { value: new THREE.Color(0x5b6f8e) },
    uC5: { value: new THREE.Color(0x070a14) },
    uBand: { value: new THREE.Color(0xf7dcc8) },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 48, 32),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      transparent: false,
      depthWrite: false,
      depthTest: false,
    }),
  );
  dome.name = 'duskDome';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  group.add(dome);

  // --- 太陽ディスク（視直径 ≈ 2.5°。座位では窓枠の右外、歩くと見える）
  const sunMat = new THREE.SpriteMaterial({
    map: makeSunSprite(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const sunBase = new THREE.Color(2.5, 2.2, 1.9);
  sunMat.color.copy(sunBase);
  const sun = new THREE.Sprite(sunMat);
  sun.name = 'sunDisc';
  sun.scale.set(100, 100, 1);
  group.add(sun);

  // --- 明るい星
  {
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // 球面上に一様
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(phi) * radius;
      pos[i * 3 + 1] = u * radius;
      pos[i * 3 + 2] = r * Math.sin(phi) * radius;
      // 色温度の散らばりと明るさ（べき分布で暗い星が多い）。地平線近くはパステル帯に沈める
      const temp = rand();
      if (temp < 0.12) tmp.setRGB(0.75, 0.82, 1.0);
      else if (temp < 0.8) tmp.setRGB(1.0, 0.98, 0.94);
      else tmp.setRGB(1.0, 0.85, 0.65);
      const b = (0.22 + Math.pow(rand(), 3.2) * 0.78) * smoothstep(0.03, 0.45, u);
      col[i * 3] = tmp.r * b;
      col[i * 3 + 1] = tmp.g * b;
      col[i * 3 + 2] = tmp.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.6,
      sizeAttenuation: false,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    stars.name = 'stars';
    stars.frustumCulled = false;
    stars.renderOrder = -999;
    group.add(stars);
  }

  // --- 天の川（傾いた大円に沿って濃く散らす）
  {
    const n = 9000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const axis = new THREE.Vector3(0.55, 0.72, -0.42).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const v = new THREE.Vector3();
    const rr = radius * 0.98;
    for (let i = 0; i < n; i++) {
      const phi = rand() * Math.PI * 2;
      // 帯からの高さ：ガウスっぽく
      const g = (rand() + rand() + rand() - 1.5) * 0.16;
      const r = Math.sqrt(Math.max(0, 1 - g * g));
      v.set(r * Math.cos(phi), g, r * Math.sin(phi)).applyQuaternion(q).multiplyScalar(rr);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      const b = (0.05 + Math.pow(rand(), 2.5) * 0.45) * smoothstep(0.03, 0.45, v.y / rr);
      const warm = rand() * 0.15;
      col[i * 3] = (0.8 + warm) * b;
      col[i * 3 + 1] = (0.82 + warm * 0.4) * b;
      col[i * 3 + 2] = (0.95 - warm * 0.5) * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.0,
      sizeAttenuation: false,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const band = new THREE.Points(geo, mat);
    band.name = 'milkyWay';
    band.frustumCulled = false;
    band.renderOrder = -999;
    group.add(band);
  }

  /**
   * 太陽方向（ワールド）。ドームの増光方位と太陽ディスクの位置を更新する。
   * Vector3 か [x,y,z] を受ける。零ベクトル・非数は既定方向に戻す（NaN が uniform に入るとドーム全体が壊れるため）。
   */
  function setSunDir(v) {
    const d = uniforms.uSunDir.value;
    if (Array.isArray(v)) d.fromArray(v);
    else if (v && typeof v.x === 'number') d.copy(v);
    else return;
    if (!Number.isFinite(d.x + d.y + d.z) || d.lengthSq() < 1e-12) d.copy(DEFAULT_SUN_DIR);
    d.normalize();
    sun.position.copy(d).multiplyScalar(SUN_DIST);
  }
  setSunDir(DEFAULT_SUN_DIR);

  /** 毎フレーム。state.params.sunColor / sunIntensity で地平線の色と太陽の明るさが変わる。dt・state が無くても落ちない。 */
  function update(dt, state) {
    if (Number.isFinite(dt)) uniforms.uTime.value += dt;
    const p = state?.params;
    if (!p) return;
    const si = Number.isFinite(p.sunIntensity) ? p.sunIntensity : 1;
    const sc = Array.isArray(p.sunColor) && p.sunColor.length >= 3 ? p.sunColor : [1, 1, 1];
    uniforms.uSunColor.value.setRGB(sc[0] * si, sc[1] * si, sc[2] * si);
    sunMat.color.setRGB(sunBase.r * sc[0] * si, sunBase.g * sc[1] * si, sunBase.b * sc[2] * si);
  }

  return { group, update, setSunDir, uniforms };
}
