import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLighting, fitShadowCamera, ROOM_BOX } from '../src/scene/lighting.js';
import { epochParams, NOW, YEAR_MAX } from '../src/time/epochs.js';

const SUN_DIR = new THREE.Vector3(0.53, 0.56, -0.64).normalize();
const EARTH_DIR = new THREE.Vector3(0.02, 0.25, -0.968).normalize();

function makeLighting() {
  const scene = new THREE.Scene();
  return { scene, lighting: createLighting(scene, { sunDir: SUN_DIR, earthDir: EARTH_DIR }) };
}

test('createLighting は契約どおりの 4 系統を返し、室内灯は影を落とさないランタン 1 灯だけ', () => {
  const { scene, lighting } = makeLighting();
  assert.ok(lighting.sun.isDirectionalLight);
  assert.ok(lighting.earthshine.isDirectionalLight);
  assert.ok(lighting.hemi.isHemisphereLight);
  assert.ok(lighting.windowLight.isRectAreaLight);
  assert.equal(typeof lighting.update, 'function');
  assert.equal(lighting.sun.castShadow, true);
  assert.equal(lighting.earthshine.castShadow, false);
  const points = scene.children.filter((o) => o.isPointLight || o.isSpotLight);
  assert.equal(points.length, 1, 'ランタン 1 灯のみ');
  assert.equal(points[0].castShadow, false, 'ランタンは影を落とさない（影マップは太陽 1 枚だけ）');
  assert.ok(points[0] === lighting.lantern);
});

test('太陽の向きは sunDir と一致し、地球照は earthDir から差す', () => {
  const { lighting } = makeLighting();
  const dir = lighting.sun.position.clone().sub(lighting.sun.target.position).normalize();
  assert.ok(dir.distanceTo(SUN_DIR) < 1e-6, `sun dir ${dir.toArray()}`);
  const edir = lighting.earthshine.position.clone().normalize();
  assert.ok(edir.distanceTo(EARTH_DIR) < 1e-6);
});

test('影カメラは部屋の外接箱の 8 隅を余白つきで覆う', () => {
  const { lighting } = makeLighting();
  const sun = lighting.sun;
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  sun.shadow.updateMatrices(sun);
  const cam = sun.shadow.camera;
  const v = new THREE.Vector3();
  for (const x of [ROOM_BOX.minX, ROOM_BOX.maxX]) {
    for (const y of [ROOM_BOX.minY, ROOM_BOX.maxY]) {
      for (const z of [ROOM_BOX.minZ, ROOM_BOX.maxZ]) {
        v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
        assert.ok(Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && Math.abs(v.z) < 0.95, `corner (${x},${y},${z}) -> ${v.toArray()}`);
      }
    }
  }
  // 無駄に広くもない（一辺 ≈ 20 m。2048 で約 1 cm/texel）
  assert.ok(cam.right - cam.left < 24, `width ${cam.right - cam.left}`);
  // bias の実距離（|bias|×(far−near)）が数 cm に収まる
  assert.ok(Math.abs(sun.shadow.bias) * (cam.far - cam.near) < 0.05);
});

test('fitShadowCamera は任意の光向きで箱を覆う', () => {
  const sun = new THREE.DirectionalLight();
  const box = { minX: -3, maxX: 4, minY: 0, maxY: 2, minZ: -5, maxZ: 1 };
  for (const dir of [
    [0.93, 0.14, -0.34],
    [0, 1, 0.01],
    [-0.5, 0.3, 0.8],
  ]) {
    const s = new THREE.Vector3(...dir).normalize();
    fitShadowCamera(sun, s, box, 0.5, 100);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    sun.shadow.updateMatrices(sun);
    const cam = sun.shadow.camera;
    const v = new THREE.Vector3();
    for (const x of [box.minX, box.maxX]) {
      for (const y of [box.minY, box.maxY]) {
        for (const z of [box.minZ, box.maxZ]) {
          v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
          assert.ok(Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && Math.abs(v.z) < 1, `dir ${dir} corner (${x},${y},${z}) -> ${v.toArray()}`);
        }
      }
    }
  }
});

