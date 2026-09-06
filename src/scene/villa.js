import * as THREE from 'three';
import { createRandom, createNoise } from '../util/noise.js';

// 部屋: x∈[-4,4] z∈[-3.5,3.5] 高さ 3.2。窓は z=-3.5 の壁いっぱい。椅子は z≈1.5 で -z（窓）を向く。

function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWoodTexture(rand) {
  return canvasTexture(1024, (ctx, s) => {
    ctx.fillStyle = '#4a3220';
    ctx.fillRect(0, 0, s, s);
    const w = 64;
    for (let col = 0; col < s / w; col++) {
      let y = -Math.floor(rand() * 300);
      while (y < s) {
        const len = 220 + Math.floor(rand() * 260);
        const tone = 0.82 + rand() * 0.36;
        const r = Math.round(112 * tone);
        const g = Math.round(76 * tone);
        const b = Math.round(46 * tone);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(col * w + 1, y + 1, w - 2, len - 2);
        // 木目
        ctx.strokeStyle = `rgba(40,22,10,${0.18 + rand() * 0.2})`;
        ctx.lineWidth = 1;
        for (let k = 0; k < 7; k++) {
          const x0 = col * w + 4 + rand() * (w - 8);
          ctx.beginPath();
          for (let yy = y + 2; yy < y + len - 2; yy += 6) {
            const x = x0 + Math.sin(yy * 0.05 + k) * 3 + Math.sin(yy * 0.013) * 5;
            if (yy === y + 2) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
        y += len;
      }
    }
    // 全体のざらつき
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [2, 1.75] });
}

function makePlasterTexture(rand) {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#c4b294';
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 18;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [4, 2] });
}

