import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// window / dom をスタブして walk.js を無頭で駆動する
class Target {
  constructor() { this.m = new Map(); }
  addEventListener(t, h) { (this.m.get(t) ?? this.m.set(t, []).get(t)).push(h); }
  removeEventListener(t, h) { const a = this.m.get(t); if (a) this.m.set(t, a.filter((x) => x !== h)); }
  dispatch(t, e = {}) {
    e.type = t; e.stopped = false; e.prevented = false;
    e.stopPropagation = () => { e.stopped = true; };
    e.preventDefault = () => { e.prevented = true; };
    for (const h of [...(this.m.get(t) ?? [])]) h(e);
    return e;
  }
  count(t) { return (this.m.get(t) ?? []).length; }
}

const SEAT = new THREE.Vector3(0.2, 1.1, 1.32);
const SEAT_LOOK = { yaw: 0, pitch: 0.17 };
const BOUNDS = { minX: -6.1, maxX: 6.1, minZ: -4.0, maxZ: 4.6 };
const COLLIDERS = [
  { minX: -0.55, maxX: 1.75, minZ: 0.8, maxZ: 1.9 }, // デイベッド（stand 位置の正面）
  { minX: 1.8, maxX: 2.5, minZ: 0.9, maxZ: 1.5 },
  { minX: 3.9, maxX: 4.7, minZ: -3.8, maxZ: -3.0 },
  { minX: -4.9, maxX: -4.1, minZ: -3.9, maxZ: -3.1 },
  { minX: -5.4, maxX: -2.9, minZ: -4.5, maxZ: -4.05 },
  { minX: 2.9, maxX: 5.4, minZ: -4.5, maxZ: -4.05 },
];

async function setup(opts = {}) {
  const win = new Target();
  win.innerWidth = 1280;
  win.innerHeight = 720;
  globalThis.window = win;
  const dom = new Target();
  dom.classList = { add() {}, remove() {} };
  dom.setPointerCapture = () => {};
  const { createWalkControls } = await import('../src/controls/walk.js');
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 4000);
  const walk = createWalkControls(camera, dom, {
    eyeHeight: 1.62, seat: SEAT.clone(), seatLook: { ...SEAT_LOOK }, bounds: { ...BOUNDS }, colliders: COLLIDERS.map((c) => ({ ...c })), ...opts,
  });
  const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) walk.update(dt); };
  const key = (t, code, k, extra = {}) => win.dispatch(t, { code, key: k, target: { tagName: 'BODY' }, shiftKey: false, ...extra });
  const face = (dir) => walk.lookAt(walk.position.clone().add(dir), { instant: true });
  return { win, dom, camera, walk, step, key, face };
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('初期状態: 座位・座席位置・seatLook・rotation.order=YXZ', async () => {
  const { camera, walk } = await setup();
  assert.equal(walk.mode, 'seated');
  assert.ok(camera.position.equals(SEAT));
  assert.ok(near(camera.rotation.y, 0) && near(camera.rotation.x, 0.17));
  assert.equal(camera.rotation.order, 'YXZ');
});

test('座位: 移動キーは効かず、矢印は HUD へ素通し', async () => {
  const { camera, walk, step, key } = await setup();
  const e = key('keydown', 'ArrowLeft', 'ArrowLeft');
  assert.ok(!e.stopped && !e.prevented);
  key('keydown', 'KeyW', 'w');
  step(120);
  assert.ok(Math.hypot(camera.position.x - SEAT.x, camera.position.z - SEAT.z) < 0.01);
  assert.equal(walk.mode, 'seated');
});

