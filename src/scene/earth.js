import * as THREE from 'three';
import { EARTH_VERT, EARTH_FRAG, ATMO_VERT, ATMO_FRAG } from './earthShader.js';

/**
 * 地球。group を空に置き、update(dt, state) で時代パラメータをユニフォームへ流す。
 * setImpact() は隕石演出が毎フレーム呼ぶ。
 */
export function createEarth({ radius = 60, sunDir }) {
  const group = new THREE.Group();
  group.name = 'earth';

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone() },
    uSunColor: { value: new THREE.Color(1, 0.97, 0.92) },
    uSunIntensity: { value: 1 },
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
    new THREE.SphereGeometry(radius, 160, 120),
    new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
  );
  surface.name = 'earthSurface';

  const atmoUniforms = {
    uSunDir: { value: sunDir.clone() },
    uColor: { value: new THREE.Color(0.35, 0.6, 1.0) },
    uStrength: { value: 1.6 },
  };
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 96, 72),
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

  function update(dt, state) {
    const p = state.params;
    uniforms.uTime.value += dt;
    surface.rotation.y += dt * 0.018;
    uniforms.uMagma.value = p.magma;
    uniforms.uOcean.value = p.ocean;
    uniforms.uLand.value = p.land;
    uniforms.uSuper.value = p.supercontinent;
    uniforms.uDrift.value = p.drift;
    uniforms.uVeg.value = p.vegetation;
    uniforms.uHaze.value = p.haze;
    uniforms.uIce.value = p.ice;
    uniforms.uSnowball.value = p.snowball;
    uniforms.uClouds.value = p.clouds;
    uniforms.uCity.value = p.city;
    uniforms.uScorch.value = p.scorch;
    uniforms.uSunColor.value.setRGB(p.sunColor[0], p.sunColor[1], p.sunColor[2]);
    uniforms.uSunIntensity.value = p.sunIntensity;

    tmp.copy(blue).lerp(orange, p.haze).lerp(tan, p.scorch * 0.7);
    atmoUniforms.uColor.value.copy(tmp);
    atmoUniforms.uStrength.value = 1.6 * (0.55 + 0.45 * Math.min(1, p.sunIntensity)) * (1 - uniforms.uDust.value * 0.4);
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
  function setImpact({ dirLocal, flash = 0, ring = 0, ringA = 0, dust = 0, heat = 0 }) {
    if (dirLocal) uniforms.uImpactDir.value.copy(dirLocal);
    uniforms.uFlash.value = flash;
    uniforms.uRing.value = ring;
    uniforms.uRingA.value = ringA;
    uniforms.uDust.value = dust;
    uniforms.uHeat.value = heat;
  }

  /** 画面に見える側（カメラ寄り・昼側寄り）の衝突方向（ワールド）を返す */
  function visibleImpactDir(cameraPos) {
    const toCam = cameraPos.clone().sub(group.position).normalize();
    const dir = toCam.clone().addScaledVector(sunDir, 0.3);
    dir.x += (Math.random() - 0.5) * 0.45;
    dir.y += (Math.random() - 0.5) * 0.45;
    dir.z += (Math.random() - 0.5) * 0.45;
    return dir.normalize();
  }

  return { group, surface, radius, uniforms, update, setImpact, visibleImpactDir, worldToLocalDir, localToWorldDir };
}
