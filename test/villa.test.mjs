import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { VILLA_LAYOUT } from '../src/scene/villa.js';

// createVilla() は Canvas を使うので node では呼べない。
// ここでは (1) 配置の幾何（座位・歩行開始位置・窓と地球）を walk.js と実座標で、
// (2) GLSL の差し込み先と Reflector シェーダの契約を three 本体のソースに対して静的に検証する。

const SRC_URL = new URL('../src/scene/villa.js', import.meta.url);
const L = VILLA_LAYOUT;
const seat = new THREE.Vector3().fromArray(L.seat);

// ---- (1) 幾何 ----------------------------------------------------------------

const inBox = (x, z, b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
const inflated = (c, r) => ({ minX: c.minX - r, maxX: c.maxX + r, minZ: c.minZ - r, maxZ: c.maxZ + r });

test('配置: 座位は bounds の中、家具の障害物は部屋の床の範囲内', () => {
  assert.ok(inBox(seat.x, seat.z, L.bounds), 'seat は bounds 内');
  assert.ok(seat.y > 0.6 && seat.y < 1.7, `seat.y=${seat.y}`);
  for (const c of L.colliders) {
    assert.ok(c.minX < c.maxX && c.minZ < c.maxZ, `裏返った collider ${JSON.stringify(c)}`);
    assert.ok(c.minX >= L.room.minX && c.maxX <= L.room.maxX && c.minZ >= L.room.minZ && c.maxZ <= L.room.maxZ, `部屋の外の collider ${JSON.stringify(c)}`);
  }
  // bounds は部屋の床の内側（壁厚ぶん狭い）
  assert.ok(L.bounds.minX > L.room.minX && L.bounds.maxX < L.room.maxX && L.bounds.minZ > L.room.minZ && L.bounds.maxZ < L.room.maxZ);
});

// window / dom をスタブして walk.js を無頭で駆動する（walk.test.mjs と同じ手法）
class Target {
  constructor() { this.m = new Map(); }
  addEventListener(t, h) { (this.m.get(t) ?? this.m.set(t, []).get(t)).push(h); }
  removeEventListener(t, h) { const a = this.m.get(t); if (a) this.m.set(t, a.filter((x) => x !== h)); }
}

test('配置: walk.js が villa の colliders で立ち上がった位置は障害物の外・bounds の中', async () => {
  const win = new Target();
  win.innerWidth = 1280;
  win.innerHeight = 720;
  globalThis.window = win;
  const dom = new Target();
  dom.classList = { add() {}, remove() {} };
  dom.setPointerCapture = () => {};
  const { createWalkControls } = await import('../src/controls/walk.js');
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 4000);
  const radius = 0.32;
  const walk = createWalkControls(camera, dom, {
    eyeHeight: 1.62, seat: seat.clone(), seatLook: { ...L.seatLook }, bounds: { ...L.bounds }, colliders: L.colliders.map((c) => ({ ...c })), radius,
  });
  assert.equal(walk.mode, 'seated');
  assert.ok(walk.position.distanceTo(seat) < 1e-9, '座位はちょうど seat');
  walk.stand();
  for (let i = 0; i < 90; i++) walk.update(1 / 60);
  const p = walk.position;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  assert.ok(inBox(p.x, p.z, L.bounds), `歩行開始位置 ${p.toArray()} が bounds の外`);
  for (const c of L.colliders) assert.ok(!inBox(p.x, p.z, inflated(c, radius)), `歩行開始位置 ${p.toArray()} が collider ${JSON.stringify(c)} の中`);
  // 立った所から窓へ向かって歩けること（デイベッドの脇を抜けて z<0 に届く）
  walk.lookAt(new THREE.Vector3(p.x - 2.5, 1.62, -4.5), { instant: true });
  win.m.get('keydown')?.forEach((h) => h({ code: 'KeyW', key: 'w', target: { tagName: 'BODY' }, shiftKey: false, preventDefault() {}, stopPropagation() {} }));
  for (let i = 0; i < 60 * 6; i++) walk.update(1 / 60);
  assert.ok(walk.position.z < 0, `6 秒歩いても z=${walk.position.z}（家具に塞がれている）`);
  walk.dispose?.();
  delete globalThis.window;
});