function makeRugTexture(rand) {
  return canvasTexture(512, (ctx, s) => {
    const rings = ['#5a2a2a', '#c9a86a', '#7a3b2e', '#2f3a4a', '#c9a86a', '#5a2a2a', '#8a4a3a'];
    for (let i = 0; i < rings.length; i++) {
      const inset = i * 26;
      ctx.fillStyle = rings[i];
      ctx.fillRect(inset, inset, s - inset * 2, s - inset * 2);
    }
    // 中央の菱形
    ctx.fillStyle = '#c9a86a';
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.32);
    ctx.lineTo(s * 0.68, s / 2);
    ctx.lineTo(s / 2, s * 0.68);
    ctx.lineTo(s * 0.32, s / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a2a2a';
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.4);
    ctx.lineTo(s * 0.6, s / 2);
    ctx.lineTo(s / 2, s * 0.6);
    ctx.lineTo(s * 0.4, s / 2);
    ctx.closePath();
    ctx.fill();
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 30;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makePictureTexture(rand) {
  return canvasTexture(256, (ctx, s) => {
    const sky = ctx.createLinearGradient(0, 0, 0, s * 0.55);
    sky.addColorStop(0, '#d9b98e');
    sky.addColorStop(1, '#f1d9b4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s * 0.55);
    const sea = ctx.createLinearGradient(0, s * 0.55, 0, s);
    sea.addColorStop(0, '#6d7b80');
    sea.addColorStop(1, '#2f3a42');
    ctx.fillStyle = sea;
    ctx.fillRect(0, s * 0.55, s, s * 0.45);
    ctx.fillStyle = '#f7e6c6';
    ctx.beginPath();
    ctx.arc(s * 0.62, s * 0.42, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,30,20,0.55)';
    for (let i = 0; i < 5; i++) {
      const x = s * (0.1 + i * 0.18);
      ctx.beginPath();
      ctx.moveTo(x, s * 0.55);
      ctx.lineTo(x + s * 0.05, s * 0.55 - s * (0.04 + rand() * 0.05));
      ctx.lineTo(x + s * 0.1, s * 0.55);
      ctx.fill();
    }
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 22;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makeGrilleTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#2a2320';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#6e5a44';
    for (let x = 0; x < s; x += 8) ctx.fillRect(x, 0, 3, s);
  }, { repeat: [3, 1] });
}

export function createVilla() {
  const rand = createRandom(4242);
  const noise = createNoise(11);
  const group = new THREE.Group();
  group.name = 'villa';

  const wood = new THREE.MeshStandardMaterial({ map: makeWoodTexture(rand), roughness: 0.55, metalness: 0.02 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.7 });
  const plaster = new THREE.MeshStandardMaterial({ map: makePlasterTexture(rand), roughness: 0.95 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x8f7f6c, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.6 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x2c4a3a, roughness: 0.95 });
  const velvetLight = new THREE.MeshStandardMaterial({ color: 0x3a6250, roughness: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x9a7a45, roughness: 0.4, metalness: 0.7 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe6dccc, roughness: 0.6 });

  const add = (mesh, { cast = true, receive = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  };
  const box = (w, h, d, mat, x, y, z, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return add(m, opts);
  };

  // ---- 床・天井・壁
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 7), wood), { cast: false });
  floor.rotation.x = -Math.PI / 2;
  const ceiling = add(new THREE.Mesh(new THREE.PlaneGeometry(8, 7), ceilingMat), { cast: false });
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.2;
  box(8.2, 3.2, 0.12, plaster, 0, 1.6, 3.56); // 後ろ
  box(0.12, 3.2, 7.2, plaster, -4.06, 1.6, 0); // 左
  box(0.12, 3.2, 7.2, plaster, 4.06, 1.6, 0); // 右
  // 窓の壁（下・上・左右の袖）
  box(8.2, 0.55, 0.12, plaster, 0, 0.275, -3.56);
  box(8.2, 0.25, 0.12, plaster, 0, 3.075, -3.56);
  box(0.5, 3.2, 0.12, plaster, -3.75, 1.6, -3.56);
  box(0.5, 3.2, 0.12, plaster, 3.75, 1.6, -3.56);
  // 窓枠と桟
  box(7.1, 0.08, 0.1, metal, 0, 0.59, -3.5);
  box(7.1, 0.08, 0.1, metal, 0, 2.91, -3.5);
  box(0.08, 2.4, 0.1, metal, -3.54, 1.75, -3.5);
  box(0.08, 2.4, 0.1, metal, 3.54, 1.75, -3.5);
  for (const x of [-1.75, 0, 1.75]) box(0.06, 2.4, 0.08, metal, x, 1.75, -3.5);
  // ガラス
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 2.3),
    new THREE.MeshPhysicalMaterial({
      color: 0x9fbfe8,
      transparent: true,
      opacity: 0.06,
      roughness: 0.3,
      metalness: 0,
      specularIntensity: 0.3,
      depthWrite: false,
    }),
  );
  glass.name = 'glass';
  glass.position.set(0, 1.75, -3.5);
  group.add(glass);
  // 天井の梁
  for (const x of [-2.4, 0, 2.4]) box(0.14, 0.16, 7.0, darkWood, x, 3.1, 0);
  // 幅木
  box(8.0, 0.1, 0.03, darkWood, 0, 0.05, 3.48);
  box(0.03, 0.1, 7.0, darkWood, -3.98, 0.05, 0);
  box(0.03, 0.1, 7.0, darkWood, 3.98, 0.05, 0);

  // ---- ラグ
  const rug = add(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), new THREE.MeshStandardMaterial({ map: makeRugTexture(rand), roughness: 1 })), { cast: false });
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.2, 0.006, 1.2);

  // ---- 安楽椅子（カメラはこの上に座る）
  const chair = new THREE.Group();
  chair.position.set(0, 0, 1.5);
  const chairPart = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    chair.add(m);
    return m;
  };
  chairPart(0.95, 0.36, 0.9, velvet, 0, 0.26, 0);
  chairPart(0.85, 0.12, 0.8, velvetLight, 0, 0.5, -0.02);
  chairPart(0.95, 0.78, 0.22, velvet, 0, 0.78, 0.36);
  chairPart(0.14, 0.62, 0.9, velvet, -0.47, 0.5, 0);
  chairPart(0.14, 0.62, 0.9, velvet, 0.47, 0.5, 0);
  for (const [x, z] of [[-0.4, -0.38], [0.4, -0.38], [-0.4, 0.38], [0.4, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 10), darkWood);
    leg.position.set(x, 0.05, z);
    chair.add(leg);
  }
  group.add(chair);
  const seat = new THREE.Vector3(0, 1.22, 1.55);

  // ---- サイドテーブルとラジオ
  const table = new THREE.Group();
  table.position.set(1.15, 0, 1.3);
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 40), wood);
  tableTop.position.y = 0.64;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 16), darkWood);
  pedestal.position.y = 0.32;
  const tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 32), darkWood);
  tableBase.position.y = 0.015;
  for (const m of [tableTop, pedestal, tableBase]) {
    m.castShadow = true;
    m.receiveShadow = true;
    table.add(m);
  }
  group.add(table);

  const radio = new THREE.Group();
  radio.name = 'radio';
  radio.position.set(1.15, 0.66, 1.3);
  radio.rotation.y = -Math.PI / 2 - 0.35; // 正面（ダイヤル側）を椅子に向ける
  const radioBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.18), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.5 }));
  radioBody.position.y = 0.13;
  const radioFront = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.02), cream);
  radioFront.position.set(0, 0.13, 0.09);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.006), new THREE.MeshStandardMaterial({ map: makeGrilleTexture(), roughness: 0.8 }));
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
  const dialLight = new THREE.PointLight(0xffa040, 0, 1.4, 2);
  dialLight.position.set(0.1, 0.18, 0.16);
  for (const m of [radioBody, radioFront, grille, dial, needle, knob1, knob2, antenna]) {
    m.castShadow = true;
    m.receiveShadow = true;
    radio.add(m);
  }
  radio.add(dialLight);
  group.add(radio);

  // マグと本
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 20), cream);
  mug.position.set(0.9, 0.705, 1.52);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), cream);
  handle.position.set(0.945, 0.705, 1.52);
  const book1 = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.23), new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.8 }));
  book1.position.set(1.33, 0.675, 1.1);
  book1.rotation.y = 0.2;
  const book2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.025, 0.21), new THREE.MeshStandardMaterial({ color: 0x2f4a6b, roughness: 0.8 }));
  book2.position.set(1.33, 0.702, 1.1);
  book2.rotation.y = 0.05;
  for (const m of [mug, handle, book1, book2]) add(m);

  // ---- フロアランプ（主光源）
  const lamp = new THREE.Group();
  lamp.position.set(-1.7, 0, 0.8);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 32), brass);
  lampBase.position.y = 0.015;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.55, 12), brass);
  pole.position.y = 0.8;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 0.34, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf0d9b0, emissive: 0xffc080, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.9 }),
  );
  shade.position.y = 1.7;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd090, emissiveIntensity: 3 }));
  bulb.position.y = 1.64;
  const lampLight = new THREE.PointLight(0xffb46a, 18, 16, 2);
  lampLight.position.y = 1.62;
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(1024, 1024);
  lampLight.shadow.bias = -0.002;
  lampLight.shadow.radius = 3;
  for (const m of [lampBase, pole, shade]) {
    m.castShadow = m !== shade;
    m.receiveShadow = true;
  }
  lamp.add(lampBase, pole, shade, bulb, lampLight);
  group.add(lamp);

  // ---- 天井のペンダントランプ（部屋全体をほんのり暖める）
  const pendant = new THREE.Group();
  pendant.position.set(1.3, 0, 2.3);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 6), metal);
  cord.position.y = 2.9;
  const pShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.22, 0.2, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, emissive: 0xffb070, emissiveIntensity: 0.1, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  pShade.position.y = 2.55;
  const pBulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd090, emissiveIntensity: 0.8 }));
  pBulb.position.y = 2.5;
  const pendantLight = new THREE.PointLight(0xffc48a, 7, 12, 2);
  pendantLight.position.y = 2.45;
  pendant.add(cord, pShade, pBulb, pendantLight);
  group.add(pendant);

  // ---- 本棚（左の壁）
  const shelf = new THREE.Group();
  shelf.position.set(-3.83, 0, 0.6);
  shelf.rotation.y = Math.PI / 2;
  const shelfFrame = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkWood);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    shelf.add(m);
  };
  shelfFrame(0.04, 2.1, 0.3, -0.8, 1.05, 0);
  shelfFrame(0.04, 2.1, 0.3, 0.8, 1.05, 0);
  shelfFrame(1.64, 0.04, 0.3, 0, 2.1, 0);
  for (const y of [0.1, 0.62, 1.14, 1.66]) shelfFrame(1.6, 0.03, 0.3, 0, y, 0);
  const bookColors = [0x7a3b2e, 0x2f4a6b, 0x8a7a4a, 0x3a5a3a, 0x5a3a5a, 0x9a6a3a, 0x2a2a3a, 0xb09a6a];
  for (const y of [0.1, 0.62, 1.14, 1.66]) {
    let x = -0.76;
    while (x < 0.7) {
      const w = 0.03 + rand() * 0.05;
      const h = 0.2 + rand() * 0.22;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18 + rand() * 0.08), new THREE.MeshStandardMaterial({ color: bookColors[Math.floor(rand() * bookColors.length)], roughness: 0.85 }));
      m.position.set(x + w / 2, y + 0.015 + h / 2, 0.02 - rand() * 0.03);
      m.rotation.z = (rand() - 0.5) * 0.05;
      m.castShadow = true;
      shelf.add(m);
      x += w + 0.004;
      if (rand() < 0.08) x += 0.06;
    }
  }
  group.add(shelf);

  // ---- 額縁（右の壁）
  const frame = new THREE.Group();
  frame.position.set(3.93, 1.75, 0.2);
  frame.rotation.y = -Math.PI / 2;
  const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.58, 0.04), darkWood);
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshStandardMaterial({ map: makePictureTexture(rand), roughness: 0.7 }));
  picture.position.z = 0.021;
  frameOuter.castShadow = true;
  frame.add(frameOuter, picture);
  group.add(frame);

  // ---- 窓辺のベンチ・鉢植え・望遠鏡
  box(6.6, 0.42, 0.42, wood, 0, 0.21, -3.1);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.24, 20), new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.9 }));
  pot.position.set(-2.5, 0.54, -3.1);
  add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2b5a2f, roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.1 + rand() * 0.1, 10, 8), leafMat);
    leaf.position.set(-2.5 + (rand() - 0.5) * 0.4, 0.75 + rand() * 0.3, -3.1 + (rand() - 0.5) * 0.35);
    leaf.scale.y = 0.7;
    add(leaf);
  }
  const telescope = new THREE.Group();
  telescope.position.set(2.6, 0, -2.5);
  const apex = new THREE.Vector3(0, 1.15, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const foot = new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
    const legLen = apex.distanceTo(foot);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, legLen, 8), darkWood);
    leg.position.copy(apex).add(foot).multiplyScalar(0.5);
    leg.lookAt(foot.clone().add(telescope.position));
    leg.rotateX(Math.PI / 2);
    leg.castShadow = true;
    telescope.add(leg);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.75, 20), brass);
  tube.position.set(0, 1.22, 0);
  tube.rotation.set(-0.9, 0, -0.3);
  tube.castShadow = true;
  const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12), metal);
  eyepiece.position.set(0.08, 1.02, 0.28);
  eyepiece.rotation.set(-0.9, 0, -0.3);
  telescope.add(tube, eyepiece);
  group.add(telescope);

  // ---- カーテン（窓の両端、少し波打つ）
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x6b2f2f, roughness: 0.95, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.8, 2.6, 28, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin((x + 0.4) * Math.PI * 6) * 0.05 + noise.noise2(x * 3, pos.getY(i)) * 0.02);
    }
    geo.computeVertexNormals();
    const curtain = new THREE.Mesh(geo, curtainMat);
    curtain.position.set(side * 3.25, 1.75, -3.3);
    curtain.castShadow = true;
    curtain.receiveShadow = true;
    group.add(curtain);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 7.4, 10), brass);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 3.02, -3.3);
    group.add(rod);
  }

  // ---- 埃（ランプと窓の光の中を漂う）
  const dustN = 260;
  const dustPos = new Float32Array(dustN * 3);
  const dustSeed = new Float32Array(dustN);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = -2.6 + rand() * 5.2;
    dustPos[i * 3 + 1] = 0.3 + rand() * 2.6;
    dustPos[i * 3 + 2] = -3.2 + rand() * 5.5;
    dustSeed[i] = rand() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustSprite = (() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ size: 0.022, map: dustSprite, color: 0xffe0b0, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  group.add(dust);

  let time = 0;
  function update(dt) {
    time += dt;
    const p = dustGeo.attributes.position;
    for (let i = 0; i < dustN; i++) {
      const s = dustSeed[i];
      let y = p.getY(i) + Math.sin(time * 0.3 + s) * 0.0006 + 0.0004;
      let x = p.getX(i) + Math.cos(time * 0.2 + s * 1.3) * 0.0008;
      const z = p.getZ(i) + Math.sin(time * 0.17 + s * 0.7) * 0.0006;
      if (y > 3.0) y = 0.3;
      if (x > 2.7) x = -2.6;
      if (x < -2.7) x = 2.6;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    needle.position.x = 0.07 + Math.sin(time * 0.05) * 0.0;
  }

  function setRadioOn(on) {
    dialMat.emissiveIntensity = on ? 1.4 : 0;
    dialLight.intensity = on ? 0.6 : 0;
  }

  function setRadioNeedle(f) {
    needle.position.x = 0.045 + f * 0.11;
  }

  return { group, radio, seat, lampLight, update, setRadioOn, setRadioNeedle };
}
