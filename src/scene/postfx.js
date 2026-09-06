import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// フィルムの粒子・ビネット・わずかな暖色。OutputPass の前（リニア空間）で掛ける。
const NostalgiaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.55 },
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
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.31) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float lum = clamp(dot(c.rgb, vec3(0.3, 0.59, 0.11)), 0.0, 1.0);
      float g = (hash(vUv * 1400.0) - 0.5) * uGrain * (0.35 + 0.65 * (1.0 - lum));
      c.rgb += g;
      c.rgb *= vec3(1.03, 0.995, 0.94);
      float d = length((vUv - 0.5) * vec2(1.0, 0.85));
      c.rgb *= 1.0 - uVignette * smoothstep(0.32, 0.86, d);
      gl_FragColor = c;
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.6, 1.0);
  composer.addPass(bloom);
  const nostalgia = new ShaderPass(NostalgiaShader);
  composer.addPass(nostalgia);
  composer.addPass(new OutputPass());

  function render(dt) {
    nostalgia.uniforms.uTime.value = (nostalgia.uniforms.uTime.value + dt) % 100;
    composer.render(dt);
  }

  function resize(w, h) {
    composer.setSize(w, h);
  }

  return { composer, bloom, nostalgia, render, resize };
}
