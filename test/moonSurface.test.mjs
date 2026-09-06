import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Canvas / location の最小スタブ（テクスチャ生成と qualityTier が触る分だけ）
function stubDom() {
  const ctx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  globalThis.location = { search: '?q=low' };
}

const BASE_Y = -0.35;
const CAP = 0.018; // 仰角 ≈ 1°
let moon;
let sky;

before(async () => {
  stubDom();
  ({ createMoonSurface: globalThis.__cms } = await import('../src/scene/moonSurface.js'));
  sky = await import('../src/scene/sky.js');
  moon = globalThis.__cms();
});

test('契約: { group, heightAt } と moon / rocks / slab', () => {
  assert.ok(moon.group.isGroup);
  assert.equal(typeof moon.heightAt, 'function');
  assert.ok(moon.group.getObjectByName('moon')?.isMesh);
  assert.ok(moon.group.getObjectByName('rocks')?.isInstancedMesh);
  assert.ok(moon.group.getObjectByName('slab')?.isMesh);
});

test('HORIZON は sky.js と同値', async () => {
  const m = await import('../src/scene/moonSurface.js');
  assert.equal(m.HORIZON, sky.HORIZON);
});

test('地形: 別荘周辺 d≤9 は平坦、d>9 は 0.018·d を超えない（格子 10 m）', () => {
  for (let d = 0; d <= 9; d += 1.5) {
    assert.equal(moon.heightAt(d, 0), BASE_Y);
    assert.equal(moon.heightAt(0, -d), BASE_Y);
  }
  let capped = 0;
  for (let x = -1000; x <= 1000; x += 10) {
    for (let z = -1000; z <= 1000; z += 10) {
      const d = Math.hypot(x, z);
      if (d <= 9) continue;
      const h = moon.heightAt(x, z) - BASE_Y;
      assert.ok(Number.isFinite(h), `NaN at ${x},${z}`);
      assert.ok(h <= CAP * d + 1e-9, `h=${h} > cap=${CAP * d} at ${x},${z}`);
      if (h > CAP * d - 1e-6) capped++;
    }
  }
  assert.ok(capped > 0, '上限が一度も効いていない（上限の検査が空振り）');
});

test('座位から見た地形の最大仰角は 1° 未満（地球下端 2.9° を遮らない）', () => {
  const seat = new THREE.Vector3(0, 1.22, 1.55);
  let maxEl = -Infinity;
  for (let x = -1000; x <= 1000; x += 10) {
    for (let z = -1000; z <= 1000; z += 10) {
      const dd = Math.hypot(x - seat.x, z - seat.z);
      if (dd < 3) continue;
      const el = Math.atan2(moon.heightAt(x, z) - seat.y, dd);
      if (el > maxEl) maxEl = el;
    }
  }
  assert.ok((maxEl * 180) / Math.PI < 1.0, `max elevation ${(maxEl * 180) / Math.PI}°`);
});

test('頂点に NaN が無く、法線も有限', () => {
  const geo = moon.group.getObjectByName('moon').geometry;
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]));
  for (let i = 0; i < nrm.length; i++) assert.ok(Number.isFinite(nrm[i]));
  assert.ok(geo.attributes.haze, 'haze 属性');
  assert.ok(geo.attributes.color, 'color 属性');
});

test('スラブ: 上面は床 y=0 より下（Z ファイト回避）、底面は地形より下（浮かない）', () => {
  const slab = moon.group.getObjectByName('slab');
  slab.geometry.computeBoundingBox();
  const top = slab.geometry.boundingBox.max.y + slab.position.y;
  const bottom = slab.geometry.boundingBox.min.y + slab.position.y;
  assert.ok(top < 0 && top > -0.05, `slab top ${top}`);
  const bb = slab.geometry.boundingBox;
  for (const x of [bb.min.x, bb.max.x]) {
    for (const z of [bb.min.z, bb.max.z]) {
      assert.ok(bottom < moon.heightAt(x + slab.position.x, z + slab.position.z), `corner ${x},${z}`);
    }
  }
});

test('岩は別荘の床範囲（|x|,|z| < 7）に入らず、地形に埋まる', () => {
  const rocks = moon.group.getObjectByName('rocks');
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < rocks.count; i++) {
    rocks.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    assert.ok(Math.hypot(p.x, p.z) > 7, `rock ${i} at ${p.x},${p.z}`);
    assert.ok(p.y <= moon.heightAt(p.x, p.z) + 1e-9, `rock ${i} floats`);
  }
});

test('ヘイズは sky.js の HORIZON_LINK と同じ uniform を参照する（結線なしで色が一致）', () => {
  const mat = moon.group.getObjectByName('moon').material;
  assert.equal(mat.color.getHex(), 0xffffff, 'material.color は白（頂点色と map の積だけで反射率を決める）');
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n', fragmentShader: '#include <common>\n#include <opaque_fragment>\n' };
  mat.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uSunDir, sky.HORIZON_LINK.uSunDir);
  assert.equal(shader.uniforms.uSunColor, sky.HORIZON_LINK.uSunColor);
  assert.match(shader.vertexShader, /horizonTint\(/);
  assert.match(shader.fragmentShader, /mix\(outgoingLight, vHazeCol, vHaze\)/);
});
