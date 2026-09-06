import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom, createNoise, smoothstep, lerp, clamp } from '../util/noise.js';
import { qualityTier } from '../util/quality.js';

// 「円窓の黄昏」
// 部屋: x∈[-6.5,6.5] z∈[-4.5,5.0] 高 6.5、床 y=0。窓壁 z∈[-5.0,-4.5]、円窓 中心 (0,3.2) r3.0（窓面 z=-4.5）。
// 座位は seat、視線は -z（窓）。室内灯は無く、太陽（窓越し）・地球照・窓明かりだけで照らす。
// 床の反射に映さない物（葉・落ち葉・小石・苔・紙片・埃）は Reflector の内部描画の間だけ visible=false にする
// （Reflector 自身が自分を隠すのと同じ手法）。layers は使わないので main.js 側の camera.layers 設定は不要。

const ROOM = { minX: -6.5, maxX: 6.5, minZ: -4.5, maxZ: 5.0, height: 6.5, width: 13, depth: 9.5 };
const WIN = { x: 0, y: 3.2, z: -4.5, r: 3.0 };
const DEG = Math.PI / 180;

/**
 * 配置の確定値（設計書 §2.1）。createVilla() はこれを複製して返す。
 * このモジュールは import しただけでは DOM に触れない（document は createVilla() 内でのみ使う）ので、
 * テストはこの定数を読んで walk.js の契約（bounds / colliders）や窓と地球の幾何を検証できる。
 */
export const VILLA_LAYOUT = Object.freeze({
  room: { ...ROOM },
  window: { ...WIN },
  seat: [0.2, 1.1, 1.32], // 座位の目の位置（デイベッドの上）
  seatLook: { yaw: 0.0, pitch: 0.17 },
  bounds: { minX: -6.1, maxX: 6.1, minZ: -4.0, maxZ: 4.6 },
  colliders: [
    { minX: -0.55, maxX: 1.75, minZ: 0.8, maxZ: 1.9 }, // デイベッド
    { minX: 1.8, maxX: 2.5, minZ: 0.9, maxZ: 1.5 }, // ラジオ台
    { minX: 3.9, maxX: 4.7, minZ: -3.8, maxZ: -3.0 }, // 右木幹
    { minX: -4.9, maxX: -4.1, minZ: -3.9, maxZ: -3.1 }, // 左株
    { minX: -5.4, maxX: -2.9, minZ: -4.5, maxZ: -4.05 }, // 左幕
    { minX: 2.9, maxX: 5.4, minZ: -4.5, maxZ: -4.05 }, // 右幕
  ],
});

// 水たまり (x, z, r)。座位から床 z∈[-4.5,0] が窓と地球を映すので窓寄りに集める。
const PUDDLES = [
  [0.3, -3.2, 1.3], [-1.6, -2.2, 1.0], [1.9, -1.4, 0.8], [-0.4, -0.6, 0.7],
  [-3.4, -3.6, 0.9], [3.2, -3.0, 0.7], [-2.6, 0.6, 0.6], [1.2, 2.6, 0.5],
];
// 水滴の波紋（周期 s）
const DROPS = [
  { x: 0.3, z: -3.2, period: 5.5 },
  { x: -1.6, z: -2.2, period: 7.0 },
  { x: -3.4, z: -3.6, period: 4.2 },
];
// 楓の葉色（暗→明の順、重み付き）。外側ほど明色。
const LEAF_PALETTE = [
  { hex: 0x5e1a12, w: 1 }, { hex: 0x7a1f14, w: 3 }, { hex: 0x9c2a17, w: 3 }, { hex: 0xb3431f, w: 2 }, { hex: 0xc9603a, w: 2 },
];
const GROUND_LEAF_COLORS = [0x5a2a1a, 0x7a3a20, 0x8a4a2a, 0x3c1e12];

// ---------------------------------------------------------------------------
// 小道具

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function toTexture(canvas, { repeat = [1, 1], srgb = true, aniso = 8, wrap = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloneTexture(tex, repeat) {
  const t = tex.clone();
  t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

const hexRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const rgbStr = (r, g, b) => `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`;

const randUnit = (rand, out = new THREE.Vector3()) => {
  const u = rand() * 2 - 1;
  const ph = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(ph), u, r * Math.sin(ph));
};
const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());

// ---------------------------------------------------------------------------
// Canvas テクスチャ

function makeWallCanvas(rand, noise) {
  const s = 512;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) {
    const yy = y / s;
    for (let x = 0; x < s; x++) {
      const n = (rand() - 0.5) * 24;
      let r = 0x3b + n;
      let g = 0x35 + n;
      let b = 0x32 + n;
      if (yy > 0.82) {
        // 下 18% は fbm>0.3 の所を苔色へ
        const f = noise.fbm2(x * 0.03, y * 0.03, 3) * 1.5 + 0.1;
        const k = smoothstep(0.3, 0.5, f) * smoothstep(0.82, 0.9, yy);
        r = lerp(r, 0x2f + n * 0.5, k);
        g = lerp(g, 0x3a + n * 0.5, k);
        b = lerp(b, 0x2a + n * 0.5, k);
      }
      const i = (y * s + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 縦染み 24 本
  for (let k = 0; k < 24; k++) {
    const w = 8 + rand() * 22;
    const x = rand() * s;
    const y0 = rand() * s * 0.4;
    const len = s * (0.3 + rand() * 0.7);
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, 'rgba(18,14,12,0)');
    grad.addColorStop(0.2, 'rgba(18,14,12,0.25)');
    grad.addColorStop(1, 'rgba(18,14,12,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - w / 2, y0, w, len);
  }
  return c;
}

function makeCurtainCanvas(rand, noise) {
  const s = 512;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a8331c';
  ctx.fillRect(0, 0, s, s);
  // 縦筋（幅 3〜9px・明度 ±12%）
  let x = 0;
  while (x < s) {
    const w = 3 + rand() * 6;
    const k = 1 + (rand() * 2 - 1) * 0.12;
    ctx.fillStyle = rgbStr(0xa8 * k, 0x33 * k, 0x1c * k);
    ctx.fillRect(x, 0, w + 0.5, s);
    x += w;
  }
  // 裾 15% を #5a2a20 へ滲ませる
  const y0 = Math.floor(s * 0.78);
  const img = ctx.getImageData(0, y0, s, s - y0);
  const d = img.data;
  const h = s - y0;
  for (let y = 0; y < h; y++) {
    const yy = (y0 + y) / s;
    for (let px = 0; px < s; px++) {
      const wob = noise.noise2(px * 0.04, yy * 40) * 0.05;
      const t = smoothstep(0.85, 1.0, yy + wob) * (0.85 + 0.15 * noise.noise2(px * 0.2, y * 0.2));
      const i = (y * s + px) * 4;
      d[i] = lerp(d[i], 0x5a, t);
      d[i + 1] = lerp(d[i + 1], 0x2a, t);
      d[i + 2] = lerp(d[i + 2], 0x20, t);
    }
  }
  ctx.putImageData(img, 0, y0);
  return c;
}

/** 5 裂の楓。r(θ)=.55+.45·|cos(2.5θ)|^.6（θ∈[-100°,100°]）。地は明るく、tint（instanceColor）を通す。 */
function makeLeafCanvas() {
  const s = 128;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  const cx = 64;
  const cy = 76;
  const R = 52;
  const rr = (th) => 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(2.5 * th)), 0.6);
  const a0 = -100 * DEG;
  const a1 = 100 * DEG;
  ctx.beginPath();
  for (let i = 0; i <= 140; i++) {
    const th = a0 + ((a1 - a0) * i) / 140;
    const r = R * rr(th);
    const x = cx + Math.sin(th) * r;
    const y = cy - Math.cos(th) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(cx, cy + R * 0.12);
  ctx.closePath();
  ctx.fillStyle = '#f0e0d0';
  ctx.fill();
  // 葉脈
  ctx.strokeStyle = '#6a2a20';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  for (const th of [0, 72 * DEG, -72 * DEG, 100 * DEG, -100 * DEG]) {
    const r = R * rr(th) * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, cy + R * 0.08);
    ctx.lineTo(cx + Math.sin(th) * r, cy - Math.cos(th) * r);
    ctx.stroke();
  }
  // 茎
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy + R * 0.1);
  ctx.lineTo(cx, cy + R * 0.5);
  ctx.stroke();
  return c;
}

