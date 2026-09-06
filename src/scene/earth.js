import * as THREE from 'three';
import { EARTH_VERT, EARTH_FRAG, ATMO_VERT, ATMO_FRAG } from './earthShader.js';

// 地平線のすぐ上に視直径 23° で見える前提の分割数（1080p×dpr1.5 でも輪郭の弦が 8px 以下）
const SURFACE_SEGMENTS = [256, 192];
const ATMO_SEGMENTS = [192, 144];
// 大気殻の半径比（設計書 §4）と縁の基準強度
const ATMO_RADIUS = 1.06;
const ATMO_STRENGTH = 1.9;
const DEFAULT_SUN_DIR = new THREE.Vector3(0.53, 0.56, -0.64);
const WHITE = [1, 1, 1];

const num = (v, d) => (Number.isFinite(v) ? v : d);
// 時代パラメータは [0,1] の比率。シェーダの mix() は範囲外で外挿して負の色になるので必ず畳む
const ratio = (v) => Math.min(1, Math.max(0, num(v, 0)));

/**
 * 地球。group を空に置き、update(dt, state) で時代パラメータをユニフォームへ流す。
 * setImpact() は隕石演出が毎フレーム呼ぶ。
 *
 * 太陽方向は 1 本の Vector3 を表面・大気殻・visibleImpactDir で共有する。
 * 実行時に earth.uniforms.uSunDir.value を書き換えれば三者とも追従する（API 追加は不要）。
 */
