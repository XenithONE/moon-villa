import * as THREE from 'three';

/**
 * 太陽（時代で色と強さが変わる）・地球照・薄い環境光。
 * 室内のランプは villa.js が持つ。
 */
export function createLighting(scene, { sunDir, earthDir }) {
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
  sun.position.copy(sunDir).multiplyScalar(150);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -11;
  sc.right = 11;
  sc.top = 11;
  sc.bottom = -11;
  sc.near = 1;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const earthshine = new THREE.DirectionalLight(0x8fb4ff, 0.35);
  earthshine.position.copy(earthDir).multiplyScalar(100);
  earthshine.target.position.set(0, 0, 0);
  scene.add(earthshine, earthshine.target);

  const hemi = new THREE.HemisphereLight(0x0f131f, 0x1c1712, 0.35);
  scene.add(hemi);

  const sunBase = new THREE.Color(1.0, 0.94, 0.86);
  const shineBlue = new THREE.Color(0x8fb4ff);
  const shineOrange = new THREE.Color(0xff8a3a);
  const tmp = new THREE.Color();

  function update(state, { heat = 0, dust = 0 } = {}) {
    const p = state.params;
    sun.color.setRGB(sunBase.r * p.sunColor[0], sunBase.g * p.sunColor[1], sunBase.b * p.sunColor[2]);
    sun.intensity = 3.0 * p.sunIntensity;
    const glow = Math.max(p.magma, heat);
    const bright = 0.2 + 0.35 * p.clouds + 0.5 * p.snowball + 0.12 * p.ice + 0.1 * p.ocean;
    earthshine.intensity = 0.55 * bright * (1 - dust * 0.5) + glow * 0.35;
    tmp.copy(shineBlue).lerp(shineOrange, glow);
    earthshine.color.copy(tmp);
  }

  return { sun, earthshine, hemi, update };
}