/** 罫線＋乱筆の手紙 */
function makePaperCanvas(rand) {
  const s = 256;
  const c = makeCanvas(s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9dfc8';
  ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(90,100,140,0.35)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    const y = 26 + k * 15.5;
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(s - 14, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(40,30,20,0.35)';
  ctx.lineCap = 'round';
  for (let k = 0; k < 40; k++) {
    const line = Math.floor(rand() * 14);
    const y = 26 + line * 15.5 - 3;
    const x0 = 18 + rand() * 40;
    const len = 30 + rand() * 150;
    ctx.lineWidth = 1 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    let x = x0;
    while (x < Math.min(s - 16, x0 + len)) {
      const nx = x + 4 + rand() * 6;
      ctx.quadraticCurveTo(x + 2, y - 5 + rand() * 10, nx, y + (rand() - 0.5) * 4);
      x = nx;
    }
    ctx.stroke();
  }
  return c;
}

function makeDustSprite() {
  const c = makeCanvas(32);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// 床: 高さ場 → albedo / roughness / normal / 反射マスク

function buildFloorMaps(noise, rand) {
  const N = 512;
  const h = new Float32Array(N * N);
  const pud = new Float32Array(N * N);
  const wet = new Float32Array(N * N);
  const det = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = ROOM.minZ + (ROOM.depth * (j + 0.5)) / N;
    const wall = smoothstep(-1, -4.3, z);
    for (let i = 0; i < N; i++) {
      const x = ROOM.minX + (ROOM.width * (i + 0.5)) / N;
      const a = noise.fbm2(x * 0.6, z * 0.6, 4);
      const b = noise.fbm2(x * 2.5 + 7, z * 2.5, 3);
      let F = 0;
      for (const p of PUDDLES) {
        const dx = x - p[0];
        const dz = z - p[1];
        F += (p[2] * p[2]) / Math.max(1e-3, dx * dx + dz * dz);
      }
      const hv = a + 0.5 * b - 0.12 * wall - 0.35 * smoothstep(0.9, 1.4, F);
      const k = j * N + i;
      h[k] = hv;
      det[k] = b;
      pud[k] = smoothstep(-0.16, -0.26, hv);
      wet[k] = smoothstep(0.08, -0.14, hv);
    }
  }

  // 苔ブロブ 50 個（世界座標で円を描く）
  const mc = makeCanvas(N);
  const mctx = mc.getContext('2d');
  mctx.setTransform(N / ROOM.width, 0, 0, N / ROOM.depth, (-ROOM.minX * N) / ROOM.width, (-ROOM.minZ * N) / ROOM.depth);
  for (let k = 0; k < 50; k++) {
    const r = 0.3 + rand() * 0.9;
    let x;
    let z;
    if (rand() < 0.55) {
      // 壁際
      const side = Math.floor(rand() * 4);
      const t = rand();
      const off = rand() * 0.6;
      if (side === 0) { x = ROOM.minX + off; z = lerp(ROOM.minZ, ROOM.maxZ, t); }
      else if (side === 1) { x = ROOM.maxX - off; z = lerp(ROOM.minZ, ROOM.maxZ, t); }
      else if (side === 2) { x = lerp(ROOM.minX, ROOM.maxX, t); z = ROOM.minZ + off; }
      else { x = lerp(ROOM.minX, ROOM.maxX, t); z = ROOM.maxZ - off; }
    } else {
      x = lerp(ROOM.minX, ROOM.maxX, rand());
      z = lerp(ROOM.minZ, ROOM.maxZ, rand());
    }
    const g = mctx.createRadialGradient(x, z, 0, x, z, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(x, z, r, 0, Math.PI * 2);
    mctx.fill();
  }
  const mdata = mctx.getImageData(0, 0, N, N).data;
  const moss = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const blob = mdata[k * 4] / 255;
    moss[k] = smoothstep(0.25, 0.6, blob * (0.65 + 0.7 * det[k])) * (1 - pud[k]);
  }

  const samp = (arr, fx, fy) => {
    const x = clamp(fx - 0.5, 0, N - 1.001);
    const y = clamp(fy - 0.5, 0, N - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, N - 1);
    const y1 = Math.min(y0 + 1, N - 1);
    const tx = x - x0;
    const ty = y - y0;
    return lerp(lerp(arr[y0 * N + x0], arr[y0 * N + x1], tx), lerp(arr[y1 * N + x0], arr[y1 * N + x1], tx), ty);
  };

  // --- albedo 1024²
  const M = 1024;
  const mapC = makeCanvas(M);
  const mapCtx = mapC.getContext('2d');
  const mapImg = mapCtx.createImageData(M, M);
  const md = mapImg.data;
  const sites = [];
  for (let k = 0; k < 28; k++) sites.push({ x: rand() * M, y: rand() * M, tint: 1 + (rand() - 0.5) * 0.1 });
  const c0 = hexRgb(0x2e2a26);
  const c1 = hexRgb(0x4a4744);
  const cEdge = hexRgb(0x151212);
  const m0 = hexRgb(0x3d4a25);
  const m1 = hexRgb(0x55642f);
  const ratio = N / M;
  for (let py = 0; py < M; py++) {
    const fy = (py + 0.5) * ratio;
    for (let px = 0; px < M; px++) {
      const fx = (px + 0.5) * ratio;
      const hv = samp(h, fx, fy);
      const p = samp(pud, fx, fy);
      const w = samp(wet, fx, fy);
      const ms = samp(moss, fx, fy);
      const dv = samp(det, fx, fy);
      // Voronoi 28 セル
      let d1 = 1e12;
      let d2 = 1e12;
      let tint = 1;
      for (let k = 0; k < 28; k++) {
        const s = sites[k];
        const dx = px - s.x;
        const dy = py - s.y;
        const dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; d1 = dd; tint = s.tint; }
        else if (dd < d2) d2 = dd;
      }
      const edge = 1 - smoothstep(1.0, 4.0, Math.sqrt(d2) - Math.sqrt(d1));
      const t = smoothstep(-0.2, 0.35, hv);
      let r = lerp(c0[0], c1[0], t) * tint;
      let g = lerp(c0[1], c1[1], t) * tint;
      let b = lerp(c0[2], c1[2], t) * tint;
      r = lerp(r, cEdge[0], edge * 0.85);
      g = lerp(g, cEdge[1], edge * 0.85);
      b = lerp(b, cEdge[2], edge * 0.85);
      const mt = clamp(0.5 + dv, 0, 1);
      r = lerp(r, lerp(m0[0], m1[0], mt), ms);
      g = lerp(g, lerp(m0[1], m1[1], mt), ms);
      b = lerp(b, lerp(m0[2], m1[2], mt), ms);
      const dark = (1 - 0.45 * p) * (1 - 0.12 * w) * (1 + (rand() - 0.5) * 0.12);
      const i = (py * M + px) * 4;
      md[i] = r * dark;
      md[i + 1] = g * dark;
      md[i + 2] = b * dark;
      md[i + 3] = 255;
    }
  }
  mapCtx.putImageData(mapImg, 0, 0);

  // --- roughness（G）・normal・反射マスク 512²
  const rc = makeCanvas(N);
  const rctx = rc.getContext('2d');
  const rimg = rctx.createImageData(N, N);
  const nc = makeCanvas(N);
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(N, N);
  const kc = makeCanvas(N);
  const kctx = kc.getContext('2d');
  const kimg = kctx.createImageData(N, N);
  const H = (x, y) => h[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)];
  const STR = 2.0 * 30;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      let rough = lerp(0.78, 0.32, wet[k]);
      rough = lerp(rough, 0.34, pud[k]);
      rough = lerp(rough, 0.9, moss[k]);
      const rv = Math.round(rough * 255);
      rimg.data[k * 4] = rv;
      rimg.data[k * 4 + 1] = rv;
      rimg.data[k * 4 + 2] = rv;
      rimg.data[k * 4 + 3] = 255;
      // Sobel
      const gx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) / 8;
      const gy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) / 8;
      // v は上向き（canvas の -y）なので G は +gy
      let nx = -gx * STR;
      let ny = gy * STR;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const flat = pud[k];
      nx = lerp(nx, 0, flat);
      ny = lerp(ny, 0, flat);
      nz = lerp(nz, 1, flat);
      nimg.data[k * 4] = (nx * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      nimg.data[k * 4 + 3] = 255;
      kimg.data[k * 4] = pud[k] * 255;
      kimg.data[k * 4 + 1] = wet[k] * 255;
      kimg.data[k * 4 + 2] = moss[k] * 255;
      kimg.data[k * 4 + 3] = 255;
    }
  }
  rctx.putImageData(rimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  kctx.putImageData(kimg, 0, 0);

  const map = toTexture(mapC, { wrap: false });
  const roughnessMap = toTexture(rc, { srgb: false, wrap: false });
  const normalMap = toTexture(nc, { srgb: false, wrap: false });
  const maskTex = toTexture(kc, { srgb: false, wrap: false, aniso: 1 });
  return { map, roughnessMap, normalMap, maskTex };
}

