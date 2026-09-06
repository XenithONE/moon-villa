import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEarth } from '../src/scene/earth.js';
import { EARTH_VERT, EARTH_FRAG, ATMO_VERT, ATMO_FRAG } from '../src/scene/earthShader.js';
import { epochParams, yearFromT } from '../src/time/epochs.js';

const SUN_DIR = new THREE.Vector3(0.53, 0.56, -0.64).normalize();
const RADIUS = 72;
// three が全 ShaderMaterial に注入する組み込みユニフォーム（宣言不要・JS 側にも無い）
const BUILTIN_UNIFORMS = new Set(['modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic']);
// フラグメントシェーダには three が渡さない（vertex だけ）
const FRAG_UNAVAILABLE = ['modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'normalMatrix', 'position', 'normal', 'uv'];

function stripComments(src) {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
function declarations(src, kind) {
  const re = new RegExp(`^\\s*${kind}\\s+(?:(?:highp|mediump|lowp)\\s+)?(\\w+)\\s+(\\w+)\\s*;`, 'gm');
  const out = new Map();
  for (const m of stripComments(src).matchAll(re)) out.set(m[2], m[1]);
  return out;
}
function countWord(src, word) {
  return (stripComments(src).match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
}
function braceBalance(src) {
  const s = stripComments(src);
  let d = 0;
  for (const ch of s) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    assert.ok(d >= 0, 'closing brace before opening');
  }
  return d;
}

function makeEarth() {
  return createEarth({ radius: RADIUS, sunDir: SUN_DIR });
}
function stateAt(t) {
  const year = yearFromT(t);
  return { year, t, params: epochParams(year), playing: true, holding: false };
}
function assertFiniteUniforms(uniforms, label) {
  for (const [k, u] of Object.entries(uniforms)) {
    const v = u.value;
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${label}.${k} = ${v}`);
    else if (v?.isVector3) assert.ok([v.x, v.y, v.z].every(Number.isFinite), `${label}.${k} = ${v.toArray()}`);
    else if (v?.isColor) assert.ok([v.r, v.g, v.b].every(Number.isFinite), `${label}.${k} = ${[v.r, v.g, v.b]}`);
    else assert.fail(`${label}.${k}: unexpected uniform type`);
  }
}

test('createEarth は契約どおりの戻り値を返す', () => {
  const e = makeEarth();
  assert.ok(e.group.isGroup);
  assert.ok(e.surface.isMesh);
  assert.equal(e.radius, RADIUS);
  assert.equal(typeof e.uniforms, 'object');
  for (const fn of ['update', 'setImpact', 'visibleImpactDir', 'worldToLocalDir', 'localToWorldDir']) {
    assert.equal(typeof e[fn], 'function', fn);
  }
  assert.ok(e.surface.material.isShaderMaterial);
  assert.equal(e.surface.geometry.parameters.radius, RADIUS);
  const atmo = e.group.getObjectByName('earthAtmosphere');
  assert.ok(atmo?.isMesh, 'atmosphere mesh');
  assert.equal(atmo.material.side, THREE.BackSide);
  assert.equal(atmo.material.transparent, true);
  assert.equal(atmo.material.depthWrite, false);
  assert.ok(atmo.geometry.parameters.radius > RADIUS && atmo.geometry.parameters.radius < RADIUS * 1.2);
  // 自転軸の傾き
  assert.ok(Math.abs(e.group.rotation.z - THREE.MathUtils.degToRad(23.4)) < 1e-9);
  // 入力の sunDir を掴んだままにしない（clone）
  assert.notEqual(e.uniforms.uSunDir.value, SUN_DIR);
  assert.ok(e.uniforms.uSunDir.value.distanceTo(SUN_DIR) < 1e-9);
});

test('GLSL: JS ユニフォームとシェーダ宣言が過不足なく一致する（表面・大気殻）', () => {
  const e = makeEarth();
  const atmo = e.group.getObjectByName('earthAtmosphere');
  for (const [label, uniforms, vert, frag] of [
    ['surface', e.uniforms, EARTH_VERT, EARTH_FRAG],
    ['atmosphere', atmo.material.uniforms, ATMO_VERT, ATMO_FRAG],
  ]) {
    const declared = new Map([...declarations(vert, 'uniform'), ...declarations(frag, 'uniform')]);
    for (const name of Object.keys(uniforms)) {
      assert.ok(declared.has(name), `${label}: JS uniform ${name} はシェーダで宣言されていない`);
    }
    for (const [name, type] of declared) {
      if (BUILTIN_UNIFORMS.has(name)) continue;
      assert.ok(name in uniforms, `${label}: shader uniform ${name} が JS 側に無い`);
      const v = uniforms[name].value;
      const expect = { float: (x) => typeof x === 'number', vec3: (x) => x?.isVector3 || x?.isColor };
      assert.ok(expect[type], `${label}: ${name} の型 ${type} は未対応`);
      assert.ok(expect[type](v), `${label}: ${name} の JS 値の型が ${type} と合わない`);
      // 宣言以外に最低 1 回は参照されている（死んだユニフォームは名前違いの兆候）
      assert.ok(countWord(vert, name) + countWord(frag, name) >= 2, `${label}: ${name} は宣言のみで未使用`);
    }
  }
});

test('GLSL: varying は頂点／フラグメントで名前と型が一致し、微分関数は fragment だけ', () => {
  for (const [label, vert, frag] of [['surface', EARTH_VERT, EARTH_FRAG], ['atmosphere', ATMO_VERT, ATMO_FRAG]]) {
    const vv = declarations(vert, 'varying');
    const fv = declarations(frag, 'varying');
    assert.deepEqual([...vv.entries()].sort(), [...fv.entries()].sort(), `${label}: varying の不一致`);
    for (const name of vv.keys()) {
      assert.ok(countWord(vert, name) >= 2, `${label}: ${name} が vertex で書かれていない`);
      assert.ok(countWord(frag, name) >= 2, `${label}: ${name} が fragment で読まれていない`);
    }
    assert.equal(braceBalance(vert), 0, `${label}: vertex の波括弧`);
    assert.equal(braceBalance(frag), 0, `${label}: fragment の波括弧`);
    assert.ok(!/#version/.test(vert + frag), `${label}: #version は three が付ける`);
    assert.ok(!/\b(dFdx|dFdy|fwidth)\s*\(/.test(stripComments(vert)), `${label}: vertex で微分関数`);
    for (const w of FRAG_UNAVAILABLE) {
      assert.equal(countWord(frag, w), 0, `${label}: fragment で ${w} は使えない`);
    }
    // 関数は使う前に定義されている（snoise / fbm がノイズ定義より前で呼ばれていない）
    const body = stripComments(frag);
    const noiseAt = body.indexOf('float snoise(');
    const firstUse = body.search(/\b(fbm|snoise)\s*\(/);
    if (noiseAt >= 0) assert.ok(firstUse >= noiseAt, `${label}: snoise/fbm が定義より前で使われている`);
  }
});

test('update: 全時代を通してユニフォームが有限で、比率は [0,1]、大気殻の厚みは clamp 範囲', () => {
  const e = makeEarth();
  const atmo = e.group.getObjectByName('earthAtmosphere').material.uniforms;
  const ratios = ['uMagma', 'uOcean', 'uLand', 'uSuper', 'uVeg', 'uHaze', 'uIce', 'uSnowball', 'uClouds', 'uCity', 'uScorch'];
  for (let i = 0; i <= 400; i++) {
    const st = stateAt(i / 400);
    e.update(1 / 60, st);
    assertFiniteUniforms(e.uniforms, `t=${i / 400} surface`);
    assertFiniteUniforms(atmo, `t=${i / 400} atmo`);
    for (const k of ratios) {
      const v = e.uniforms[k].value;
      assert.ok(v >= 0 && v <= 1, `${k} = ${v} at t=${i / 400}`);
    }
    assert.ok(atmo.uThick.value >= 0.35 && atmo.uThick.value <= 1.6, `uThick ${atmo.uThick.value}`);
    assert.ok(atmo.uStrength.value > 0);
    assert.ok(e.uniforms.uSunIntensity.value > 0);
  }
  assert.ok(e.uniforms.uTime.value > 6.6);
  assert.ok(e.surface.rotation.y > 0.1, '自転している');
});

test('update: 時代の変化がユニフォームに現れる（マグマ→海、靄→青、都市、焦土）', () => {
  const e = makeEarth();
  const atmo = e.group.getObjectByName('earthAtmosphere').material.uniforms;
  e.update(0, stateAt(0));
  assert.ok(e.uniforms.uMagma.value > 0.9);
  assert.ok(e.uniforms.uHaze.value > 0.9);
  const hazeColor = atmo.uColor.value.clone();
  e.update(0, stateAt(0.77)); // ≈ 現在
  assert.ok(e.uniforms.uMagma.value < 0.01);
  assert.ok(e.uniforms.uOcean.value > 0.99);
  assert.ok(e.uniforms.uCity.value > 0.9);
  assert.ok(e.uniforms.uHaze.value < 0.01);
  assert.ok(atmo.uColor.value.b > hazeColor.b, '靄が晴れると大気は青へ');
  e.update(0, stateAt(1));
  assert.ok(e.uniforms.uScorch.value > 0.9);
  assert.ok(e.uniforms.uSunIntensity.value > 3);
  assert.ok(atmo.uThick.value < 0.6, '焦土期は縁が薄い');
});

test('update は state が無くても・dt や値が NaN でも落ちず、NaN を流さない', () => {
  const e = makeEarth();
  assert.doesNotThrow(() => e.update(1 / 60));
  assert.doesNotThrow(() => e.update(1 / 60, {}));
  assert.doesNotThrow(() => e.update(NaN, stateAt(0.5)));
  const bad = stateAt(0.5);
  bad.params = { ...bad.params, magma: NaN, ocean: 7, land: -3, sunColor: undefined, sunIntensity: NaN };
  assert.doesNotThrow(() => e.update(1 / 60, bad));
  assertFiniteUniforms(e.uniforms, 'after bad params');
  assert.equal(e.uniforms.uOcean.value, 1);
  assert.equal(e.uniforms.uLand.value, 0);
  assert.ok(e.uniforms.uTime.value > 0 && Number.isFinite(e.uniforms.uTime.value));
});

test('setImpact: 塵と熱がユニフォームと大気殻に効き、ゼロで戻る', () => {
  const e = makeEarth();
  const atmo = e.group.getObjectByName('earthAtmosphere').material.uniforms;
  const st = stateAt(0.77);
  e.update(0, st);
  const s0 = atmo.uStrength.value;
  const th0 = atmo.uThick.value;
  const dir = new THREE.Vector3(1, 1, 0).normalize();
  e.setImpact({ dirLocal: dir, flash: 1, ring: 0.3, ringA: 0.8, dust: 1, heat: 1 });
  e.update(0, st);
  assert.ok(e.uniforms.uImpactDir.value.distanceTo(dir) < 1e-9);
  assert.equal(e.uniforms.uFlash.value, 1);
  assert.equal(e.uniforms.uDust.value, 1);
  assert.equal(e.uniforms.uHeat.value, 1);
  assert.ok(atmo.uStrength.value < s0, '塵で縁が弱まる');
  assert.ok(atmo.uThick.value > th0, '塵で縁が少し厚い');
  // dirLocal を省略しても方向は保持
  e.setImpact({ flash: 0, ring: 0, ringA: 0, dust: 0, heat: 0 });
  assert.ok(e.uniforms.uImpactDir.value.distanceTo(dir) < 1e-9);
  assert.equal(e.uniforms.uDust.value, 0);
  e.update(0, st);
  assert.ok(Math.abs(atmo.uStrength.value - s0) < 1e-9);
  assert.doesNotThrow(() => e.setImpact());
  assert.doesNotThrow(() => e.setImpact({ dirLocal: new THREE.Vector3(0, 0, 0), dust: NaN }));
  assertFiniteUniforms(e.uniforms, 'after zero dir');
});

test('visibleImpactDir はカメラ側の単位ベクトルで、太陽側へ寄る', () => {
  const e = makeEarth();
  e.group.position.set(-120, 140, -600);
  const cam = new THREE.Vector3(0.2, 1.1, 1.32);
  const toCam = cam.clone().sub(e.group.position).normalize();
  let sunward = 0;
  for (let i = 0; i < 300; i++) {
    const d = e.visibleImpactDir(cam);
    assert.ok([d.x, d.y, d.z].every(Number.isFinite));
    assert.ok(Math.abs(d.length() - 1) < 1e-6);
    assert.ok(d.dot(toCam) > 0, 'カメラから見える側');
    sunward += d.dot(SUN_DIR);
  }
  // カメラ正面より太陽側へ寄っている（太陽が地球の裏にある構図でも「より昼側」）
  assert.ok(sunward / 300 > toCam.dot(SUN_DIR) + 0.1, `mean sunward ${sunward / 300} vs ${toCam.dot(SUN_DIR)}`);
});

test('worldToLocalDir / localToWorldDir は互いに逆で、自転軸の傾きと自転を含む', () => {
  const e = makeEarth();
  e.group.position.set(-120, 140, -600);
  const w = new THREE.Vector3(0.3, -0.5, 0.8).normalize();
  const l = e.worldToLocalDir(w);
  const back = e.localToWorldDir(l);
  assert.ok(back.distanceTo(w) < 1e-6);
  assert.ok(Math.abs(l.length() - 1) < 1e-6);
  // 軸の傾き（group.rotation.z）が入る：ワールドの +y はローカルでは傾いている
  const up = e.worldToLocalDir(new THREE.Vector3(0, 1, 0));
  assert.ok(Math.abs(up.y - Math.cos(THREE.MathUtils.degToRad(23.4))) < 1e-6);
  // 自転するとローカル方向が動く（衝突点が地表に貼り付いて回る）
  e.update(10, stateAt(0.5));
  const l2 = e.worldToLocalDir(w);
  assert.ok(l2.distanceTo(l) > 0.05, '自転が反映される');
  // out 引数に書く（毎フレームの new を避ける）
  const out = new THREE.Vector3();
  assert.equal(e.localToWorldDir(l2, out), out);
  assert.ok(out.distanceTo(w) < 1e-6);
});

test('太陽方向は表面・大気殻・visibleImpactDir で 1 本を共有する', () => {
  const e = makeEarth();
  const atmo = e.group.getObjectByName('earthAtmosphere').material.uniforms;
  assert.equal(atmo.uSunDir.value, e.uniforms.uSunDir.value);
  e.uniforms.uSunDir.value.set(1, 0, 0);
  e.group.position.set(0, 0, -600);
  const cam = new THREE.Vector3(0, 0, 0);
  let mx = 0;
  for (let i = 0; i < 400; i++) mx += e.visibleImpactDir(cam).x;
  assert.ok(mx / 400 > 0.15, `衝突方向が新しい太陽側 +x へ寄る (mean x = ${mx / 400})`);
});
