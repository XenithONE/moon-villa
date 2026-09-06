import * as THREE from 'three';

/**
 * 一人称の「座る／歩く」視点。
 *
 * - ドラッグ（マウス左ボタン／タッチ／ペン）で見回す。座位はヨー ±1.4 rad・ピッチ [−.6, .85]、
 *   歩行はヨー無制限・ピッチ [−1.2, 1.3]。座位でドラッグしていない時はポインタ位置で視線がわずかに流れる。
 * - WASD／矢印で移動（加速・減速の慣性つき、Shift で早歩き）。座位では移動しない。
 * - XZ の矩形障害物（AABB を radius だけ膨らませる）と床範囲に対するスライド衝突。
 * - sit() は座席へ 0.9 s、stand() は座席の少し後ろへ 0.6 s の smoothstep 補間（補間中は移動不可）。
 * - 座位の呼吸のゆらぎ・衝撃の shake は seatedLook.js と同式。
 *
 * villa.js は import しない。bounds / colliders の形（{minX,maxX,minZ,maxZ}）にだけ依存する。
 * 壊れた矩形（欠損・NaN・裏返り）は警告して無視する。camera.rotation.order は生成時に 'YXZ' へ設定する。
 * キーは物理キー（e.code）優先・無ければ e.key（小文字化）で判定するので、配列が QWERTY でなくても動く。
 */