test('座位のドラッグ: yaw ±1.4・pitch [−.6,.85] にクランプ、ポインタ中央で流れ無し', async () => {
  const { win, dom, camera, walk, step } = await setup();
  dom.dispatch('pointerdown', { button: 0, pointerType: 'mouse', clientX: 100, clientY: 100, pointerId: 1 });
  assert.ok(walk.dragging);
  win.dispatch('pointermove', { pointerType: 'mouse', clientX: -3000, clientY: 3000, pointerId: 1 });
  win.dispatch('pointerup', { pointerId: 1 });
  assert.ok(!walk.dragging);
  win.dispatch('pointermove', { pointerType: 'mouse', clientX: 640, clientY: 360, pointerId: 1 });
  step(300);
  assert.ok(near(camera.rotation.y, 1.4, 0.02), `yaw ${camera.rotation.y}`);
  assert.ok(near(camera.rotation.x, -0.6, 0.02), `pitch ${camera.rotation.x}`);
});

test('lookAt(instant) は座位のクランプ内で地球を向く', async () => {
  const { camera, walk } = await setup();
  walk.lookAt(new THREE.Vector3(12.8, 160, -619), { instant: true });
  walk.update(0);
  assert.ok(camera.rotation.y > -0.2 && camera.rotation.y < 0.2 && camera.rotation.x > 0.2);
});

test('stand: 0.6 s で座席の +z 0.9（ベッドの外側へ settle）へ、pitch 0.05', async () => {
  const { camera, walk, step } = await setup();
  walk.stand();
  assert.equal(walk.mode, 'walking');
  assert.ok(walk.transitioning);
  step(18);
  assert.ok(walk.position.y > 1.1 && walk.position.y < 1.62);
  step(30);
  assert.ok(!walk.transitioning);
  assert.ok(near(walk.position.x, 0.2, 1e-3) && near(walk.position.y, 1.62) && walk.position.z >= 2.2199 && walk.position.z <= 2.23, `pos ${walk.position.toArray()}`);
  assert.ok(near(camera.rotation.x, 0.05, 1e-3));
});

test('歩行: 矢印は止める・W で 1.6 m/s・Shift で 3.0 m/s・頭揺れ・bounds クランプ', async () => {
  const { camera, walk, step, key, face } = await setup();
  walk.stand(); step(60);
  face(new THREE.Vector3(0, 0, -1)); // ベッドが正面
  const e = key('keydown', 'ArrowUp', 'ArrowUp');
  assert.ok(e.stopped && e.prevented);
  step(60);
  key('keyup', 'ArrowUp', 'ArrowUp');
  assert.ok(walk.position.z >= 2.22 - 1e-6 && walk.position.z < 2.23, `blocked by bed z=${walk.position.z}`);
  face(new THREE.Vector3(1, 0, 0));
  const x0 = walk.position.x;
  key('keydown', 'KeyW', 'w');
  step(60);
  const x1 = walk.position.x;
  step(60);
  const x2 = walk.position.x;
  assert.ok(x1 > x0);
  assert.ok(near(x2 - x1, 1.6, 0.05), `walk ${x2 - x1}`);
  let bob = false;
  for (let i = 0; i < 30; i++) { walk.update(1 / 60); if (Math.abs(camera.position.y - 1.62) > 0.005) bob = true; }
  assert.ok(bob, 'head bob');
  key('keydown', 'ShiftLeft', 'Shift', { shiftKey: true });
  key('keydown', 'KeyW', 'w', { shiftKey: true });
  walk.position.x = 0.2;
  step(30);
  const x3 = walk.position.x; step(30); const x4 = walk.position.x;
  assert.ok(near((x4 - x3) * 2, 3.0, 0.1), `run ${(x4 - x3) * 2}`);
  key('keyup', 'ShiftLeft', 'Shift', { shiftKey: false });
  step(240);
  key('keyup', 'KeyW', 'w');
  step(60);
  assert.ok(near(walk.position.x, BOUNDS.maxX), `clamped ${walk.position.x}`);
  assert.ok(near(camera.position.y, 1.62, 1e-9), 'no bob when stopped');
});