/** seat から見た地球の円盤（角半径 asin(r/d)）の縁 32 方向を窓面 z=WIN.z へ投影し、窓中心からの最大距離を返す */
function earthLimbMaxOffset(earthDir, dist, radius) {
  const w = L.window;
  const d = new THREE.Vector3().fromArray(earthDir).normalize();
  const rho = Math.asin(radius / dist);
  const a = new THREE.Vector3(0, 1, 0).cross(d).normalize();
  const b = new THREE.Vector3().crossVectors(d, a).normalize();
  let worst = 0;
  for (let k = 0; k < 32; k++) {
    const th = (k / 32) * Math.PI * 2;
    const limb = d.clone().multiplyScalar(Math.cos(rho)).addScaledVector(a, Math.sin(rho) * Math.cos(th)).addScaledVector(b, Math.sin(rho) * Math.sin(th));
    assert.ok(limb.z < 0, '地球は窓（-z）側');
    const t = (w.z - seat.z) / limb.z;
    const px = seat.x + limb.x * t;
    const py = seat.y + limb.y * t;
    worst = Math.max(worst, Math.hypot(px - w.x, py - w.y));
  }
  return worst;
}

test('幾何: 座位から見て地球の円盤が丸窓の中に収まる（設計書 §7 の推奨値と main.js の現行値）', () => {
  const rim = L.window.r - 0.1; // 内縁の Torus（管 0.06）の内側
  const design = earthLimbMaxOffset([0.02, 0.25, -0.968], 640, 128);
  assert.ok(design < rim, `設計値: 地球の縁が窓中心から ${design.toFixed(2)} m（縁 ${rim}）`);
  const current = earthLimbMaxOffset([-0.2, 0.22, -1], 620, 72);
  assert.ok(current < rim, `現行値: 地球の縁が窓中心から ${current.toFixed(2)} m（縁 ${rim}）`);
  // 座位の既定の視線（seatLook）は窓を通る
  const { yaw, pitch } = L.seatLook;
  const v = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const t = (L.window.z - seat.z) / v.z;
  const off = Math.hypot(seat.x + v.x * t - L.window.x, seat.y + v.y * t - L.window.y);
  assert.ok(off < rim, `既定の視線が窓中心から ${off.toFixed(2)} m`);
});

// ---- (2) GLSL の静的検証 ------------------------------------------------------