export function createWalkControls(camera, dom, {
  eyeHeight = 1.62,
  seat = new THREE.Vector3(0.2, 1.1, 1.32),
  seatLook = { yaw: 0, pitch: 0.17 },
  bounds = null,
  colliders = [],
  radius = 0.32,
  walkSpeed = 1.6,
  runSpeed = 3.0,
} = {}) {
  // ---- 定数
  const SEAT_YAW_LIMIT = 1.4;
  const SEAT_PITCH_MIN = -0.6;
  const SEAT_PITCH_MAX = 0.85;
  const WALK_PITCH_MIN = -1.2;
  const WALK_PITCH_MAX = 1.3;
  const SENS_MOUSE = 0.0034;
  const SENS_TOUCH = 0.005;
  const FOLLOW = 4.5; // 視線の追従 k = min(1, 4.5 dt)
  const ACCEL = 8; // 速度平滑 v += (target − v)·min(1, 8 dt)
  const SIT_DURATION = 0.9;
  const STAND_DURATION = 0.6;
  const STAND_BACK = 0.9; // 立ち上がる位置は座席の +z 側
  const STAND_PITCH = 0.05;
  const BOB_AMP = 0.025;
  const BOB_HZ = 1.9;
  const BOB_REF = Math.max(walkSpeed, 1e-3); // 頭揺れの振幅を正規化する速さ（0 除算を避ける）
  const EPS = 1e-4;
  const TWO_PI = Math.PI * 2;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrapPi = (a) => ((((a + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  const smoothstep = (u) => u * u * (3 - 2 * u);

  // ---- 状態
  let mode = 'seated';
  const pos = new THREE.Vector3().copy(seat);
  let yaw = seatLook.yaw;
  let pitch = seatLook.pitch;
  let targetYaw = yaw;
  let targetPitch = pitch;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hoverX = 0;
  let hoverY = 0;
  let shakeAmt = 0;
  let time = 0;
  let bobPhase = 0;
  const vel = new THREE.Vector2(); // (x, z)
  /** 押下中の移動キー: keyId（e.code、無ければ小文字化した e.key）→ 'f'|'b'|'l'|'r' */
  const held = new Map();
  let shift = false;
  let dragId = null; // 見回しに使っているポインタ（多点タッチで 2 本目に乗っ取られないように）
  /** 補間中: { t, dur, fromPos, toPos, fromYaw, fromPitch } */
  let trans = null;

  const tmpV3 = new THREE.Vector3();
  const prevPos = new THREE.Vector3();

  // ---- 見回し（ドラッグ）
  function clampTargetLook() {
    if (mode === 'seated') {
      targetYaw = clamp(targetYaw, seatLook.yaw - SEAT_YAW_LIMIT, seatLook.yaw + SEAT_YAW_LIMIT);
      targetPitch = clamp(targetPitch, SEAT_PITCH_MIN, SEAT_PITCH_MAX);
    } else {
      targetPitch = clamp(targetPitch, WALK_PITCH_MIN, WALK_PITCH_MAX);
    }
  }

  // ドラッグ中は最初のポインタだけを見る（ピンチの 2 本目で視線が跳ばない）
  const isOtherPointer = (e) => dragging && dragId !== null && e.pointerId !== undefined && e.pointerId !== dragId;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (dragging) return;
    dragging = true;
    dragId = e.pointerId ?? null;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      dom.setPointerCapture?.(e.pointerId);
    } catch {
      // ポインタが既に無効（合成イベント等）なら捕捉しない: InvalidStateError
    }
    dom.classList?.add('dragging');
  }
  function onPointerMove(e) {
    if (isOtherPointer(e)) return;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    hoverX = clamp((e.clientX / w) * 2 - 1, -1, 1);
    hoverY = clamp((e.clientY / h) * 2 - 1, -1, 1);
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const k = e.pointerType === 'touch' ? SENS_TOUCH : SENS_MOUSE;
    targetYaw -= dx * k;
    targetPitch -= dy * k;
    clampTargetLook();
  }
  function endDrag() {
    dragging = false;
    dragId = null;
    dom.classList?.remove('dragging');
  }
  function onPointerUp(e) {
    if (!dragging || isOtherPointer(e)) return;
    endDrag();
  }

  // ---- キー入力（window の capture で拾う）
  // keyId は keydown と keyup で同じ文字列になるように e.code を優先し、無ければ e.key を小文字化する
  // （'a' で押して Shift を挟み 'A' で離しても押しっぱなしにならない）。
  // 向きは code が移動キーでなければ key で判定する（AZERTY の 'w' は code KeyZ）。
  const CODE_DIR = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  const KEY_DIR = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
  const isTextTarget = (t) =>
    !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable === true);
  const lowerKey = (e) => (typeof e.key === 'string' ? e.key.toLowerCase() : '');
  const keyId = (e) => e.code || lowerKey(e);
  const dirOf = (e) => CODE_DIR[e.code] || KEY_DIR[lowerKey(e)] || null;
  const isArrow = (e) => (typeof e.code === 'string' && e.code.startsWith('Arrow')) || lowerKey(e).startsWith('arrow');

  function onKeyDown(e) {
    if (isTextTarget(e.target)) return;
    shift = !!e.shiftKey;
    const dir = dirOf(e);
    if (!dir) return;
    held.set(keyId(e), dir);
    // 歩行中の矢印は HUD（←→ シーク）に渡さない。座位中はそのまま通す。
    if (mode === 'walking' && isArrow(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onKeyUp(e) {
    // 離す操作はフォーカス先に関わらず受ける（キーが押しっぱなしにならないように）
    shift = !!e.shiftKey;
    held.delete(keyId(e));
  }
  function onBlur() {
    held.clear();
    shift = false;
    endDrag();
  }

  dom.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });

  // ---- 衝突（XZ の円 vs 膨らませた AABB、最小侵入軸へ押し出し）
  // 壊れた矩形（欠損・NaN・裏返り）は無視する。放置すると比較が全部 false になり p が NaN に化けて
  // カメラごと消える。NaN との比較は false なので isBox 一発で弾ける。
  const isBox = (c) => !!c && c.minX < c.maxX && c.minZ < c.maxZ;
  if (Array.isArray(colliders)) {
    const bad = colliders.filter((c) => !isBox(c));
    if (bad.length) console.warn('[walk] malformed colliders are ignored:', bad);
  } else {
    colliders = [];
  }
  if (bounds && !isBox(bounds)) {
    console.warn('[walk] malformed bounds are ignored:', bounds);
    bounds = null;
  }
  function resolveColliders(p) {
    if (colliders.length === 0) return;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const c of colliders) {
        if (!isBox(c)) continue;
        const minX = c.minX - radius;
        const maxX = c.maxX + radius;
        const minZ = c.minZ - radius;
        const maxZ = c.maxZ + radius;
        if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;
        const dxMin = p.x - minX;
        const dxMax = maxX - p.x;
        const dzMin = p.z - minZ;
        const dzMax = maxZ - p.z;
        const px = Math.min(dxMin, dxMax);
        const pz = Math.min(dzMin, dzMax);
        if (px <= pz) p.x = dxMin < dxMax ? minX - EPS : maxX + EPS;
        else p.z = dzMin < dzMax ? minZ - EPS : maxZ + EPS;
        hit = true;
      }
      if (!hit) break;
    }
  }
  function clampBounds(p) {
    if (!bounds) return;
    p.x = clamp(p.x, bounds.minX, bounds.maxX);
    p.z = clamp(p.z, bounds.minZ, bounds.maxZ);
  }
  function settle(p) {
    resolveColliders(p);
    clampBounds(p);
  }

  // ---- 補間
  function startTransition(toPos, toYaw, toPitch, dur) {
    trans = {
      t: 0,
      dur,
      fromPos: pos.clone(),
      toPos: toPos.clone(),
      fromYaw: yaw,
      fromPitch: pitch,
    };
    targetYaw = toYaw;
    targetPitch = toPitch;
  }

  function sit() {
    if (mode === 'seated' && !trans) return;
    mode = 'seated';
    vel.set(0, 0);
    // 何周も回った後でも最短で座席の向きへ戻る
    yaw = seatLook.yaw + wrapPi(yaw - seatLook.yaw);
    startTransition(seat, seatLook.yaw, seatLook.pitch, SIT_DURATION);
  }

  function stand() {
    if (mode === 'walking' && !trans) return;
    mode = 'walking';
    vel.set(0, 0);
    const to = tmpV3.set(seat.x, eyeHeight, seat.z + STAND_BACK);
    settle(to); // 座席の後ろが家具に掛かっていても外へ
    // 向きは進行中の目標（ドラッグの追従残り）をそのまま引き継ぐ
    startTransition(to, targetYaw, STAND_PITCH, STAND_DURATION);
  }

  function toggle() {
    if (mode === 'seated') stand();
    else sit();
  }

  // ---- 移動
  function stepWalk(dt) {
    let f = 0;
    let r = 0;
    if (held.size > 0) {
      let hf = false;
      let hb = false;
      let hl = false;
      let hr = false;
      for (const d of held.values()) {
        if (d === 'f') hf = true;
        else if (d === 'b') hb = true;
        else if (d === 'l') hl = true;
        else hr = true;
      }
      f = (hf ? 1 : 0) - (hb ? 1 : 0);
      r = (hr ? 1 : 0) - (hl ? 1 : 0);
    }
    let tx = 0;
    let tz = 0;
    if (f !== 0 || r !== 0) {
      const inv = 1 / Math.hypot(f, r);
      const sp = (shift ? runSpeed : walkSpeed) * inv;
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      // 前 = (−sin yaw, −cos yaw)、右 = (cos yaw, −sin yaw)
      tx = (-sy * f + cy * r) * sp;
      tz = (-cy * f - sy * r) * sp;
    }
    const k = Math.min(1, ACCEL * dt);
    vel.x += (tx - vel.x) * k;
    vel.y += (tz - vel.y) * k;

    prevPos.copy(pos);
    pos.x += vel.x * dt;
    resolveColliders(pos);
    pos.z += vel.y * dt;
    resolveColliders(pos);
    clampBounds(pos);
    pos.y = eyeHeight;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
      // 万一 NaN が混ざったら直前の位置へ戻す（カメラが消えて復帰不能になるのを防ぐ）
      pos.copy(prevPos);
      vel.set(0, 0);
    }

    // 壁に押し付けている間は揺れない：実際に進んだ速さで頭揺れを駆動
    const moved = dt > 0 ? Math.hypot(pos.x - prevPos.x, pos.z - prevPos.z) / dt : 0;
    const speed = Math.min(moved, vel.length());
    bobPhase += TWO_PI * BOB_HZ * dt;
    return speed;
  }

  // ---- 毎フレーム
  function update(dt) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    time += dt;
    let speed = 0;

    if (trans) {
      trans.t += dt;
      const u = Math.min(1, trans.t / trans.dur);
      const s = smoothstep(u);
      pos.lerpVectors(trans.fromPos, trans.toPos, s);
      yaw = trans.fromYaw + (targetYaw - trans.fromYaw) * s;
      pitch = trans.fromPitch + (targetPitch - trans.fromPitch) * s;
      if (u >= 1) {
        trans = null;
        if (mode === 'walking') settle(pos);
      }
    } else {
      const seated = mode === 'seated';
      const idleYaw = seated && !dragging ? -hoverX * 0.07 : 0;
      const idlePitch = seated && !dragging ? -hoverY * 0.045 : 0;
      const k = Math.min(1, dt * FOLLOW);
      yaw += (targetYaw + idleYaw - yaw) * k;
      pitch += (targetPitch + idlePitch - pitch) * k;
      if (seated) {
        pos.copy(seat);
      } else {
        speed = stepWalk(dt);
        // 何周も回った分は落として精度を保つ（yaw と targetYaw を同じだけずらす）
        if (Math.abs(yaw) > 8 * Math.PI) {
          const n = Math.round(yaw / TWO_PI) * TWO_PI;
          yaw -= n;
          targetYaw -= n;
        }
      }
    }

    camera.position.copy(pos);
    if (mode === 'seated') {
      camera.position.y += Math.sin(time * 0.55) * 0.005;
      camera.position.x += Math.sin(time * 0.31) * 0.002;
    } else if (speed > 0) {
      camera.position.y += BOB_AMP * Math.sin(bobPhase) * (speed / BOB_REF);
    }
    if (shakeAmt > 0.001) {
      camera.position.x += (Math.random() - 0.5) * shakeAmt * 0.05;
      camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.04;
      camera.rotation.z = (Math.random() - 0.5) * shakeAmt * 0.01;
      shakeAmt *= Math.exp(-dt * 2.6);
    } else {
      camera.rotation.z = 0;
    }
    camera.rotation.x = pitch;
    camera.rotation.y = yaw;
  }

  function shake(amount) {
    shakeAmt = Math.max(shakeAmt, amount);
  }

  /** 現在位置から worldPos を見る向きを目標にする（座位はクランプ）。instant で即座に向く。 */
  function lookAt(worldPos, { instant = false } = {}) {
    const d = tmpV3.subVectors(worldPos, pos);
    if (d.lengthSq() < 1e-10) return;
    d.normalize();
    const rawYaw = Math.atan2(-d.x, -d.z);
    const rawPitch = Math.asin(clamp(d.y, -1, 1));
    if (mode === 'seated') {
      targetYaw = seatLook.yaw + clamp(wrapPi(rawYaw - seatLook.yaw), -SEAT_YAW_LIMIT, SEAT_YAW_LIMIT);
      targetPitch = clamp(rawPitch, SEAT_PITCH_MIN, SEAT_PITCH_MAX);
    } else {
      targetYaw = yaw + wrapPi(rawYaw - yaw);
      targetPitch = clamp(rawPitch, WALK_PITCH_MIN, WALK_PITCH_MAX);
    }
    if (instant) {
      yaw = targetYaw;
      pitch = targetPitch;
      if (trans) {
        trans.fromYaw = yaw;
        trans.fromPitch = pitch;
      }
    }
  }

  function dispose() {
    dom.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    endDrag();
    held.clear();
  }

  // 初期姿勢を即座に反映。yaw→rotation.y・pitch→rotation.x と直書きするので順序は YXZ でなければならない
  camera.rotation.order = 'YXZ';
  camera.position.copy(pos);
  camera.rotation.x = pitch;
  camera.rotation.y = yaw;

  return {
    update,
    sit,
    stand,
    toggle,
    shake,
    lookAt,
    dispose,
    get mode() { return mode; },
    get dragging() { return dragging; },
    /** 補間（着席／起立）中か */
    get transitioning() { return trans !== null; },
    /** 目の位置（読み取り専用のつもりで扱う） */
    get position() { return pos; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
  };
}