test('衝突: 斜めに押しても膨らませた AABB に入らず面に沿って滑る', async () => {
  const { walk, step, key, face } = await setup();
  walk.stand(); step(60);
  walk.position.set(-1.5, 1.62, 0.3);
  face(new THREE.Vector3(1, 0, 0));
  key('keydown', 'KeyW', 'w'); key('keydown', 'KeyD', 'd');
  step(240);
  key('keyup', 'KeyW', 'w'); key('keyup', 'KeyD', 'd');
  const p = walk.position;
  const inBed = p.x > -0.55 - 0.32 && p.x < 1.75 + 0.32 && p.z > 0.8 - 0.32 && p.z < 1.9 + 0.32;
  assert.ok(!inBed, `inside bed (${p.x}, ${p.z})`);
  assert.ok(p.x > -0.55, 'slid along the bed toward +x');
});

test('歩行の yaw は無制限・sit で最短側へ戻り 0.9 s で座席へ・補間中は移動不可', async () => {
  const { win, dom, camera, walk, step, key } = await setup();
  walk.stand(); step(60);
  dom.dispatch('pointerdown', { button: 0, pointerType: 'touch', clientX: 0, clientY: 0, pointerId: 2 });
  win.dispatch('pointermove', { pointerType: 'touch', clientX: -4000, clientY: 0, pointerId: 2 });
  win.dispatch('pointerup', { pointerId: 2 });
  step(400);
  assert.ok(camera.rotation.y > 10, `yaw ${camera.rotation.y}`);
  walk.sit();
  assert.equal(walk.mode, 'seated');
  assert.ok(walk.transitioning);
  key('keydown', 'KeyW', 'w');
  step(27);
  assert.ok(walk.transitioning);
  step(30);
  key('keyup', 'KeyW', 'w');
  assert.ok(!walk.transitioning);
  assert.ok(walk.position.distanceTo(SEAT) < 1e-6);
  win.dispatch('pointermove', { pointerType: 'touch', clientX: 640, clientY: 360, pointerId: 2 });
  step(200);
  assert.ok(near(camera.rotation.y, 0, 0.02) && near(camera.rotation.x, 0.17, 0.02), `look ${camera.rotation.y} ${camera.rotation.x}`);
});

test('INPUT / TEXTAREA にフォーカス中の keydown は無視', async () => {
  const { win, walk, step } = await setup();
  walk.stand(); step(60);
  win.dispatch('keydown', { code: 'KeyW', key: 'w', target: { tagName: 'INPUT' } });
  step(30);
  assert.ok(near(walk.position.x, 0.2));
  const e = win.dispatch('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', target: { tagName: 'TEXTAREA' } });
  assert.ok(!e.stopped);
});

test('shake は減衰して rotation.z が 0 に戻る', async () => {
  const { camera, walk, step } = await setup();
  walk.shake(1.4);
  walk.update(1 / 60);
  step(300);
  assert.equal(camera.rotation.z, 0);
});

test('toggle と dispose', async () => {
  const { win, dom, walk, step } = await setup();
  walk.toggle(); assert.equal(walk.mode, 'walking');
  step(60);
  walk.toggle(); assert.equal(walk.mode, 'seated');
  walk.dispose();
  assert.equal(win.count('keydown'), 0);
  assert.equal(dom.count('pointerdown'), 0);
});

// ---- 以下は敵対的レビューで追加した回帰テスト

test('回帰: Shift を挟んでも押しっぱなしにならない（keydown "a" → keyup "A"）', async () => {
  const { walk, step, key, face } = await setup();
  walk.stand(); step(60);
  walk.position.set(0, 1.62, 3.5);
  face(new THREE.Vector3(0, 0, -1));
  // code が無い環境（仮想キーボード等）を模す: id は e.key 由来になる
  key('keydown', '', 'a');
  step(30);
  key('keydown', '', 'Shift', { shiftKey: true });
  key('keyup', '', 'A', { shiftKey: true });
  key('keyup', '', 'Shift', { shiftKey: false });
  step(60); // 慣性が抜けるまで
  const x0 = walk.position.x;
  step(60);
  assert.ok(near(walk.position.x, x0, 1e-3), `still moving after release: ${x0} -> ${walk.position.x}`);
});

