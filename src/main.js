import * as THREE from 'three';
import './ui/styles.css';
import { createWorld } from './scene/world.js';
import { createSky } from './scene/sky.js';
import { createMoonSurface } from './scene/moonSurface.js';
import { createVilla } from './scene/villa.js';
import { createEarth } from './scene/earth.js';
import { createLighting } from './scene/lighting.js';
import { createImpactFX } from './scene/meteor.js';
import { createPostFX } from './scene/postfx.js';
import { createSeatedLook } from './controls/seatedLook.js';
import { createTimeline } from './time/timeline.js';
import { createRadio } from './audio/radio.js';
import { createHUD } from './ui/hud.js';

// 月面の夕暮れ：太陽は右手の地平線近く。地球は窓の左上、半分だけ照らされている。
const SUN_DIR = new THREE.Vector3(0.93, 0.14, -0.34).normalize();
const EARTH_DIR = new THREE.Vector3(-0.2, 0.22, -1).normalize();
const EARTH_DIST = 620;
const EARTH_RADIUS = 72;

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

const { renderer, scene, camera, resize } = createWorld(canvas);

scene.add(createSky());
const moon = createMoonSurface();
scene.add(moon.group);
const villa = createVilla();
scene.add(villa.group);

const earth = createEarth({ radius: EARTH_RADIUS, sunDir: SUN_DIR });
earth.group.position.copy(EARTH_DIR).multiplyScalar(EARTH_DIST);
scene.add(earth.group);

const lighting = createLighting(scene, { sunDir: SUN_DIR, earthDir: EARTH_DIR });

camera.position.copy(villa.seat);
const look = createSeatedLook(camera, canvas, { baseYaw: 0, basePitch: 0.12 });
// 最初は地球の少し下（窓枠と部屋が入る構図）を見る
look.lookAt(earth.group.position.clone().addScaledVector(new THREE.Vector3(0, -1, 0), 70), { instant: true });

const post = createPostFX(renderer, scene, camera);
const timeline = createTimeline({ speed: 1, cycleSeconds: 360 });
const radio = createRadio();
radio.load(`${import.meta.env.BASE_URL}music/playlist.json`, import.meta.env.BASE_URL);
const fx = createImpactFX({ scene, earth, camera, look, radio });

const hud = createHUD({
  root: uiRoot,
  timeline,
  radio,
  onMeteor: () => {
    if (fx.trigger({ giant: false })) timeline.hold(12);
  },
  onSeek: () => {
    if (fx.active) fx.cancel();
  },
  onEnter: () => {
    radio.ensureContext();
    radio.select(0, true);
    radio.setVolume(0.45);
    timeline.play();
    const ev = timeline.currentEvent();
    if (ev) hud.caption(ev);
  },
});

radio.onChange((st) => {
  villa.setRadioOn(st.playing);
  villa.setRadioNeedle(st.tracks.length > 1 ? st.index / (st.tracks.length - 1) : 0.1);
});

// 3D のラジオをクリック／ホバー
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downX = 0;
let downY = 0;
function radioHit(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(villa.radio, true).length > 0;
}
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
  if (radioHit(e)) hud.setRadioOpen(true);
});
let hoverTick = 0;
canvas.addEventListener('pointermove', (e) => {
  if (++hoverTick % 3) return;
  canvas.classList.toggle('hover-radio', !look.dragging && radioHit(e));
});

// サイズは毎フレーム照合する（非表示タブで起動すると 0×0 のまま resize が来ないことがある）
const sizeNow = new THREE.Vector2();
function ensureSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w < 2 || h < 2) return false;
  renderer.getSize(sizeNow);
  if (sizeNow.x !== w || sizeNow.y !== h) {
    resize();
    post.resize(w, h);
  }
  return true;
}
window.addEventListener('resize', ensureSize);

// ---- ループ
const clock = new THREE.Clock();
let frames = 0;
function frame(dtOverride) {
  const dt = typeof dtOverride === 'number' ? dtOverride : Math.min(0.1, clock.getDelta());
  if (!ensureSize()) return;
  const fired = timeline.update(dt);
  for (const ev of fired) {
    hud.caption(ev);
    if (ev.kind === 'impact' || ev.kind === 'giantImpact') {
      fx.trigger({ giant: ev.kind === 'giantImpact' });
    }
  }
  const state = timeline.state;
  earth.update(dt, state);
  lighting.update(state, { heat: earth.uniforms.uHeat.value, dust: earth.uniforms.uDust.value });
  villa.update(dt);
  fx.update(dt);
  look.update(dt);
  hud.update(state);
  post.render(dt);
  if (++frames === 2) document.body.classList.add('ready');
}
// setAnimationLoop はタイムスタンプを渡してくるので dt と取り違えないよう包む
renderer.setAnimationLoop(() => frame());

// デバッグ用の窓口（ブラウザ検証で使う）
window.__moonVilla = {
  timeline, radio, fx, earth, camera, renderer, hud, look, post, villa, lighting, scene, THREE,
  /** 検証用：1 フレーム進める（rAF が止まる環境でも状態を進められる） */
  step(dt = 1 / 60) {
    frame(dt);
    return { frames, year: timeline.state.year, t: timeline.state.t, fxPhase: fx.phase };
  },
  get frames() {
    return frames;
  },
};
