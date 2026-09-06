import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { qualityTier } from '../util/quality.js';

/**
 * ポスト処理（設計書 §5.2・順序固定）
 *  1. HalfFloat の RT（high は MSAA×4）→ EffectComposer
 *  2. RenderPass
 *  3. UnrealBloomPass  strength .45 / radius .8 / threshold .82（太陽ディスク・地球のリム・窓の滲み）
 *  4. Nostalgia（リニア空間）: 色収差 → スプリットトーン（影=ティール・ハイライト=桃）→ リフト → 減彩 → 粒子 → ビネット
 *  5. OutputPass（ACES トーンマップ＋sRGB。設定は renderer から取る）
 *  6. low tier のみ FXAAPass（sRGB 入力が要るので OutputPass の後）
 *
 * createPostFX(renderer, scene, camera) -> { composer, bloom, nostalgia, render(dt), resize(w, h) }
 */

export const NostalgiaShader = {
  name: 'NostalgiaShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0015 }, // 色収差（周辺ほど強い）
    uShadowTint: { value: new THREE.Vector3(-0.006, 0.004, 0.012) }, // 暗部 → ティール
    uHighlightTint: { value: new THREE.Vector3(0.03, 0.012, -0.006) }, // 明部 → 桃
    uGain: { value: 0.96 }, // リフト（黒を少し持ち上げる＝退色したフィルム）
    uLift: { value: new THREE.Vector3(0.01, 0.014, 0.02) },
    uSaturation: { value: 0.95 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uGain;
    uniform vec3 uLift;
    uniform float uSaturation;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.3, 0.59, 0.11);

    // ピクセル固定のハッシュ（粒子）。uTime で毎フレーム散らす。
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 d = vUv - 0.5;

      // 色収差: 周辺ほど R と B を外側/内側へずらす
      vec2 ca = d * length(d) * uAberration;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + ca).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - ca).b;

      // 明度（リニア・トーンマップ前なので 1 を超え得る）。重みは [0,1] に畳む。
      float lum = dot(c, LUMA);
      float w = clamp(lum, 0.0, 1.0);

      // スプリットトーン: 影をティールへ、ハイライトを桃へ
      c += (1.0 - w) * uShadowTint + w * uHighlightTint;

      // リフト
      c = c * uGain + uLift;

      // わずかに減彩
      float l2 = dot(c, LUMA);
      c = mix(vec3(l2), c, uSaturation);

      // 粒子（暗部ほど強い）
      vec2 seed = gl_FragCoord.xy + vec2(fract(uTime * 13.37), fract(uTime * 7.11)) * 1024.0;
      float g = hash12(seed) - 0.5;
      c += g * uGrain * (0.35 + 0.65 * (1.0 - w));

      // ビネット（横長に）
      float v = length(d * vec2(1.0, 0.85));
      c *= 1.0 - uVignette * smoothstep(0.35, 0.95, v);

      gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
    }
  `,
};

function tierSafe() {
  try {
    return qualityTier();
  } catch {
    return 'high';
  }
}

export function createPostFX(renderer, scene, camera) {
  const high = tierSafe() === 'high';

  // 非表示タブ起動などで 0×0 のことがある。0 サイズの RT/FXAA(1/0) を作らないよう 1 以上にする。
  // 実サイズは main.js の ensureSize → resize(w,h) で入る。
  const cssSize = renderer.getSize(new THREE.Vector2()).max(new THREE.Vector2(1, 1));
  const bufSize = renderer.getDrawingBufferSize(new THREE.Vector2()).max(new THREE.Vector2(1, 1));
  let pixelRatio = renderer.getPixelRatio();

  // 1. HalfFloat（Bloom のために HDR を保つ）。high は MSAA×4、low は後段の FXAA で補う。
  const rt = new THREE.WebGLRenderTarget(bufSize.x, bufSize.y, {
    type: THREE.HalfFloatType,
    samples: high ? 4 : 0,
  });
  rt.texture.name = 'PostFX.rt';
  const composer = new EffectComposer(renderer, rt);
  // RT を渡した場合、composer は内部サイズに RT の実ピクセル数を入れてしまう（pixelRatio が二重に掛かる）。
  // CSS ピクセルで設定し直す（RT のサイズは同じなので再確保は起きない）。
  composer.setSize(cssSize.x, cssSize.y);

  // 2. シーン
  composer.addPass(new RenderPass(scene, camera));

  // 3. ブルーム
  const bloom = new UnrealBloomPass(new THREE.Vector2(bufSize.x, bufSize.y), 0.45, 0.8, 0.82);
  composer.addPass(bloom);

  // 4. ノスタルジア（リニア空間）
  const nostalgia = new ShaderPass(NostalgiaShader);
  composer.addPass(nostalgia);

  // 5. トーンマップ＋sRGB
  composer.addPass(new OutputPass());

  // 6. low のみ FXAA（sRGB 入力が必要なので最後）
  let fxaa = null;
  if (!high) {
    fxaa = new FXAAPass();
    composer.addPass(fxaa);
  }

  function syncPixelRatio() {
    const pr = renderer.getPixelRatio();
    if (pr !== pixelRatio) {
      pixelRatio = pr;
      composer.setPixelRatio(pr);
    }
  }

  /** dt は秒。無い／非有限なら 1/60 扱い（uTime が NaN になると粒子のハッシュが全画素を NaN にする）。 */
  function render(dt) {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 1 / 60;
    syncPixelRatio();
    nostalgia.uniforms.uTime.value = (nostalgia.uniforms.uTime.value + step) % 100;
    composer.render(step);
  }

  /** w, h は CSS ピクセル（main.js の window.innerWidth/Height）。pixelRatio は composer が掛ける。 */
  function resize(w, h) {
    const cw = Math.max(1, Math.floor(Number.isFinite(w) ? w : 1));
    const ch = Math.max(1, Math.floor(Number.isFinite(h) ? h : 1));
    syncPixelRatio();
    composer.setSize(cw, ch);
  }

  return { composer, bloom, nostalgia, fxaa, tier: high ? 'high' : 'low', render, resize };
}