function declaredUniforms(src) {
  const out = new Map();
  for (const m of src.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)(?:\s*\[\s*\d+\s*\])?\s*;/gm)) out.set(m[2], m[1]);
  return out;
}
function declaredVaryings(src) {
  return new Set([...src.matchAll(/^\s*varying\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
}

test('GLSL: onBeforeCompile の差し込み先は three 0.185 の meshphysical シェーダに実在し、順序の前提が成り立つ', async () => {
  const src = await readFile(SRC_URL, 'utf8');
  const anchors = [...src.matchAll(/\.replace\(\s*'#include <(\w+)>'/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 4, `差し込み先が ${anchors.length} 箇所しか見つからない`);
  const vs = THREE.ShaderLib.physical.vertexShader;
  const fs = THREE.ShaderLib.physical.fragmentShader;
  for (const name of anchors) {
    assert.ok(name in THREE.ShaderChunk, `ShaderChunk に ${name} が無い`);
    assert.ok(vs.includes(`#include <${name}>`) || fs.includes(`#include <${name}>`), `meshphysical に #include <${name}> が無い`);
  }
  // 逆光コードは emissivemap_fragment の後ろに入り、そこでは normal と totalEmissiveRadiance が定義済みであること
  const iNormal = fs.indexOf('#include <normal_fragment_begin>');
  const iEmis = fs.indexOf('#include <emissivemap_fragment>');
  const iTotal = fs.indexOf('totalEmissiveRadiance');
  assert.ok(iNormal > 0 && iEmis > iNormal && iTotal > 0 && iTotal < iEmis);
  // 頂点側: begin_vertex（transformed 定義）→ project_vertex の順
  assert.ok(vs.indexOf('#include <begin_vertex>') < vs.indexOf('#include <project_vertex>'));
  // 差し込むコードが宣言する uniform は全て shader.uniforms に結線されている
  const blDecl = ['uSunDir', 'uSunColor', 'uWinC', 'uWinZ', 'uWinR', 'uBack', 'uTime'];
  for (const u of blDecl) assert.ok(src.includes(`shader.uniforms.${u} =`), `uniform ${u} が shader.uniforms に結線されていない`);
});

test('GLSL: Reflector の独自シェーダは color/tDiffuse/textureMatrix を保ち、uniform と varying が両段で一致する', async () => {
  const src = await readFile(SRC_URL, 'utf8');
  const block = src.slice(src.indexOf('const reflectorShader = {'), src.indexOf('const reflector = new Reflector('));
  const vsm = block.match(/vertexShader:\s*\/\* glsl \*\/\s*`([\s\S]*?)`/);
  const fsm = block.match(/fragmentShader:\s*\/\* glsl \*\/\s*`([\s\S]*?)`/);
  assert.ok(vsm && fsm, 'reflectorShader の GLSL が見つからない');
  const table = [...block.slice(0, block.indexOf('vertexShader')).matchAll(/^\s*(\w+):\s*\{\s*value:/gm)].map((m) => m[1]);
  for (const req of ['color', 'tDiffuse', 'textureMatrix']) assert.ok(table.includes(req), `Reflector が書き込む uniform ${req} が表に無い`);
  const decl = new Map([...declaredUniforms(vsm[1]), ...declaredUniforms(fsm[1])]);
  for (const name of decl.keys()) assert.ok(table.includes(name), `GLSL の uniform ${name} が表に無い`);
  assert.equal(decl.get('uDrops'), 'vec4');
  assert.ok(block.includes('uDrops: { value: [new THREE.Vector4'), 'uDrops は Vector4 の配列');
  const vv = declaredVaryings(vsm[1]);
  const fv = declaredVaryings(fsm[1]);
  assert.deepEqual([...vv].sort(), [...fv].sort(), 'varying が頂点と断片で一致しない');
  // GLSL の smoothstep は edge0<edge1 が前提。降順の呼び出しが無いこと（JS 側の smoothstep は降順可なので混同しやすい）
  for (const m of fsm[1].matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) assert.ok(+m[1] < +m[2], `smoothstep(${m[1]}, ${m[2]})`);
});

test('契約: createVilla の戻り値と Reflector の除外リストが揃っている', async () => {
  const src = await readFile(SRC_URL, 'utf8');
  const ret = src.match(/return \{([^}]*)\};\s*\}\s*$/);
  assert.ok(ret, 'return 文が見つからない');
  const keys = ret[1].split(',').map((s) => s.trim()).filter(Boolean);
  for (const k of ['group', 'radio', 'seat', 'seatLook', 'bounds', 'colliders', 'update', 'setRadioOn', 'setRadioNeedle', 'figure', 'setSunDir']) {
    assert.ok(keys.includes(k), `戻り値に ${k} が無い`);
  }
  // layers は使わない（main.js の camera.layers 設定に依存しない）
  assert.ok(!/\.layers\.(set|enable|mask)/.test(src), 'layers を使っている');
  // 反射から除外する 8 系統（葉×2・落葉・落ち葉・小石・苔・紙片・埃）
  assert.equal((src.match(/noReflect\.push\(/g) ?? []).length, 7, 'noReflect.push の数（scatterCanopy は 2 回呼ばれる）');
});
