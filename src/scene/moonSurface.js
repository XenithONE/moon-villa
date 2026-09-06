import * as THREE from 'three';
import { createNoise, smoothstep, lerp } from '../util/noise.js';

const SIZE = 2000;
const SEG = 240;
const BASE_Y = -0.35; // 別荘の床(y=0)より少し低い

function makeRegolithTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const noise = createNoise(99);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      // タイル可能にするため周期座標でサンプリング
      const a = (x / s) * Math.PI * 2;
      const b = (y / s) * Math.PI * 2;
      const nx = Math.cos(a) * 3;
      const ny = Math.sin(a) * 3;
      const nz = Math.cos(b) * 3;
      const nw = Math.sin(b) * 3;
      const n = noise.fbm3(nx + nz, ny + nw, nz - nx, 4) * 0.5 + 0.5;
      const grain = (noise.noise3(x * 0.9, y * 0.9, 3.3) * 0.5 + 0.5) * 0.25;
      const v = Math.round(255 * Math.min(1, Math.max(0, 0.62 + (n - 0.5) * 0.5 + grain - 0.12)));
      const i = (y * s + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(70, 70);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 月面地形。heightAt(x,z) を公開し、岩や別荘の基礎が同じ高さを使えるようにする。 */
export function createMoonSurface() {
  const noise = createNoise(7);
  const rand = noise.rand;

  // クレーター（別荘周辺 40m は空ける）。遠景に大きなリムを 3 つ置いて地平線に起伏を出す。
  const craters = [];
  for (let i = 0; i < 70; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 45 + Math.pow(rand(), 0.7) * 800;
    const r = 3 + Math.pow(rand(), 2.2) * 45;
    craters.push({ x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, r, depth: r * (0.12 + rand() * 0.12) });
  }
  craters.push({ x: -420, z: -620, r: 260, depth: 34 });
  craters.push({ x: 560, z: -480, r: 190, depth: 26 });
  craters.push({ x: 120, z: 720, r: 220, depth: 24 });

  function heightAt(x, z) {
    let h = noise.fbm2(x * 0.0035, z * 0.0035, 4) * 7.0 + noise.fbm2(x * 0.03, z * 0.03, 3) * 0.55;
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const dd = Math.sqrt(dx * dx + dz * dz) / c.r;
      if (dd < 1.7) {
        const bowl = dd < 1 ? -(1 - dd * dd) * c.depth : 0;
        const rim = Math.exp(-(dd - 1.0) * (dd - 1.0) * 16) * c.depth * 0.32;
        h += bowl + rim;
      }
    }
    const dv = Math.sqrt(x * x + z * z);
    const flat = smoothstep(9, 24, dv);
    return BASE_Y + h * flat;
  }

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const dist = Math.sqrt(x * x + z * z);
    const tone = 0.58 + noise.fbm2(x * 0.01 + 50, z * 0.01, 3) * 0.14;
    // 遠くは暗く落として平面の縁を隠す（大気は無いが、画としての奥行き）
    const fade = 1 - smoothstep(320, 950, dist) * 0.92;
    const k = tone * fade;
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * 0.99;
    colors[i * 3 + 2] = k * 0.97;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: makeRegolithTexture(),
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.name = 'moon';

  const group = new THREE.Group();
  group.add(ground);

  // 岩
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rockPos = rockGeo.attributes.position;
  for (let i = 0; i < rockPos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rockPos, i);
    const n = 1 + noise.noise3(v.x * 1.7, v.y * 1.7, v.z * 1.7) * 0.28;
    v.multiplyScalar(n);
    rockPos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8683, roughness: 1, metalness: 0 });
  for (let i = 0; i < 90; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 14 + Math.pow(rand(), 1.4) * 420;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const s = 0.25 + Math.pow(rand(), 2.5) * 3.2;
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, heightAt(x, z) - s * 0.25, z);
    rock.scale.set(s * (0.8 + rand() * 0.5), s * (0.6 + rand() * 0.5), s * (0.8 + rand() * 0.5));
    rock.rotation.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // 別荘の基礎スラブ（暗いコンクリート）
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(11, 0.5, 9.5),
    new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.9 }),
  );
  slab.position.set(0, -0.25, 0);
  slab.receiveShadow = true;
  group.add(slab);

  return { group, heightAt, lerp };
}