// ---------------------------------------------------------------------------
// 楓（幹枝は再帰でシリンダを積んで 1 メッシュに）

function buildTree(cfg, rand) {
  const geos = [];
  const branches = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const rnd = new THREE.Vector3();

  function segment(start, dirIn, len, rBot, rTop, level, lineage) {
    const d = dirIn.clone();
    d.z = Math.max(d.z, -0.15); // 窓壁（z=-4.5）に刺さらない
    if (start.z < -4.1) d.z = Math.max(d.z, 0.05);
    if (start.y > 6.1) d.y = Math.min(d.y, -0.1);
    d.normalize();
    let L = len;
    if (d.z < 0) L = Math.min(L, (start.z + 4.2) / -d.z);
    if (d.z > 0) L = Math.min(L, (4.8 - start.z) / d.z);
    if (d.x < 0) L = Math.min(L, (start.x + 6.2) / -d.x);
    if (d.x > 0) L = Math.min(L, (6.2 - start.x) / d.x);
    if (d.y > 0) L = Math.min(L, (6.35 - start.y) / d.y);
    if (d.y < 0) L = Math.min(L, (start.y - 0.3) / -d.y);
    L = Math.max(L, 0.08);
    const end = start.clone().addScaledVector(d, L);
    const g = new THREE.CylinderGeometry(rTop, rBot, L, 7, 1);
    g.translate(0, L / 2, 0);
    q.setFromUnitVectors(UP, d);
    g.applyQuaternion(q);
    g.translate(start.x, start.y, start.z);
    geos.push(g);
    const b = { start: start.clone(), end, dir: d, len: L, level, lineage };
    branches.push(b);
    return b;
  }
  const childDir = (parent, keep, upBias) => {
    randUnit(rand, rnd);
    rnd.y += upBias;
    rnd.normalize();
    return parent.dir.clone().multiplyScalar(keep).addScaledVector(rnd, 1 - keep).normalize();
  };

  const trunk = segment(cfg.base, cfg.trunkDir, cfg.trunkH, cfg.trunkR0, cfg.trunkR1, 0, false);
  let level = [];
  for (const b of cfg.l1) {
    const dir = b.dir
      ? b.dir.clone()
      : new THREE.Vector3(Math.cos(b.az) * Math.cos(b.el), Math.sin(b.el), Math.sin(b.az) * Math.cos(b.el));
    level.push(segment(trunk.end, dir, b.len, cfg.levels[0].r, cfg.levels[0].rt, 1, !!b.lineage));
  }
  for (let li = 1; li < cfg.levels.length; li++) {
    const sp = cfg.levels[li];
    const next = [];
    for (const p of level) {
      for (let c = 0; c < sp.n; c++) {
        const t = c === sp.n - 1 ? 1 : 0.5 + rand() * 0.45;
        const start = p.start.clone().lerp(p.end, t);
        const dir = childDir(p, p.lineage ? 0.6 : 0.45, sp.up);
        next.push(segment(start, dir, p.len * sp.k * (0.8 + rand() * 0.4), sp.r, sp.rt, li + 1, p.lineage));
      }
    }
    level = next;
  }
  const geometry = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  return { geometry, branches };
}

// ---------------------------------------------------------------------------