test('update: 現在の時代で太陽 1.6、塵と熱が地球照・窓明かりに効く', () => {
  const { lighting } = makeLighting();
  const state = { params: epochParams(NOW) };
  lighting.update(state, { heat: 0, dust: 0 });
  assert.ok(Math.abs(lighting.sun.intensity - 1.6) < 1e-6);
  const win0 = lighting.windowLight.intensity;
  const shine0 = lighting.earthshine.intensity;
  assert.ok(win0 > 0.3 && win0 < 0.8, `window ${win0}`);
  assert.ok(shine0 > 0 && shine0 < 0.3, `earthshine ${shine0}`);

  lighting.update(state, { heat: 0, dust: 1 });
  assert.ok(lighting.windowLight.intensity < win0);
  assert.ok(lighting.earthshine.intensity < shine0);

  lighting.update(state, { heat: 1, dust: 0 });
  assert.ok(lighting.earthshine.intensity > shine0);
  // 熱で地球照が橙に寄る
  assert.ok(lighting.earthshine.color.r > lighting.earthshine.color.b);

  // 赤色巨星の時代: 太陽は強く赤い
  lighting.update({ params: epochParams(YEAR_MAX) });
  assert.ok(lighting.sun.intensity > 5);
  assert.ok(lighting.sun.color.r > lighting.sun.color.b * 2);
});

test('update は state が無くても落ちない', () => {
  const { lighting } = makeLighting();
  assert.doesNotThrow(() => lighting.update(undefined));
  assert.doesNotThrow(() => lighting.update({}));
});

// ---- 追加（レビュー）: 実在の別荘・窓への自動適合と、update の頑健性

test('scene に villa / glass があれば影カメラと窓明かりはその外接箱に合う', () => {
  const scene = new THREE.Scene();
  const villa = new THREE.Group();
  villa.name = 'villa';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 7), new THREE.MeshStandardMaterial());
  floor.rotation.x = -Math.PI / 2;
  villa.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 7), new THREE.MeshStandardMaterial());
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.2;
  villa.add(ceiling);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 2.3), new THREE.MeshStandardMaterial());
  glass.name = 'glass';
  glass.position.set(0, 1.75, -3.5);
  villa.add(glass);
  scene.add(villa);

  const lighting = createLighting(scene, { sunDir: SUN_DIR, earthDir: EARTH_DIR });
  // 窓明かり: ガラス面の中心・大きさに合い、部屋側（+z）へ少し入り、+z へ放射する
  const wl = lighting.windowLight;
  assert.ok(Math.abs(wl.width - 7.0) < 1e-6 && Math.abs(wl.height - 2.3) < 1e-6, `size ${wl.width}x${wl.height}`);
  assert.ok(Math.abs(wl.position.x) < 1e-6 && Math.abs(wl.position.y - 1.75) < 1e-6);
  assert.ok(wl.position.z > -3.5 && wl.position.z < -3.3, `z ${wl.position.z}`);
  wl.updateMatrixWorld(true);
  const emit = new THREE.Vector3(0, 0, -1).applyQuaternion(wl.quaternion); // RectAreaLight はローカル -z へ放射
  assert.ok(emit.z > 0.999, `emit ${emit.toArray()}`);
  // 影カメラ: 実際の部屋（8×3.2×7）に合わせて ROOM_BOX より狭い
  const cam = lighting.sun.shadow.camera;
  assert.ok(cam.right - cam.left < 16, `width ${cam.right - cam.left}`);
  assert.ok(lighting.shadowBox.maxX <= 4.01 && lighting.shadowBox.minY <= -0.5);
});

test('window / shadowBox 引数は自動検出より優先する', () => {
  const scene = new THREE.Scene();
  const lighting = createLighting(scene, {
    sunDir: SUN_DIR,
    earthDir: EARTH_DIR,
    window: { x: 0.5, y: 2, z: -4, width: 3, height: 3 },
    shadowBox: { minX: -2, maxX: 2, minY: 0, maxY: 2, minZ: -2, maxZ: 2 },
  });
  assert.equal(lighting.windowLight.width, 3);
  assert.ok(Math.abs(lighting.windowLight.position.y - 2) < 1e-6);
  assert.ok(lighting.windowLight.position.z > -4);
  assert.equal(lighting.shadowBox.maxX, 2);
});

test('update は第二引数が null/欠損でも、params の一部が欠けても NaN を出さない', () => {
  const { lighting } = makeLighting();
  assert.doesNotThrow(() => lighting.update({ params: epochParams(NOW) }, null));
  assert.doesNotThrow(() => lighting.update({ params: {} }, { heat: NaN, dust: undefined }));
  for (const l of [lighting.sun, lighting.earthshine, lighting.windowLight, lighting.hemi]) {
    assert.ok(Number.isFinite(l.intensity), `${l.type} intensity ${l.intensity}`);
    assert.ok(Number.isFinite(l.color.r + l.color.g + l.color.b), `${l.type} color`);
  }
  // 範囲外の heat/dust は畳まれる（負の強度にならない）
  lighting.update({ params: epochParams(NOW) }, { heat: 5, dust: 9 });
  assert.ok(lighting.windowLight.intensity > 0 && lighting.earthshine.intensity > 0);
});