test('回帰: 非 QWERTY 配列（code KeyZ / key w）でも前進し、keyup で止まる', async () => {
  const { walk, step, key, face } = await setup();
  walk.stand(); step(60);
  walk.position.set(0, 1.62, 3.5);
  face(new THREE.Vector3(0, 0, -1));
  key('keydown', 'KeyZ', 'w');
  step(60);
  assert.ok(walk.position.z < 3.5 - 0.5, `did not move: z=${walk.position.z}`);
  key('keyup', 'KeyZ', 'w');
  step(60);
  const z0 = walk.position.z;
  step(60);
  assert.ok(near(walk.position.z, z0, 1e-3), 'stuck after keyup');
});

test('回帰: 壊れた collider / bounds（undefined・NaN）でも位置が NaN にならない', async () => {
  const { walk, step, key, face } = await setup({
    colliders: [{ minX: -1, maxX: 1, minZ: -1, maxz: 1 }, { minX: NaN, maxX: 1, minZ: 0, maxZ: 1 }, { minX: 2, maxX: 3, minZ: 2, maxZ: 3 }],
    bounds: { minX: -6, maxX: NaN, minZ: -4, maxZ: 4 },
  });
  walk.stand(); step(60);
  walk.position.set(0, 1.62, 3.5);
  face(new THREE.Vector3(0, 0, -1));
  key('keydown', 'KeyW', 'w');
  step(300);
  const p = walk.position;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `NaN position ${p.toArray()}`);
  assert.ok(p.z < 0, 'walked through the malformed collider region without stalling');
});

test('回帰: 2 本目の指はドラッグを乗っ取らず、別ポインタの pointerup でドラッグは終わらない', async () => {
  const { win, dom, camera, walk, step } = await setup();
  walk.stand(); step(60);
  dom.dispatch('pointerdown', { button: 0, pointerType: 'touch', clientX: 500, clientY: 300, pointerId: 7 });
  dom.dispatch('pointerdown', { button: 0, pointerType: 'touch', clientX: 900, clientY: 300, pointerId: 8 });
  // 2 本目が大きく動いても視線は動かない
  win.dispatch('pointermove', { pointerType: 'touch', clientX: 100, clientY: 300, pointerId: 8 });
  win.dispatch('pointerup', { pointerId: 8 });
  step(120);
  assert.ok(near(camera.rotation.y, 0, 1e-3), `second finger moved the view: ${camera.rotation.y}`);
  assert.ok(walk.dragging, 'primary drag ended by another pointer');
  // 1 本目を動かすと動く
  win.dispatch('pointermove', { pointerType: 'touch', clientX: 400, clientY: 300, pointerId: 7 });
  step(120);
  assert.ok(camera.rotation.y > 0.3, `primary finger did not move the view: ${camera.rotation.y}`);
  win.dispatch('pointerup', { pointerId: 7 });
  assert.ok(!walk.dragging);
});

test('回帰: blur で押下とドラッグが全解除される', async () => {
  const { win, dom, walk, step, key, face } = await setup();
  walk.stand(); step(60);
  walk.position.set(0, 1.62, 3.5);
  face(new THREE.Vector3(0, 0, -1));
  key('keydown', 'KeyW', 'w');
  dom.dispatch('pointerdown', { button: 0, pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 });
  step(30);
  win.dispatch('blur', {});
  assert.ok(!walk.dragging);
  step(60);
  const z0 = walk.position.z;
  step(60);
  assert.ok(near(walk.position.z, z0, 1e-3), 'still moving after blur');
});

test('bounds / colliders / seatLook が無くても生成・更新できる', async () => {
  const { walk, step } = await setup({ bounds: undefined, colliders: undefined, seatLook: undefined });
  assert.doesNotThrow(() => { walk.stand(); step(60); walk.sit(); step(60); });
  assert.ok(Number.isFinite(walk.position.x));
});
