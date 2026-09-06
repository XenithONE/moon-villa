import * as THREE from 'three';

function makeGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 加算合成の粒子。色を黒へ落とすことでフェードさせる（PointsMaterial は頂点αを持たない） */
function makeParticles(n, size, map) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.PointsMaterial({
    size,
    sizeAttenuation: true,
    map,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  return {
    points,
    pos: geo.attributes.position.array,
    col: geo.attributes.color.array,
    vel: new Float32Array(n * 3),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    n,
    cursor: 0,
    flush() {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

/**
 * 隕石 → 閃光 → 衝撃波 → 噴出物 → 塵のベール。
 * giant のときは規模 3.5 倍、地球が再びマグマ化し、デブリの環が現れる（この月の誕生）。
 */
export function createImpactFX({ scene, earth, camera, look, radio }) {
  const R = earth.radius;
  const earthPos = earth.group.position;
  const glowTex = makeGlowTexture();
  const group = new THREE.Group();
  group.name = 'impactFX';
  scene.add(group);

  // 隕石本体
  const rockGeo = new THREE.IcosahedronGeometry(1, 2);
  {
    const p = rockGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + Math.random() * 0.36;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
  }
  const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1, emissive: 0xff5a10, emissiveIntensity: 1.6 }));
  rock.visible = false;
  group.add(rock);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.visible = false;
  group.add(glow);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flash.visible = false;
  group.add(flash);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 96),
    new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.visible = false;
  group.add(ring);

  const trail = makeParticles(420, R * 0.06, glowTex);
  const ejecta = makeParticles(900, R * 0.045, glowTex);
  const debris = makeParticles(1600, R * 0.035, glowTex);
  group.add(trail.points, ejecta.points, debris.points);

  // 状態
  let phase = 'idle';
  let t = 0;
  let giant = false;
  let scale = 1;
  let approachDur = 3.2;
  let blastDur = 8;
  const start = new THREE.Vector3();
  const dirLocal = new THREE.Vector3(0, 0, 1);
  const dirWorld = new THREE.Vector3();
  const impactPoint = new THREE.Vector3();
  let dust = 0;
  let heat = 0;
  let flashV = 0;
  let ringR = 0;
  let ringA = 0;
  let debrisA = 0;
  const debrisE1 = new THREE.Vector3();
  const debrisE2 = new THREE.Vector3();
  const debrisR = new Float32Array(debris.n);
  const debrisTh = new Float32Array(debris.n);
  const debrisH = new Float32Array(debris.n);

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function refreshImpactPoint() {
    earth.localToWorldDir(dirLocal, dirWorld);
    impactPoint.copy(earthPos).addScaledVector(dirWorld, R);
  }

  function emit(sys, x, y, z, vx, vy, vz, life, r, g, b) {
    const i = sys.cursor;
    sys.cursor = (i + 1) % sys.n;
    sys.pos[i * 3] = x;
    sys.pos[i * 3 + 1] = y;
    sys.pos[i * 3 + 2] = z;
    sys.vel[i * 3] = vx;
    sys.vel[i * 3 + 1] = vy;
    sys.vel[i * 3 + 2] = vz;
    sys.life[i] = life;
    sys.maxLife[i] = life;
    sys.col[i * 3] = r;
    sys.col[i * 3 + 1] = g;
    sys.col[i * 3 + 2] = b;
  }

  function stepParticles(sys, dt, gravity, fade) {
    let alive = 0;
    for (let i = 0; i < sys.n; i++) {
      if (sys.life[i] <= 0) continue;
      sys.life[i] -= dt;
      const k = Math.max(0, sys.life[i] / sys.maxLife[i]);
      let x = sys.pos[i * 3];
      let y = sys.pos[i * 3 + 1];
      let z = sys.pos[i * 3 + 2];
      if (gravity) {
        tmp.set(x - earthPos.x, y - earthPos.y, z - earthPos.z);
        const d = tmp.length();
        if (d < R * 0.995) {
          sys.life[i] = 0;
          sys.col[i * 3] = sys.col[i * 3 + 1] = sys.col[i * 3 + 2] = 0;
          continue;
        }
        tmp.multiplyScalar(-gravity * dt / d);
        sys.vel[i * 3] += tmp.x;
        sys.vel[i * 3 + 1] += tmp.y;
        sys.vel[i * 3 + 2] += tmp.z;
      }
      x += sys.vel[i * 3] * dt;
      y += sys.vel[i * 3 + 1] * dt;
      z += sys.vel[i * 3 + 2] * dt;
      sys.pos[i * 3] = x;
      sys.pos[i * 3 + 1] = y;
      sys.pos[i * 3 + 2] = z;
      fade(sys, i, k);
      alive++;
    }
    sys.flush();
    return alive;
  }

  const fadeTrail = (sys, i, k) => {
    const f = k * k;
    sys.col[i * 3] = 1.0 * f;
    sys.col[i * 3 + 1] = 0.45 * f * f;
    sys.col[i * 3 + 2] = 0.1 * f * f;
  };
  const fadeEjecta = (sys, i, k) => {
    const f = Math.pow(k, 1.3);
    sys.col[i * 3] = (0.35 + 0.65 * k) * f;
    sys.col[i * 3 + 1] = (0.3 + 0.3 * k) * f;
    sys.col[i * 3 + 2] = (0.3 + 0.05 * k) * f;
  };

  function clearParticles(sys) {
    sys.life.fill(0);
    sys.col.fill(0);
    sys.flush();
  }

  function trigger({ giant: g = false } = {}) {
    if (phase === 'approach' || phase === 'blast') return false;
    giant = g;
    scale = giant ? 3.5 : 1;
    approachDur = giant ? 4.6 : 3.2;
    blastDur = giant ? 11 : 8;
    // 見える側の衝突点
    const d = earth.visibleImpactDir(camera.position);
    earth.worldToLocalDir(d, dirLocal);
    refreshImpactPoint();
    // 進入開始点：地球の右上遠方から掠めるように
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dirWorld, up).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    start.copy(earthPos).addScaledVector(dirWorld, R * 1.4).addScaledVector(side, R * 4.2).addScaledVector(up, R * 2.2);
    const rockSize = giant ? R * 0.45 : R * 0.035;
    rock.scale.setScalar(rockSize);
    rock.visible = true;
    glow.visible = true;
    glow.scale.setScalar(rockSize * (giant ? 3.2 : 6));
    clearParticles(trail);
    clearParticles(ejecta);
    trail.points.visible = true;
    phase = 'approach';
    t = 0;
    flashV = 0;
    ringR = 0;
    ringA = 0;
    return true;
  }

  function burst() {
    refreshImpactPoint();
    flash.position.copy(impactPoint).addScaledVector(dirWorld, R * 0.05);
    flash.scale.setScalar(R * (giant ? 3.2 : 1.4));
    flash.visible = true;
    ring.position.copy(impactPoint).addScaledVector(dirWorld, R * 0.02);
    ring.lookAt(tmp.copy(impactPoint).addScaledVector(dirWorld, 10));
    ring.scale.setScalar(R * 0.05);
    ring.material.opacity = 1;
    ring.visible = true;
    // 噴出物
    const n = giant ? ejecta.n : Math.floor(ejecta.n * 0.6);
    const tang1 = new THREE.Vector3().crossVectors(dirWorld, new THREE.Vector3(0, 1, 0)).normalize();
    if (tang1.lengthSq() < 0.01) tang1.set(1, 0, 0);
    const tang2 = new THREE.Vector3().crossVectors(dirWorld, tang1).normalize();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = Math.random() * 0.55 * scale;
      const speed = (0.28 + Math.random() * 0.5) * R * (giant ? 1.6 : 1);
      tmp.copy(dirWorld).multiplyScalar(speed);
      tmp.addScaledVector(tang1, Math.cos(a) * spread * R).addScaledVector(tang2, Math.sin(a) * spread * R);
      emit(ejecta, impactPoint.x, impactPoint.y, impactPoint.z, tmp.x, tmp.y, tmp.z, 3 + Math.random() * 4, 1, 0.6, 0.3);
    }
    ejecta.points.visible = true;
    rock.visible = false;
    glow.visible = false;
    look.shake(giant ? 1.4 : 0.5);
    radio?.impactSound?.(giant);

    if (giant) {
      // デブリの環：衝突方向に傾いた平面
      debrisE1.copy(dirWorld).normalize();
      debrisE2.crossVectors(debrisE1, new THREE.Vector3(0.2, 1, 0.1)).normalize();
      debrisE1.crossVectors(debrisE2, new THREE.Vector3(0.2, 1, 0.1)).normalize();
      for (let i = 0; i < debris.n; i++) {
        debrisR[i] = R * (1.35 + Math.pow(Math.random(), 0.7) * 1.4);
        debrisTh[i] = Math.random() * Math.PI * 2;
        debrisH[i] = (Math.random() - 0.5) * R * 0.12;
        debris.life[i] = 1;
      }
      debris.points.visible = true;
      debrisA = 0;
    }
  }

  function updateDebris(dt) {
    if (!debris.points.visible) return;
    for (let i = 0; i < debris.n; i++) {
      const r = debrisR[i];
      debrisTh[i] += dt * 0.35 / Math.sqrt(r / R);
      const c = Math.cos(debrisTh[i]);
      const s = Math.sin(debrisTh[i]);
      debris.pos[i * 3] = earthPos.x + (debrisE1.x * c + debrisE2.x * s) * r + debrisH[i] * dirWorld.x;
      debris.pos[i * 3 + 1] = earthPos.y + (debrisE1.y * c + debrisE2.y * s) * r + debrisH[i] * dirWorld.y;
      debris.pos[i * 3 + 2] = earthPos.z + (debrisE1.z * c + debrisE2.z * s) * r + debrisH[i] * dirWorld.z;
      const w = (i % 7) / 7;
      debris.col[i * 3] = (0.9 - 0.4 * w) * debrisA;
      debris.col[i * 3 + 1] = (0.5 - 0.25 * w) * debrisA;
      debris.col[i * 3 + 2] = (0.25 - 0.1 * w) * debrisA;
    }
    debris.flush();
  }

  function update(dt) {
    if (phase === 'idle') return;
    t += dt;

    if (phase === 'approach') {
      refreshImpactPoint();
      const s = Math.min(1, t / approachDur);
      const k = Math.pow(s, 1.7);
      rock.position.lerpVectors(start, impactPoint, k);
      rock.rotation.x += dt * 1.3;
      rock.rotation.y += dt * 0.9;
      glow.position.copy(rock.position);
      const near = 1 + s * s * 2.5;
      glow.scale.setScalar(rock.scale.x * (giant ? 3.2 : 6) * near);
      // 尾
      tmp.subVectors(impactPoint, start).normalize();
      const emitN = giant ? 10 : 7;
      for (let i = 0; i < emitN; i++) {
        const j = (0.5 + Math.random() * 0.5) * rock.scale.x;
        emit(
          trail,
          rock.position.x + (Math.random() - 0.5) * j, rock.position.y + (Math.random() - 0.5) * j, rock.position.z + (Math.random() - 0.5) * j,
          -tmp.x * R * 0.25 + (Math.random() - 0.5) * R * 0.08, -tmp.y * R * 0.25 + (Math.random() - 0.5) * R * 0.08, -tmp.z * R * 0.25 + (Math.random() - 0.5) * R * 0.08,
          0.9 + Math.random() * 0.8, 1, 0.5, 0.15,
        );
      }
      stepParticles(trail, dt, 0, fadeTrail);
      if (s >= 1) {
        burst();
        phase = 'blast';
        t = 0;
      }
    } else if (phase === 'blast') {
      refreshImpactPoint();
      flashV = Math.exp(-t * 2.4);
      flash.material.opacity = Math.min(1, flashV * 1.5);
      flash.scale.setScalar(R * (giant ? 3.2 : 1.4) * (1 + t * 0.6));
      flash.visible = flashV > 0.02;
      const ringMax = giant ? 1.1 : 0.42;
      ringR = ringMax * (1 - Math.exp(-t * 0.8));
      ringA = Math.max(0, 1 - t / 3.2);
      ring.scale.setScalar(R * Math.sin(Math.min(ringR, 1.5)) * 1.02 + R * 0.05);
      ring.material.opacity = ringA * 0.9;
      ring.visible = ringA > 0;
      dust = Math.min(1, t / 2.5) * (giant ? 1 : 0.85);
      if (giant) {
        heat = Math.min(1, t / 1.6);
        debrisA = Math.min(1, Math.max(0, (t - 2.5) / 3));
      }
      stepParticles(trail, dt, 0, fadeTrail);
      stepParticles(ejecta, dt, R * 0.32 * (giant ? 1.4 : 1), fadeEjecta);
      updateDebris(dt);
      if (t >= blastDur) {
        phase = 'after';
        t = 0;
      }
    } else if (phase === 'after') {
      flash.visible = false;
      ring.visible = false;
      trail.points.visible = false;
      dust = Math.max(0, dust - dt * (giant ? 0.03 : 0.045));
      heat = Math.max(0, heat - dt * 0.05);
      if (debris.points.visible) {
        debrisA = Math.max(0, debrisA - dt * 0.05);
        updateDebris(dt);
        if (debrisA <= 0) debris.points.visible = false;
      }
      const alive = stepParticles(ejecta, dt, R * 0.32, fadeEjecta);
      if (alive === 0) ejecta.points.visible = false;
      if (dust <= 0.001 && heat <= 0.001 && !debris.points.visible && alive === 0) {
        phase = 'idle';
        earth.setImpact({ flash: 0, ring: 0, ringA: 0, dust: 0, heat: 0 });
        return;
      }
    }
    earth.setImpact({ dirLocal, flash: flashV, ring: ringR, ringA, dust, heat });
  }

  /** 途中で止める（手動スクラブ時）。塵も熱も即座に消す */
  function cancel() {
    phase = 'idle';
    t = 0;
    dust = 0;
    heat = 0;
    flashV = 0;
    ringR = 0;
    ringA = 0;
    debrisA = 0;
    rock.visible = false;
    glow.visible = false;
    flash.visible = false;
    ring.visible = false;
    trail.points.visible = false;
    ejecta.points.visible = false;
    debris.points.visible = false;
    clearParticles(trail);
    clearParticles(ejecta);
    earth.setImpact({ flash: 0, ring: 0, ringA: 0, dust: 0, heat: 0 });
  }

  return {
    trigger,
    update,
    cancel,
    get active() { return phase !== 'idle'; },
    get phase() { return phase; },
  };
}