export function createVilla() {
  const rand = createRandom(4242);
  const noise = createNoise(11);
  const high = qualityTier() === 'high';
  const group = new THREE.Group();
  group.name = 'villa';

  // 呼び出し側が書き換えても VILLA_LAYOUT が汚れないよう複製して返す
  const seat = new THREE.Vector3().fromArray(VILLA_LAYOUT.seat);
  const seatLook = { ...VILLA_LAYOUT.seatLook };
  const bounds = { ...VILLA_LAYOUT.bounds };
  const colliders = VILLA_LAYOUT.colliders.map((c) => ({ ...c }));

  // ---- 共有ユニフォーム（逆光・時間）
  const TIME_U = { value: 0 };
  const BL = {
    uSunDir: { value: new THREE.Vector3(0.53, 0.56, -0.64).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
    uWinC: { value: new THREE.Vector2(WIN.x, WIN.y) },
    uWinZ: { value: WIN.z },
    uWinR: { value: WIN.r },
  };
  const sunBase = new THREE.Color(1, 0.9, 0.8);

  /** 薄物（葉・幕・布・衣）の透過逆光。円窓を通る光柱の解析マスク cone で窓の外側を弱める。 */
  function addBacklight(mat, { strength = 0.4, wind = false } = {}) {
    const uBack = { value: strength };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = BL.uSunDir;
      shader.uniforms.uSunColor = BL.uSunColor;
      shader.uniforms.uWinC = BL.uWinC;
      shader.uniforms.uWinZ = BL.uWinZ;
      shader.uniforms.uWinR = BL.uWinR;
      shader.uniforms.uBack = uBack;
      shader.uniforms.uTime = TIME_U;
      const windCode = wind
        ? `
#ifdef USE_INSTANCING
  transformed.xy += uv.y * ( sin( uTime * 0.9 + instanceMatrix[3].x * 1.7 + instanceMatrix[3].y * 0.7 ) * 0.012 + sin( uTime * 2.3 + instanceMatrix[3].z * 2.1 ) * 0.004 );
#endif`
        : '';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBlWorld;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>${windCode}`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
  vec4 blp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    blp = instanceMatrix * blp;
  #endif
  vBlWorld = ( modelMatrix * blp ).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uWinC;
uniform float uWinZ;
uniform float uWinR;
uniform float uBack;
varying vec3 vBlWorld;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  {
    vec3 sv = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
    float bl = max( 0.0, -dot( normal, sv ) );
    float tt = ( uWinZ - vBlWorld.z ) / min( uSunDir.z, -1e-3 );
    vec2 q = vBlWorld.xy + uSunDir.xy * tt;
    float cone = 1.0 - smoothstep( uWinR - 0.6, uWinR + 0.3, length( q - uWinC ) );
    totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uBack * bl * bl * ( 0.25 + 0.75 * cone );
  }`,
        );
    };
    mat.customProgramCacheKey = () => (wind ? 'backlight-wind' : 'backlight');
    return mat;
  }

  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  /** 床の反射（Reflector の内部描画）に映さない物。inner render の間だけ visible=false にする。 */
  const noReflect = [];

  // =====================================================================
  // 躯体
  const wallCanvas = makeWallCanvas(rand, noise);
  const wallTexBack = toTexture(wallCanvas, { repeat: [2, 1] });
  const wallTexSide = cloneTexture(wallTexBack, [1.6, 1]);
  const wallTexWin = cloneTexture(wallTexBack, [0.25, 1 / ROOM.height]);
  const wallMatBack = new THREE.MeshStandardMaterial({ map: wallTexBack, roughness: 0.95 });
  const wallMatSide = new THREE.MeshStandardMaterial({ map: wallTexSide, roughness: 0.95 });
  const wallMatWin = new THREE.MeshStandardMaterial({ map: wallTexWin, roughness: 0.95 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x231f1d, roughness: 0.95 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1f1611, roughness: 0.9 });

  const box = (w, h, d, mat, x, y, z, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m, opts);
  };
  box(13.6, 6.5, 0.3, wallMatBack, 0, 3.25, 5.15); // 後
  box(0.3, 6.5, 10.1, wallMatSide, -6.65, 3.25, 0.25); // 左
  box(0.3, 6.5, 10.1, wallMatSide, 6.65, 3.25, 0.25); // 右
  box(13.6, 0.3, 10.1, ceilingMat, 0, 6.65, 0.25); // 天井（屋根が太陽を遮る）
  {
    const beams = [];
    for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
      const g = new THREE.BoxGeometry(0.22, 0.3, 9.5);
      g.translate(x, 6.35, 0.25);
      beams.push(g);
    }
    add(new THREE.Mesh(mergeGeometries(beams), beamMat));
  }

  // 円窓壁（矩形 − 円 を +z へ押し出し、z∈[-5.0,-4.5]）
  {
    const shape = new THREE.Shape();
    shape.moveTo(-6.8, 0);
    shape.lineTo(6.8, 0);
    shape.lineTo(6.8, ROOM.height);
    shape.lineTo(-6.8, ROOM.height);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(WIN.x, WIN.y, WIN.r, 0, Math.PI * 2, false);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false, curveSegments: 96 });
    const wall = new THREE.Mesh(geo, wallMatWin);
    wall.position.z = -5.0;
    add(wall);
  }

  // 内縁＋不規則な桟（1 メッシュ）
  {
    const parts = [];
    const torus = new THREE.TorusGeometry(WIN.r, 0.06, 8, 96);
    torus.translate(WIN.x, WIN.y, WIN.z);
    parts.push(torus);
    const barZ = -4.72;
    for (const x of [-1.95, -0.75, 0.35, 1.55, 2.35]) {
      const d = Math.abs(x - WIN.x);
      const len = 2 * Math.sqrt(WIN.r * WIN.r - d * d);
      const g = new THREE.BoxGeometry(0.045, len, 0.07);
      g.translate(x, WIN.y, barZ);
      parts.push(g);
    }
    for (const y of [1.85, 3.65, 4.95]) {
      const d = Math.abs(y - WIN.y);
      const len = 2 * Math.sqrt(WIN.r * WIN.r - d * d);
      const g = new THREE.BoxGeometry(len, 0.045, 0.07);
      g.translate(WIN.x, y, barZ);
      parts.push(g);
    }
    const frame = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0x0e0d0c, roughness: 0.5, metalness: 0.2 }));
    frame.name = 'windowFrame';
    add(frame, { receive: true });
  }

  // ガラス
  {
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(2.98, 96),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe0f0, transparent: true, opacity: 0.05, roughness: 0.15, metalness: 0, depthWrite: false }),
    );
    glass.name = 'glass';
    // 窓面 z=-4.5（内縁 Torus の面。縁は Torus の管の中に隠れる）。lighting.js は 'glass' の部屋側 z から窓明かりの面を決める。
    glass.position.set(WIN.x, WIN.y, WIN.z);
    group.add(glass);
  }

  // カーテン×2＋レール
  {
    const curtainTex = toTexture(makeCurtainCanvas(rand, noise));
    const curtainMat = addBacklight(
      new THREE.MeshPhysicalMaterial({
        map: curtainTex,
        roughness: 0.92,
        sheen: 0.6,
        sheenColor: new THREE.Color(0xff8a58),
        sheenRoughness: 0.8,
        side: THREE.DoubleSide,
      }),
      { strength: 0.45 },
    );
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(2.4, 6.3, 48, 12);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const u = (x + 1.2) / 2.4;
        const v = (y + 3.15) / 6.3;
        const fold = (0.14 * Math.sin(u * Math.PI * 2 * 5.5 + 0.4) + 0.05 * Math.sin(u * Math.PI * 2 * 13)) * smoothstep(1.0, 0.86, v);
        pos.setZ(i, fold + 0.03 * noise.noise2((x + side * 4.1) * 3, y * 0.7));
      }
      geo.computeVertexNormals();
      const curtain = new THREE.Mesh(geo, curtainMat);
      curtain.position.set(side * 4.1, 3.15, -4.25);
      curtain.name = side < 0 ? 'curtainL' : 'curtainR';
      add(curtain);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 13.0, 10), new THREE.MeshStandardMaterial({ color: 0x6b5230, roughness: 0.6 }));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 6.3, -4.25);
    add(rail, { receive: false });
  }

  // =====================================================================
  // 床＝照明を受ける濡れ石 ＋ 透明 Reflector
  const floorMaps = buildFloorMaps(noise, rand);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorMaps.map,
    roughnessMap: floorMaps.roughnessMap,
    normalMap: floorMaps.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 1,
    metalness: 0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0.25);
  floor.name = 'floor';
  add(floor, { cast: false });

  const reflectorShader = {
    name: 'PuddleReflector',
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      tMask: { value: null },
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(0xf2e6e8) },
      uDrops: { value: [new THREE.Vector4(0, 0, -100, 0), new THREE.Vector4(0, 0, -100, 0), new THREE.Vector4(0, 0, -100, 0)] },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;
      varying vec2 vUv2;
      varying vec3 vWorldPos;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vUv = textureMatrix * vec4( position, 1.0 );
        vUv2 = uv;
        vWorldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform sampler2D tDiffuse;
      uniform sampler2D tMask;
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec4 uDrops[3];
      varying vec4 vUv;
      varying vec2 vUv2;
      varying vec3 vWorldPos;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec3 m = texture2D( tMask, vUv2 ).rgb;
        float puddle = m.r;
        float wet = m.g;
        vec2 rip = vec2( sin( vWorldPos.x * 9.0 + uTime * 1.3 ), sin( vWorldPos.z * 7.0 - uTime * 0.9 ) ) * 0.0025;
        for ( int i = 0; i < 3; i ++ ) {
          float d = distance( vWorldPos.xz, uDrops[ i ].xy );
          float t = uTime - uDrops[ i ].z;
          float ring = sin( ( d - t * 0.6 ) * 45.0 ) * exp( -d * 4.0 ) * exp( -max( t, 0.0 ) * 1.5 ) * step( 0.0, t ) * 0.006;
          rip += ring * normalize( vWorldPos.xz - uDrops[ i ].xy + 1e-4 );
        }
        vec4 uv = vUv;
        uv.xy += rip * puddle * uv.w;
        vec3 refl = texture2DProj( tDiffuse, uv ).rgb * uTint;
        vec3 V = normalize( cameraPosition - vWorldPos );
        float F = 0.02 + 0.98 * pow( 1.0 - max( V.y, 0.0 ), 5.0 );
        float a = puddle * clamp( F * 1.6 + 0.12, 0.0, 1.0 ) + ( 1.0 - puddle ) * wet * F * 0.5;
        gl_FragColor = vec4( refl, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
  const reflector = new Reflector(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), {
    textureWidth: high ? 960 : 480,
    textureHeight: high ? 540 : 270,
    clipBias: 0.003,
    multisample: high ? 2 : 0,
    shader: reflectorShader,
  });
  reflector.name = 'puddleReflector';
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.set(0, 0.003, 0.25);
  reflector.material.transparent = true;
  reflector.material.depthWrite = false;
  reflector.renderOrder = 2;
  reflector.castShadow = false;
  reflector.receiveShadow = false;
  reflector.material.uniforms.tMask.value = floorMaps.maskTex;
  const reflU = reflector.material.uniforms;
  {
    // 内部描画（反射カメラでシーンをもう 1 回描く）の間だけ noReflect を隠す。
    // メインの描画リストは projectObject 済みなので今フレームの本描画には影響しない。
    // Reflector 内部で shadowMap.autoUpdate=false になるので影の二重焼きは起きない。
    const orig = reflector.onBeforeRender;
    let savedVisible = new Uint8Array(0);
    reflector.onBeforeRender = function (renderer, scene, camera, ...rest) {
      const n = noReflect.length;
      if (savedVisible.length < n) savedVisible = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        savedVisible[i] = noReflect[i].visible ? 1 : 0;
        noReflect[i].visible = false;
      }
      try {
        orig.call(this, renderer, scene, camera, ...rest);
      } finally {
        for (let i = 0; i < n; i++) noReflect[i].visible = savedVisible[i] === 1;
      }
    };
  }
  group.add(reflector);
  const dropT0 = DROPS.map((d) => -100 + rand() * d.period);

  // =====================================================================
  // 家具・人物・ラジオ
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x1e1815, roughness: 0.85 });
  {
    // デイベッド 中心 (0.6,0,1.35) 長辺 x
    const bed = new THREE.Group();
    bed.name = 'daybed';
    bed.position.set(0.6, 0, 1.35);
    const frameParts = [];
    const fr = new THREE.BoxGeometry(2.2, 0.12, 1.0);
    fr.translate(0, 0.36, 0);
    frameParts.push(fr);
    for (const [x, z] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) {
      const leg = new THREE.CylinderGeometry(0.035, 0.03, 0.3, 10);
      leg.translate(x, 0.15, z);
      frameParts.push(leg);
    }
    const frame = new THREE.Mesh(mergeGeometries(frameParts), darkWood);
    frame.castShadow = true;
    frame.receiveShadow = true;
    bed.add(frame);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 0.9), new THREE.MeshStandardMaterial({ color: 0x8e8477, roughness: 0.9 }));
    mattress.position.y = 0.5;
    mattress.castShadow = true;
    mattress.receiveShadow = true;
    bed.add(mattress);
    // 掛け布（両端が垂れる）
    const geo = new THREE.PlaneGeometry(2.5, 1.6, 26, 16);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = pos.getY(i);
      const az = Math.abs(z);
      if (az > 0.45) y -= Math.min(0.55, 1.6 * (az - 0.45));
      const ax = Math.abs(x);
      if (ax > 1.05) y -= Math.min(0.4, 1.6 * (ax - 1.05));
      y += 0.02 * noise.noise2(4 * x, 4 * z);
      pos.setY(i, y);
    }
    geo.computeVertexNormals();
    const blanket = new THREE.Mesh(
      geo,
      addBacklight(new THREE.MeshStandardMaterial({ color: 0xd9cfbf, roughness: 0.9, side: THREE.DoubleSide }), { strength: 0.3 }),
    );
    blanket.position.y = 0.6;
    blanket.castShadow = true;
    blanket.receiveShadow = true;
    bed.add(blanket);
    group.add(bed);
  }

  // 人物（白衣・背中）。座位中は main.js が figure.visible=false にする。
  const figure = new THREE.Group();
  figure.name = 'figure';
  figure.position.set(0.2, 0, 1.3);
  {
    const robe = addBacklight(new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.85, side: THREE.DoubleSide }), { strength: 0.3 });
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const t = k / 11;
      pts.push(new THREE.Vector2(lerp(0.42, 0.24, Math.pow(t, 0.8)), 0.3 + 0.3 * t));
    }
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), robe);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), robe);
    torso.position.y = 0.74;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), robe);
    head.position.y = 1.18;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.7 }));
    hair.scale.set(1.05, 1.15, 1.05);
    hair.position.set(0, 1.2, 0.02); // 顔は -z（窓）を向く。髪は後頭部側
    for (const m of [skirt, torso, head, hair]) {
      m.castShadow = true;
      m.receiveShadow = true;
      figure.add(m);
    }
  }
  figure.visible = false;
  group.add(figure);

  // ラジオ（既存の Group。台の上、正面をデイベッドへ）
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.6 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.45, metalness: 0.7 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe6dccc, roughness: 0.6 });
  box(0.6, 0.62, 0.5, new THREE.MeshStandardMaterial({ color: 0x3a3532, roughness: 0.9 }), 2.15, 0.31, 1.2);
  // 床置きの油灯（lighting.js のランタン光源の見た目。歩き回るときの室内の手掛かり）
  {
    const lamp = new THREE.Group();
    lamp.position.set(2.55, 0, 0.75);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.06, 20), brassMat);
    base.position.y = 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.14, 12), brassMat);
    stem.position.y = 0.13;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.065, 0.2, 20, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.35, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.position.y = 0.3;
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb050, emissiveIntensity: 3.2 }));
    flame.position.y = 0.27;
    flame.scale.y = 1.6;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.05, 20), brassMat);
    cap.position.y = 0.42;
    for (const m of [base, stem, cap]) { m.castShadow = true; m.receiveShadow = true; }
    lamp.add(base, stem, glass, flame, cap);
    group.add(lamp);
  }
  const radio = new THREE.Group();
  radio.name = 'radio';
  radio.position.set(2.15, 0.62, 1.2);
  radio.rotation.y = -Math.PI / 2 - 0.3;
  const radioBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.18), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.5 }));
  radioBody.position.y = 0.13;
  const radioFront = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.02), cream);
  radioFront.position.set(0, 0.13, 0.09);
  const grilleTex = toTexture(
    (() => {
      const c = makeCanvas(128);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#2a2320';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#6e5a44';
      for (let x = 0; x < 128; x += 8) ctx.fillRect(x, 0, 3, 128);
      return c;
    })(),
    { repeat: [3, 1] },
  );
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.006), new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.8 }));
  grille.position.set(-0.09, 0.13, 0.102);
  const dialMat = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xffa040, emissiveIntensity: 0 });
  const dial = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.006), dialMat);
  dial.position.set(0.1, 0.16, 0.102);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.004), new THREE.MeshStandardMaterial({ color: 0xff4020, emissive: 0xff4020, emissiveIntensity: 0.4 }));
  needle.position.set(0.07, 0.16, 0.106);
  const knobGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 20);
  knobGeo.rotateX(Math.PI / 2);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.4 });
  const knob1 = new THREE.Mesh(knobGeo, knobMat);
  knob1.position.set(0.06, 0.08, 0.11);
  const knob2 = new THREE.Mesh(knobGeo, knobMat);
  knob2.position.set(0.14, 0.08, 0.11);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 8), metal);
  antenna.position.set(-0.18, 0.46, -0.02);
  antenna.rotation.z = 0.35;
  const dialLight = new THREE.PointLight(0xffa040, 0, 2.2, 2);
  dialLight.position.set(0.1, 0.2, 0.42);
  for (const m of [radioBody, radioFront, grille, dial, needle, knob1, knob2, antenna]) {
    m.castShadow = true;
    m.receiveShadow = true;
    radio.add(m);
  }
  radio.add(dialLight);
  group.add(radio);

  // =====================================================================
  // 楓 2 本
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95 });
  const rightTree = buildTree(
    {
      base: new THREE.Vector3(4.3, 0, -3.4),
      trunkDir: new THREE.Vector3(-Math.sin(10 * DEG), Math.cos(10 * DEG), 0),
      trunkH: 2.0,
      trunkR0: 0.22,
      trunkR1: 0.15,
      l1: [
        { dir: new THREE.Vector3(-0.78, 0.55, -0.25), len: 3.4, lineage: true }, // 窓上部へ被る長枝
        { az: 171 * DEG + (rand() - 0.5) * 0.3, el: (35 + rand() * 25) * DEG, len: 1.6 + rand() * 0.8 },
        { az: 122 * DEG + (rand() - 0.5) * 0.3, el: (35 + rand() * 25) * DEG, len: 1.6 + rand() * 0.8 },
        { az: 80 * DEG + (rand() - 0.5) * 0.3, el: (35 + rand() * 25) * DEG, len: 1.6 + rand() * 0.8 },
      ],
      levels: [
        { r: 0.09, rt: 0.05 },
        { n: 3, k: 0.62, r: 0.04, rt: 0.022, up: 0.4 },
        { n: 3, k: 0.62, r: 0.018, rt: 0.01, up: 0.3 },
        { n: 2, k: 0.6, r: 0.008, rt: 0.004, up: -0.1 },
      ],
    },
    rand,
  );
  const leftTree = buildTree(
    {
      base: new THREE.Vector3(-4.5, 0, -3.5),
      trunkDir: new THREE.Vector3(0.05, 1, 0.03),
      trunkH: 0.9,
      trunkR0: 0.12,
      trunkR1: 0.08,
      l1: [
        { az: 20 * DEG + (rand() - 0.5) * 0.4, el: (30 + rand() * 25) * DEG, len: 0.9 + rand() * 0.4 },
        { az: 110 * DEG + (rand() - 0.5) * 0.4, el: (30 + rand() * 25) * DEG, len: 0.9 + rand() * 0.4 },
        { az: 210 * DEG + (rand() - 0.5) * 0.4, el: (30 + rand() * 25) * DEG, len: 0.9 + rand() * 0.4 },
      ],
      levels: [
        { r: 0.05, rt: 0.03 },
        { n: 3, k: 0.6, r: 0.022, rt: 0.012, up: 0.4 },
        { n: 2, k: 0.55, r: 0.01, rt: 0.005, up: 0.1 },
      ],
    },
    rand,
  );
  for (const t of [rightTree, leftTree]) {
    const m = new THREE.Mesh(t.geometry, barkMat);
    m.name = t === rightTree ? 'mapleRight' : 'mapleLeft';
    add(m);
  }

  // 葉
  const leafGeo = new THREE.PlaneGeometry(1, 1);
  const leafTex = toTexture(makeLeafCanvas(), { wrap: false, aniso: 4 });
  const leafMat = addBacklight(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), { strength: 0.6, wind: true });
  const paletteCum = [];
  {
    let acc = 0;
    for (const p of LEAF_PALETTE) {
      acc += p.w;
      paletteCum.push(acc);
    }
  }
  const paletteColors = LEAF_PALETTE.map((p) => new THREE.Color(p.hex));
  const paletteTotal = paletteCum[paletteCum.length - 1];
  const pickLeafColor = (rel) => {
    const u = clamp(rand() * 0.55 + rel * 0.55 + (rand() - 0.5) * 0.25, 0, 0.9999) * paletteTotal;
    for (let k = 0; k < paletteCum.length; k++) if (u < paletteCum[k]) return paletteColors[k];
    return paletteColors[paletteColors.length - 1];
  };

  const _m = new THREE.Matrix4();
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _s = new THREE.Vector3();
  /** T=葉先方向 の直交基底で行列を組む（Y=葉先、Z=法線） */
  const leafMatrix = (p, T, N, scale, out) => {
    const X = _v3.crossVectors(T, N).normalize();
    out.makeBasis(X, T, N);
    out.scale(_s.set(scale, scale, scale));
    out.setPosition(p);
    return out;
  };

  const canopyPositions = []; // 落葉の発生源（右木）
  function scatterCanopy(tree, count, { crown, crownR, levels }) {
    const pool = tree.branches.filter((b) => levels.includes(b.level));
    const cum = [];
    let acc = 0;
    for (const b of pool) {
      acc += b.len;
      cum.push(acc);
    }
    let center = crown;
    let radius = crownR;
    if (!center) {
      center = new THREE.Vector3();
      for (const b of pool) center.add(b.end);
      center.divideScalar(Math.max(1, pool.length));
      radius = 0;
      for (const b of pool) radius = Math.max(radius, b.end.distanceTo(center));
      radius = Math.max(0.5, radius);
    }
    const inst = new THREE.InstancedMesh(leafGeo, leafMat, count);
    const p = new THREE.Vector3();
    const T = new THREE.Vector3();
    const Nn = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const u = rand() * acc;
      let bi = 0;
      while (bi < cum.length - 1 && cum[bi] < u) bi++;
      const b = pool[bi];
      p.copy(b.start).lerp(b.end, 0.3 + rand() * 0.7);
      randUnit(rand, _v1).multiplyScalar(0.4 * Math.cbrt(rand()));
      p.add(_v1);
      if (crown) {
        const dc = p.distanceTo(center);
        if (dc > crownR) p.lerp(center, 1 - crownR / dc);
      }
      p.x = clamp(p.x, -6.3, 6.3);
      p.y = clamp(p.y, 0.15, 6.3);
      p.z = clamp(p.z, -4.35, 4.8);
      // 姿勢: 葉先は水平から 0〜25° 下向き、法線はランダム
      const a = rand() * Math.PI * 2;
      const e = rand() * 25 * DEG;
      T.set(Math.cos(a) * Math.cos(e), -Math.sin(e), Math.sin(a) * Math.cos(e));
      randUnit(rand, _v2);
      Nn.copy(_v2).addScaledVector(T, -_v2.dot(T));
      if (Nn.lengthSq() < 1e-4) Nn.set(0, 0, 1).addScaledVector(T, -T.z);
      Nn.normalize();
      inst.setMatrixAt(i, leafMatrix(p, T, Nn, 0.22 + rand() * 0.08, _m));
      inst.setColorAt(i, pickLeafColor(clamp(p.distanceTo(center) / radius, 0, 1)));
      if (tree === rightTree && (i & 7) === 0) canopyPositions.push(p.clone());
    }
    inst.castShadow = true;
    inst.receiveShadow = false;
    inst.computeBoundingSphere();
    group.add(inst);
    noReflect.push(inst);
    return inst;
  }
  const leavesRight = scatterCanopy(rightTree, high ? 6000 : 3000, { levels: [3, 4] });
  leavesRight.name = 'leavesRight';
  const leavesLeft = scatterCanopy(leftTree, high ? 2400 : 1200, { levels: [2, 3], crown: new THREE.Vector3(-4.3, 1.6, -3.4), crownR: 1.3 });
  leavesLeft.name = 'leavesLeft';

  // 落葉アニメ 40 枚
  const FALL_N = 40;
  const falling = new THREE.InstancedMesh(leafGeo, leafMat, FALL_N);
  falling.name = 'fallingLeaves';
  falling.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  falling.frustumCulled = false;
  falling.castShadow = false;
  noReflect.push(falling);
  const fallState = [];
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const spawnFall = (f, delay) => {
    const src = canopyPositions.length ? canopyPositions[Math.floor(rand() * canopyPositions.length)] : new THREE.Vector3(2.5, 4, -3.5);
    f.x0 = src.x;
    f.y = src.y;
    f.z = src.z;
    f.t = -delay;
    f.rot = rand() * Math.PI * 2;
    f.axis = randUnit(rand, f.axis || new THREE.Vector3());
    f.yaw = rand() * Math.PI * 2;
    f.rest = false;
    f.restT = 0;
    f.scale = 0.22 + rand() * 0.08;
    falling.setColorAt(f.i, pickLeafColor(rand()));
    _m.makeScale(0, 0, 0);
    falling.setMatrixAt(f.i, _m);
  };
  for (let i = 0; i < FALL_N; i++) {
    const f = { i };
    spawnFall(f, rand() * 30);
    fallState.push(f);
  }
  falling.instanceColor.needsUpdate = true;
  group.add(falling);

  // =====================================================================
  // 散らばり（各 1 draw・全部 layer1）
  const inRoomX = () => lerp(ROOM.minX + 0.1, ROOM.maxX - 0.1, rand());
  const inRoomZ = () => lerp(ROOM.minZ + 0.05, ROOM.maxZ - 0.1, rand());

  {
    // 落ち葉
    const n = high ? 700 : 350;
    const groundLeafMat = addBacklight(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }), { strength: 0.35 });
    const inst = new THREE.InstancedMesh(leafGeo, groundLeafMat, n);
    inst.name = 'groundLeaves';
    const cols = GROUND_LEAF_COLORS.map((c) => new THREE.Color(c));
    const p = new THREE.Vector3();
    const T = new THREE.Vector3();
    const Nn = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = rand();
      if (u < 0.55) p.set(4.3 + gauss(rand) * 1.6, 0, -3.4 + gauss(rand) * 1.6);
      else if (u < 0.8) p.set(-4.5 + gauss(rand) * 1.1, 0, -3.5 + gauss(rand) * 1.1);
      else p.set(inRoomX(), 0, lerp(ROOM.minZ + 0.05, -1, rand()));
      p.x = clamp(p.x, ROOM.minX + 0.1, ROOM.maxX - 0.1);
      p.z = clamp(p.z, ROOM.minZ + 0.05, ROOM.maxZ - 0.1);
      p.y = 0.006 + rand() * 0.012; // Reflector（y=0.003）より上に置いて z-fight を避ける
      const tilt = rand() * 20 * DEG;
      const b = rand() * Math.PI * 2;
      Nn.set(Math.sin(tilt) * Math.cos(b), Math.cos(tilt), Math.sin(tilt) * Math.sin(b));
      const a = rand() * Math.PI * 2;
      T.set(Math.cos(a), 0, Math.sin(a));
      T.addScaledVector(Nn, -T.dot(Nn)).normalize();
      inst.setMatrixAt(i, leafMatrix(p, T, Nn, 0.1 + rand() * 0.06, _m));
      inst.setColorAt(i, cols[Math.floor(rand() * cols.length)]);
    }
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
    noReflect.push(inst);
  }

  {
    // 小石
    const n = high ? 500 : 250;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 1 + noise.noise3(x * 1.5, y * 1.5, z * 1.5) * 0.25;
      pos.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), n);
    inst.name = 'pebbles';
    const c0 = new THREE.Color(0x5f5a55);
    const c1 = new THREE.Color(0x7a746c);
    const col = new THREE.Color();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (rand() < 0.6) p.set(inRoomX(), 0, lerp(ROOM.minZ + 0.05, -2, rand()));
      else p.set(inRoomX(), 0, inRoomZ());
      const sx = 0.015 + rand() * 0.045;
      const sy = sx * (0.5 + rand() * 0.3);
      const sz = sx * (0.7 + rand() * 0.5);
      p.y = sy * 0.45;
      _e.set(0, rand() * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _m.compose(p, _q, _s.set(sx, sy, sz));
      inst.setMatrixAt(i, _m);
      inst.setColorAt(i, col.copy(c0).lerp(c1, rand()));
    }
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
    noReflect.push(inst);
  }

  {
    // 苔の房（壁際の帯＋水たまり縁）
    const n = high ? 350 : 150;
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshStandardMaterial({ roughness: 0.95 }), n);
    inst.name = 'mossTufts';
    const c0 = new THREE.Color(0x2f4a1e);
    const c1 = new THREE.Color(0x5a6e2a);
    const col = new THREE.Color();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (rand() < 0.55) {
        const side = Math.floor(rand() * 4);
        const off = 0.05 + rand() * 0.55;
        if (side === 0) p.set(ROOM.minX + off, 0, inRoomZ());
        else if (side === 1) p.set(ROOM.maxX - off, 0, inRoomZ());
        else if (side === 2) p.set(inRoomX(), 0, ROOM.minZ + off);
        else p.set(inRoomX(), 0, ROOM.maxZ - off);
      } else {
        const pd = PUDDLES[Math.floor(rand() * PUDDLES.length)];
        const a = rand() * Math.PI * 2;
        const d = pd[2] * (0.9 + rand() * 0.4);
        p.set(pd[0] + Math.cos(a) * d, 0, pd[1] + Math.sin(a) * d);
      }
      p.x = clamp(p.x, ROOM.minX + 0.05, ROOM.maxX - 0.05);
      p.z = clamp(p.z, ROOM.minZ + 0.03, ROOM.maxZ - 0.05);
      const sx = 0.08 + rand() * 0.22;
      const sy = 0.03 + rand() * 0.04;
      _e.set(0, rand() * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _m.compose(p, _q, _s.set(sx, sy, sx * (0.8 + rand() * 0.4)));
      inst.setMatrixAt(i, _m);
      inst.setColorAt(i, col.copy(c0).lerp(c1, rand()));
    }
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
    noReflect.push(inst);
  }

  {
    // 紙片（手紙 20・破片 40）
    const n = 60;
    const geo = new THREE.PlaneGeometry(1, 1, 2, 2);
    geo.rotateX(-Math.PI / 2);
    geo.attributes.position.setY(4, 0.02); // 中央を反らせる
    geo.computeVertexNormals();
    const paperMat = new THREE.MeshStandardMaterial({ map: toTexture(makePaperCanvas(rand), { wrap: false }), roughness: 0.9, side: THREE.DoubleSide });
    const inst = new THREE.InstancedMesh(geo, paperMat, n);
    inst.name = 'papers';
    const white = new THREE.Color(0xffffff);
    const aged = new THREE.Color(0xc9b892);
    const col = new THREE.Color();
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (rand() < 0.7) {
        const a = rand() * Math.PI * 2;
        const d = 0.6 + Math.sqrt(rand()) * 1.6;
        p.set(0.6 + Math.cos(a) * d, 0, 1.35 + Math.sin(a) * d);
      } else p.set(inRoomX(), 0, inRoomZ());
      p.x = clamp(p.x, ROOM.minX + 0.2, ROOM.maxX - 0.2);
      p.z = clamp(p.z, ROOM.minZ + 0.2, ROOM.maxZ - 0.2);
      p.y = 0.006 + rand() * 0.006;
      const letter = i < 20;
      const sx = letter ? 0.2 : 0.08 + rand() * 0.06;
      const sz = letter ? 0.28 : 0.08 + rand() * 0.06;
      _e.set(0, rand() * Math.PI * 2, 0);
      _q.setFromEuler(_e);
      _m.compose(p, _q, _s.set(sx, 1, sz));
      inst.setMatrixAt(i, _m);
      inst.setColorAt(i, col.copy(white).lerp(aged, rand()));
    }
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
    noReflect.push(inst);
  }

  // 埃（窓の光の中を漂う）
  const dustN = high ? 400 : 200;
  const dustPos = new Float32Array(dustN * 3);
  const dustSeed = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = -3.5 + rand() * 7;
    dustPos[i * 3 + 1] = 0.2 + rand() * 5.3;
    dustPos[i * 3 + 2] = -4.2 + rand() * 6.7;
    dustSeed[i] = rand() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ size: 0.03, map: makeDustSprite(), color: 0xf3cdbc, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  dust.name = 'dust';
  dust.frustumCulled = false;
  dust.renderOrder = 3; // 加算の埃は Reflector（renderOrder 2・αブレンド）の後に描く。先に描くと水たまりの上で暗くなる
  group.add(dust);
  noReflect.push(dust);

  // =====================================================================
  let time = 0;
  const flatQ = new THREE.Quaternion();

  function update(dt, state) {
    time += dt;
    TIME_U.value = time;
    const p = state?.params;
    if (p && p.sunColor) {
      const si = p.sunIntensity ?? 1;
      BL.uSunColor.value.setRGB(sunBase.r * p.sunColor[0] * si, sunBase.g * p.sunColor[1] * si, sunBase.b * p.sunColor[2] * si);
    }

    // 水滴の波紋
    reflU.uTime.value = time;
    for (let i = 0; i < DROPS.length; i++) {
      const d = DROPS[i];
      if (time - dropT0[i] >= d.period) dropT0[i] = time + rand() * 0.6;
      reflU.uDrops.value[i].set(d.x, d.z, dropT0[i], 0);
    }

    // 落葉
    for (const f of fallState) {
      f.t += dt;
      if (f.t < 0) continue;
      if (!f.rest) {
        f.y -= 0.25 * dt;
        f.rot += dt;
        const x = f.x0 + 0.15 * Math.sin(1.3 * f.t);
        if (f.y <= 0.01) {
          f.y = 0.01;
          f.rest = true;
          f.restT = 0;
          _e.set(-Math.PI / 2, f.yaw, 0, 'YXZ');
          flatQ.setFromEuler(_e);
        } else {
          _q.setFromAxisAngle(f.axis, f.rot);
        }
        _m.compose(_v1.set(x, f.y, f.z), f.rest ? flatQ : _q, _s.set(f.scale, f.scale, f.scale));
        falling.setMatrixAt(f.i, _m);
      } else {
        f.restT += dt;
        if (f.restT > 30) {
          spawnFall(f, rand() * 4);
          falling.instanceColor.needsUpdate = true;
        }
      }
    }
    falling.instanceMatrix.needsUpdate = true;

    // 埃
    const dp = dustGeo.attributes.position;
    for (let i = 0; i < dustN; i++) {
      const s = dustSeed[i];
      let y = dp.getY(i) + Math.sin(time * 0.3 + s) * 0.0006 + 0.0004;
      let x = dp.getX(i) + Math.cos(time * 0.2 + s * 1.3) * 0.0008;
      const z = dp.getZ(i) + Math.sin(time * 0.17 + s * 0.7) * 0.0006;
      if (y > 5.5) y = 0.2;
      if (x > 3.6) x = -3.5;
      if (x < -3.6) x = 3.5;
      dp.setXYZ(i, x, y, z);
    }
    dp.needsUpdate = true;
  }

  function setRadioOn(on) {
    dialMat.emissiveIntensity = on ? 1.1 : 0;
    dialLight.intensity = on ? 0.5 : 0;
  }

  function setRadioNeedle(f) {
    needle.position.x = 0.045 + clamp(f, 0, 1) * 0.11;
  }

  function setSunDir(v) {
    BL.uSunDir.value.copy(v).normalize();
  }

  return { group, radio, seat, seatLook, bounds, colliders, figure, update, setRadioOn, setRadioNeedle, setSunDir };
}
