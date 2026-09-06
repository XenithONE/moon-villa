import * as THREE from 'three';

/**
 * 着座視点。ドラッグで見回し、ドラッグしていない時はポインタ位置でわずかに視線が流れる。
 * 立ち上がらない（位置は椅子に固定・呼吸のゆらぎと衝撃の揺れだけ）。
 */
export function createSeatedLook(camera, dom, {
  baseYaw = 0,
  basePitch = 0.1,
  yawLimit = 1.4,
  pitchMin = -0.65,
  pitchMax = 0.8,
} = {}) {
  let yaw = baseYaw;
  let pitch = basePitch;
  let targetYaw = yaw;
  let targetPitch = pitch;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hoverX = 0;
  let hoverY = 0;
  let shakeAmt = 0;
  let time = 0;
  const basePos = camera.position.clone();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture?.(e.pointerId);
    dom.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    hoverX = (e.clientX / window.innerWidth) * 2 - 1;
    hoverY = (e.clientY / window.innerHeight) * 2 - 1;
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const k = e.pointerType === 'touch' ? 0.005 : 0.0034;
    targetYaw = clamp(targetYaw - dx * k, baseYaw - yawLimit, baseYaw + yawLimit);
    targetPitch = clamp(targetPitch - dy * k, pitchMin, pitchMax);
  });
  const end = () => {
    dragging = false;
    dom.classList.remove('dragging');
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);

  function update(dt) {
    time += dt;
    const idleYaw = dragging ? 0 : -hoverX * 0.07;
    const idlePitch = dragging ? 0 : -hoverY * 0.045;
    const k = Math.min(1, dt * 4.5);
    yaw += (targetYaw + idleYaw - yaw) * k;
    pitch += (targetPitch + idlePitch - pitch) * k;

    camera.position.copy(basePos);
    camera.position.y += Math.sin(time * 0.55) * 0.005;
    camera.position.x += Math.sin(time * 0.31) * 0.002;
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

  function lookAt(worldPos, { instant = false } = {}) {
    const d = new THREE.Vector3().subVectors(worldPos, basePos).normalize();
    targetYaw = clamp(Math.atan2(-d.x, -d.z), baseYaw - yawLimit, baseYaw + yawLimit);
    targetPitch = clamp(Math.asin(d.y), pitchMin, pitchMax);
    if (instant) {
      yaw = targetYaw;
      pitch = targetPitch;
    }
  }

  return { update, shake, lookAt, get dragging() { return dragging; } };
}