export function createEarth({ radius = 60, sunDir } = {}) {
  const group = new THREE.Group();
  group.name = 'earth';

  const sunDirV = (sunDir ? sunDir.clone() : DEFAULT_SUN_DIR.clone());
  if (!(sunDirV.lengthSq() > 1e-12)) sunDirV.copy(DEFAULT_SUN_DIR);
  sunDirV.normalize();
  const uSunDir = { value: sunDirV };

  const uniforms = {
    uTime: { value: 0 },
    uSunDir,
    uSunColor: { value: new THREE.Color(1, 0.97, 0.92) },
    uSunIntensity: { value: 1 },
    // 夜側のフィル（淡い青灰・リニア直指定）。位相角 140° の細い三日月でも地球の形が読める
    uFill: { value: new THREE.Color().setRGB(0.11, 0.15, 0.21) },
    uMagma: { value: 1 },
    uOcean: { value: 0 },
    uLand: { value: 0 },
    uSuper: { value: 0 },
    uDrift: { value: 0 },
    uVeg: { value: 0 },
    uHaze: { value: 1 },
    uIce: { value: 0 },
    uSnowball: { value: 0 },
    uClouds: { value: 0 },
    uCity: { value: 0 },
    uScorch: { value: 0 },
    uImpactDir: { value: new THREE.Vector3(0, 0, 1) },
    uFlash: { value: 0 },
    uRing: { value: 0 },
    uRingA: { value: 0 },
    uDust: { value: 0 },
    uHeat: { value: 0 },
  };

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, SURFACE_SEGMENTS[0], SURFACE_SEGMENTS[1]),
    new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
  );
  surface.name = 'earthSurface';

  const atmoUniforms = {
    uSunDir, // 表面と同じユニフォームオブジェクト（同じ Vector3）
    uColor: { value: new THREE.Color(0.35, 0.6, 1.0) },
    uStrength: { value: ATMO_STRENGTH },
    // 縁の厚み（1=現在。初期の靄で厚く、焦土期に薄く、塵で少し厚く）
    uThick: { value: 1 },
  };
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * ATMO_RADIUS, ATMO_SEGMENTS[0], ATMO_SEGMENTS[1]),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmosphere.name = 'earthAtmosphere';

  // 自転軸の傾きは group、自転は surface
  group.rotation.z = THREE.MathUtils.degToRad(23.4);
  group.add(surface, atmosphere);

  const blue = new THREE.Color(0.35, 0.6, 1.0);
  const orange = new THREE.Color(1.0, 0.5, 0.2);
  const tan = new THREE.Color(0.9, 0.7, 0.45);
  const tmp = new THREE.Color();

  /** state / params が無ければ時間だけ進める。個々の値が欠けても NaN をユニフォームへ流さない */
  function update(dt, state) {
    const step = num(dt, 0);
    uniforms.uTime.value += step;
    surface.rotation.y += step * 0.018;
    const p = state?.params;
    if (!p) return;
    uniforms.uMagma.value = ratio(p.magma);
    uniforms.uOcean.value = ratio(p.ocean);
    uniforms.uLand.value = ratio(p.land);
    uniforms.uSuper.value = ratio(p.supercontinent);
    uniforms.uDrift.value = num(p.drift, 0);
    uniforms.uVeg.value = ratio(p.vegetation);
    uniforms.uHaze.value = ratio(p.haze);
    uniforms.uIce.value = ratio(p.ice);
    uniforms.uSnowball.value = ratio(p.snowball);
    uniforms.uClouds.value = ratio(p.clouds);
    uniforms.uCity.value = ratio(p.city);
    uniforms.uScorch.value = ratio(p.scorch);
    const sc = Array.isArray(p.sunColor) && p.sunColor.length >= 3 ? p.sunColor : WHITE;
    uniforms.uSunColor.value.setRGB(num(sc[0], 1), num(sc[1], 1), num(sc[2], 1));
    const sunIntensity = Math.max(0, num(p.sunIntensity, 1));
    uniforms.uSunIntensity.value = sunIntensity;

    const dust = uniforms.uDust.value;
    const haze = uniforms.uHaze.value;
    const scorch = uniforms.uScorch.value;
    tmp.copy(blue).lerp(orange, haze).lerp(tan, scorch * 0.7);
    atmoUniforms.uColor.value.copy(tmp);
    atmoUniforms.uStrength.value = ATMO_STRENGTH * (0.55 + 0.45 * Math.min(1, sunIntensity)) * (1 - dust * 0.4);
    atmoUniforms.uThick.value = THREE.MathUtils.clamp(1 + 0.35 * haze + 0.15 * dust - 0.55 * scorch, 0.35, 1.6);
  }

  const rotM = new THREE.Matrix3();

  /** ワールド方向 → surface のローカル方向（ノイズは object 空間で評価するので自転に追従する） */
  function worldToLocalDir(world, out = new THREE.Vector3()) {
    surface.updateWorldMatrix(true, false);
    rotM.setFromMatrix4(surface.matrixWorld).invert();
    return out.copy(world).applyMatrix3(rotM).normalize();
  }

  /** ローカル方向 → ワールド方向 */
  function localToWorldDir(local, out = new THREE.Vector3()) {
    surface.updateWorldMatrix(true, false);
    rotM.setFromMatrix4(surface.matrixWorld);
    return out.copy(local).applyMatrix3(rotM).normalize();
  }

  /** 隕石演出から毎フレーム呼ばれる。dirLocal は surface ローカルの衝突方向 */
  function setImpact({ dirLocal, flash = 0, ring = 0, ringA = 0, dust = 0, heat = 0 } = {}) {
    if (dirLocal && dirLocal.lengthSq() > 1e-12) uniforms.uImpactDir.value.copy(dirLocal).normalize();
    uniforms.uFlash.value = Math.max(0, num(flash, 0));
    uniforms.uRing.value = Math.max(0, num(ring, 0));
    uniforms.uRingA.value = ratio(ringA);
    uniforms.uDust.value = ratio(dust);
    uniforms.uHeat.value = ratio(heat);
  }

  /** 画面に見える側（カメラ寄り・昼側寄り）の衝突方向（ワールド）を返す */
  function visibleImpactDir(cameraPos) {
    const toCam = cameraPos.clone().sub(group.position).normalize();
    const dir = toCam.clone().addScaledVector(uSunDir.value, 0.3);
    dir.x += (Math.random() - 0.5) * 0.45;
    dir.y += (Math.random() - 0.5) * 0.45;
    dir.z += (Math.random() - 0.5) * 0.45;
    return dir.normalize();
  }

  return { group, surface, radius, uniforms, update, setImpact, visibleImpactDir, worldToLocalDir, localToWorldDir };
}
