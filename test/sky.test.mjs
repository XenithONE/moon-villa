import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

function stubDom() {
  const ctx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  globalThis.location = { search: '?q=low' };
}

const CAMERA_FAR = 4000; // world.js の PerspectiveCamera far
let mod;

before(async () => {
  stubDom();
  mod = await import('../src/scene/sky.js');
});

function finiteColor(c) {
  return Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b);
}

test('契約: createSky() -> { group, update, setSunDir, uniforms }', () => {
  const sky = mod.createSky();
  assert.ok(sky.group.isGroup);
  assert.equal(typeof sky.update, 'function');
  assert.equal(typeof sky.setSunDir, 'function');
  assert.ok(sky.uniforms.uTime);
  for (const n of ['duskDome', 'sunDisc', 'stars', 'milkyWay']) assert.ok(sky.group.getObjectByName(n), n);
});

test('ドームは不透明・深度なし・最初に描く。星はその後', () => {
  const sky = mod.createSky();
  const dome = sky.group.getObjectByName('duskDome');
  assert.equal(dome.material.transparent, false);
  assert.equal(dome.material.depthTest, false);
  assert.equal(dome.material.depthWrite, false);
  assert.equal(dome.material.side, THREE.BackSide);
  assert.equal(dome.frustumCulled, false);
  const stars = sky.group.getObjectByName('stars');
  assert.ok(dome.renderOrder < stars.renderOrder);
  assert.equal(stars.material.depthWrite, false);
});

test('ドーム・星・太陽はカメラ far (4000) の内側', () => {
  const sky = mod.createSky();
  const dome = sky.group.getObjectByName('duskDome');
  dome.geometry.computeBoundingSphere();
  assert.ok(dome.geometry.boundingSphere.radius < CAMERA_FAR);
  for (const n of ['stars', 'milkyWay']) {
    const g = sky.group.getObjectByName(n).geometry;
    g.computeBoundingSphere();
    assert.ok(g.boundingSphere.center.length() + g.boundingSphere.radius < CAMERA_FAR, n);
  }
  assert.ok(sky.group.getObjectByName('sunDisc').position.length() < CAMERA_FAR);
});

test('update: dt / state が無くても落ちず uTime は有限。sunColor×sunIntensity が HORIZON_LINK に入る', () => {
  const sky = mod.createSky();
  assert.doesNotThrow(() => sky.update());
  assert.doesNotThrow(() => sky.update(undefined, undefined));
  assert.doesNotThrow(() => sky.update(1 / 60, {}));
  assert.doesNotThrow(() => sky.update(NaN, { params: {} }));
  assert.ok(Number.isFinite(sky.uniforms.uTime.value));
  sky.update(1 / 60, { params: { sunColor: [1, 0.45, 0.24], sunIntensity: 3.5 } });
  const c = sky.uniforms.uSunColor.value;
  assert.ok(Math.abs(c.r - 3.5) < 1e-6 && Math.abs(c.g - 0.45 * 3.5) < 1e-6);
  assert.equal(sky.uniforms.uSunColor, mod.HORIZON_LINK.uSunColor, '月面ヘイズが参照する同じ uniform');
  assert.equal(sky.uniforms.uSunDir, mod.HORIZON_LINK.uSunDir);
  const sun = sky.group.getObjectByName('sunDisc');
  assert.ok(finiteColor(sun.material.color) && sun.material.color.r > 2.5);
});

test('setSunDir: Vector3 / 配列を受け、太陽ディスクはその方向に置かれる。不正入力で NaN にならない', () => {
  const sky = mod.createSky();
  const dir = new THREE.Vector3(0.93, 0.14, -0.34).normalize();
  sky.setSunDir(dir);
  const sun = sky.group.getObjectByName('sunDisc');
  assert.ok(sun.position.clone().normalize().distanceTo(dir) < 1e-6);
  assert.ok(sky.uniforms.uSunDir.value.distanceTo(dir) < 1e-6);
  sky.setSunDir([0, 1, 0]);
  assert.ok(sky.uniforms.uSunDir.value.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  for (const bad of [undefined, null, {}, [0, 0, 0], new THREE.Vector3(NaN, 0, 0)]) {
    assert.doesNotThrow(() => sky.setSunDir(bad));
    const v = sky.uniforms.uSunDir.value;
    assert.ok(Number.isFinite(v.x + v.y + v.z) && Math.abs(v.length() - 1) < 1e-6, `bad input ${bad}`);
    assert.ok(Number.isFinite(sun.position.length()));
  }
});

test('ドームの GLSL は uniform / varying / 関数の定義が揃っている', () => {
  const sky = mod.createSky();
  const m = sky.group.getObjectByName('duskDome').material;
  for (const u of Object.keys(m.uniforms)) assert.match(m.fragmentShader, new RegExp(`uniform \\w+ ${u};`), u);
  assert.match(m.vertexShader, /varying vec3 vWorldPos;/);
  assert.match(m.fragmentShader, /varying vec3 vWorldPos;/);
  for (const fn of ['snoise', 'fbm', 'ss', 'horizonTint']) assert.match(m.fragmentShader, new RegExp(`\\b${fn}\\(`), fn);
  assert.match(m.fragmentShader, /#include <tonemapping_fragment>/);
  assert.match(m.fragmentShader, /#include <colorspace_fragment>/);
});
