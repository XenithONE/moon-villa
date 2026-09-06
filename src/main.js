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
import { createWalkControls } from './controls/walk.js';
import { createTimeline } from './time/timeline.js';
import { createRadio } from './audio/radio.js';
import { createHUD } from './ui/hud.js';
import { qualityTier } from './util/quality.js';

// v2「円窓の黄昏」: 太陽は窓の外・右上やや後方（逆光）。地球は円窓の中央、地平線のすぐ上に巨大に。
const SUN_DIR = new THREE.Vector3(0.53, 0.56, -0.64).normalize();
const EARTH_DIR = new THREE.Vector3(0.02, 0.25, -0.968).normalize();
const EARTH_DIST = 640;
const EARTH_RADIUS = 128;
const EXPOSURE = 1.0;

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

const tier = qualityTier();
const { renderer, scene, camera, resize } = createWorld(canvas);
renderer.setPixelRatio(tier === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1);
renderer.toneMappingExposure = EXPOSURE;

const sky = createSky();
sky.setSunDir(SUN_DIR);
scene.add(sky.group);
const moon = createMoonSurface();
scene.add(moon.group);
const villa = createVilla();
villa.setSunDir?.(SUN_DIR);
scene.add(villa.group);

const earth = createEarth({ radius: EARTH_RADIUS, sunDir: SUN_DIR });
earth.group.position.copy(EARTH_DIR).multiplyScalar(EARTH_DIST);
scene.add(earth.group);

// 照明は別荘を scene に入れた後に（窓とシャドウ範囲をシーンから読む）
const lighting = createLighting(scene, { sunDir: SUN_DIR, earthDir: EARTH_DIR });

// 視点：デイベッドに座る／立って歩く
const look = createWalkControls(camera, canvas, {
  eyeHeight: 1.62,
  seat: villa.seat,
  seatLook: villa.seatLook,
  bounds: villa.bounds,
  colliders: villa.colliders,
});

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
  onSit: () => {
    look.toggle();
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
hud.setSeated(true);

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
let lastTime = performance.now();
let frames = 0;
let lastMode = null;
function frame(dtOverride) {
  const now = performance.now();
  const dt = typeof dtOverride === 'number' ? dtOverride : Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (!ensureSize()) return;
  const fired = timeline.update(dt);
  for (const ev of fired) {
    hud.caption(ev);
    if (ev.kind === 'impact' || ev.kind === 'giantImpact') {
      fx.trigger({ giant: ev.kind === 'giantImpact' });
    }
  }
  const state = timeline.state;
  sky.update(dt, state);
  earth.update(dt, state);
  lighting.update(state, { heat: earth.uniforms.uHeat.value, dust: earth.uniforms.uDust.value });
  villa.update(dt, state);
  fx.update(dt);
  look.update(dt);
  if (look.mode !== lastMode) {
    lastMode = look.mode;
    // 立って歩いている間は、寝椅子に白衣の人物が座って眺めている
    if (villa.figure) villa.figure.visible = look.mode === 'walking';
    hud.setSeated(look.mode === 'seated');
  }
  hud.update(state);
  post.render(dt);
  if (++frames === 2) document.body.classList.add('ready');
}
// setAnimationLoop はタイムスタンプを渡してくるので dt と取り違えないよう包む
renderer.setAnimationLoop(() => frame());

// デバッグ用の窓口（ブラウザ検証で使う）
window.__moonVilla = {
  timeline, radio, fx, earth, camera, renderer, hud, look, post, villa, lighting, sky, moon, scene, THREE, tier,
  /** 検証用：1 フレーム進める（rAF が止まる環境でも状態を進められる） */
  step(dt = 1 / 60) {
    frame(dt);
    return { frames, year: timeline.state.year, t: timeline.state.t, fxPhase: fx.phase, mode: look.mode };
  },
  get frames() {
    return frames;
  },
};
