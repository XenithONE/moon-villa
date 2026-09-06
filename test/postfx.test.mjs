import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NostalgiaShader } from '../src/scene/postfx.js';

// GLSL は node ではコンパイルできないので、静的に契約を検証する:
// フラグメントで宣言した uniform と uniforms 表が過不足なく一致し、varying が両段で一致すること。

function declaredUniforms(src) {
  const out = new Map();
  for (const m of src.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)\s*;/gm)) out.set(m[2], m[1]);
  return out;
}
function declaredVaryings(src) {
  return new Set([...src.matchAll(/^\s*varying\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1]));
}

test('NostalgiaShader: フラグメントの uniform 宣言と uniforms 表が一致する', () => {
  const decl = declaredUniforms(NostalgiaShader.fragmentShader);
  const table = Object.keys(NostalgiaShader.uniforms);
  for (const name of table) assert.ok(decl.has(name), `uniform ${name} が GLSL に無い`);
  for (const name of decl.keys()) assert.ok(table.includes(name), `GLSL の uniform ${name} が表に無い`);
  // 型の対応（float ↔ number、vec3 ↔ Vector3、sampler2D ↔ null）
  for (const [name, type] of decl) {
    const v = NostalgiaShader.uniforms[name].value;
    if (type === 'float') assert.equal(typeof v, 'number', `${name} は float`);
    else if (type === 'vec3') assert.ok(v && v.isVector3, `${name} は vec3`);
    else if (type === 'sampler2D') assert.equal(v, null, `${name} は sampler2D`);
    else assert.fail(`未対応の型 ${type} (${name})`);
  }
});

test('NostalgiaShader: varying は頂点・フラグメントで一致し、使う組み込みだけを使う', () => {
  const vs = declaredVaryings(NostalgiaShader.vertexShader);
  const fs = declaredVaryings(NostalgiaShader.fragmentShader);
  assert.deepEqual([...vs].sort(), [...fs].sort());
  assert.ok(vs.has('vUv'));
  // ShaderPass の FullScreenQuad が与える属性/行列だけを使う
  assert.match(NostalgiaShader.vertexShader, /projectionMatrix \* modelViewMatrix \* vec4\(\s*position/);
  assert.ok(!/gl_FragDepth|texture\(/.test(NostalgiaShader.fragmentShader));
  // 数値リテラルは全て float（GLSL ES で int と float の暗黙変換は無い）。コメントは除いて調べる。
  const code = NostalgiaShader.fragmentShader.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const ints = code.match(/[^\w.](\d+)(?![\d.eE\w])/g) || [];
  assert.deepEqual(ints, [], `裸の整数リテラル: ${ints.map((s) => s.trim()).join(', ')}`);
});

test('NostalgiaShader: 既定値は設計値', () => {
  const u = NostalgiaShader.uniforms;
  assert.equal(u.uAberration.value, 0.0015);
  assert.equal(u.uGrain.value, 0.045);
  assert.equal(u.uVignette.value, 0.5);
  assert.equal(u.uSaturation.value, 0.95);
  assert.equal(u.uGain.value, 0.96);
  assert.deepEqual(u.uShadowTint.value.toArray(), [-0.006, 0.004, 0.012]);
  assert.deepEqual(u.uHighlightTint.value.toArray(), [0.03, 0.012, -0.006]);
});
