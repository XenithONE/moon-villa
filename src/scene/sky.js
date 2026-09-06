import * as THREE from 'three';
import { createRandom } from '../util/noise.js';

function makeStarSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 星空。月には大気が無いので星は瞬かず、地平線まで同じ密度で見える。
 * 天の川の帯を別レイヤーで足す。
 */
export function createSky({ radius = 2600 } = {}) {
  const group = new THREE.Group();
  group.name = 'sky';
  const sprite = makeStarSprite();
  const rand = createRandom(20260906);

  // --- 明るい星
  {
    const n = 4200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // 球面上に一様
      const u = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(phi) * radius;
      pos[i * 3 + 1] = u * radius;
      pos[i * 3 + 2] = r * Math.sin(phi) * radius;
      // 色温度の散らばりと明るさ（べき分布で暗い星が多い）
      const temp = rand();
      if (temp < 0.12) tmp.setRGB(0.75, 0.82, 1.0);
      else if (temp < 0.8) tmp.setRGB(1.0, 0.98, 0.94);
      else tmp.setRGB(1.0, 0.85, 0.65);
      const b = 0.22 + Math.pow(rand(), 3.2) * 0.78;
      col[i * 3] = tmp.r * b;
      col[i * 3 + 1] = tmp.g * b;
      col[i * 3 + 2] = tmp.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.6,
      sizeAttenuation: false,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    group.add(stars);
  }

  // --- 天の川（傾いた大円に沿って濃く散らす）
  {
    const n = 9000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const axis = new THREE.Vector3(0.55, 0.72, -0.42).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const phi = rand() * Math.PI * 2;
      // 帯からの高さ：ガウスっぽく
      const g = (rand() + rand() + rand() - 1.5) * 0.16;
      const r = Math.sqrt(Math.max(0, 1 - g * g));
      v.set(r * Math.cos(phi), g, r * Math.sin(phi)).applyQuaternion(q).multiplyScalar(radius * 0.98);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      const b = 0.05 + Math.pow(rand(), 2.5) * 0.45;
      const warm = rand() * 0.15;
      col[i * 3] = (0.8 + warm) * b;
      col[i * 3 + 1] = (0.82 + warm * 0.4) * b;
      col[i * 3 + 2] = (0.95 - warm * 0.5) * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.0,
      sizeAttenuation: false,
      map: sprite,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const band = new THREE.Points(geo, mat);
    band.frustumCulled = false;
    group.add(band);
  }

  return group;
}
