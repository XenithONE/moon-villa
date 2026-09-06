// 地球の GLSL。時代パラメータ（uMagma … uScorch）で外観が連続的に変わる。
// 大陸はドメインワープした fbm の閾値。衝突は uImpactDir 周辺の閃光・環・塵。

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * snoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    a *= 0.5;
  }
  return s / n;
}
`;

export const EARTH_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
void main() {
  vObjPos = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EARTH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uMagma;
uniform float uOcean;
uniform float uLand;
uniform float uSuper;
uniform float uDrift;
uniform float uVeg;
uniform float uHaze;
uniform float uIce;
uniform float uSnowball;
uniform float uClouds;
uniform float uCity;
uniform float uScorch;
uniform vec3 uImpactDir;
uniform float uFlash;
uniform float uRing;
uniform float uRingA;
uniform float uDust;
uniform float uHeat;
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;

${NOISE_GLSL}

void main() {
  vec3 p = normalize(vObjPos);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float d = uDrift;

  // ---- 大陸（ドメインワープ + 超大陸への片寄り）
  vec3 q = p * 1.3;
  vec3 warp = vec3(
    snoise(q + vec3(d * 0.31, 0.0, 0.0)),
    snoise(q + vec3(0.0, d * 0.23, 5.0)),
    snoise(q + vec3(3.0, 0.0, d * 0.17)));
  vec3 pw = p + 0.45 * warp;
  float h = fbm(pw * 1.7 + vec3(d * 0.05, 0.0, -d * 0.03));
  vec3 sdir = normalize(vec3(cos(d * 0.4), 0.2, sin(d * 0.4)));
  h += uSuper * 0.28 * dot(p, sdir);
  float thr = 0.62 - uLand * 1.9;
  float landMask = smoothstep(thr - 0.025, thr + 0.025, h);
  float elev = clamp((h - thr) / 0.45, 0.0, 1.0);
  float depth = thr - h;
  float water = (1.0 - landMask) * smoothstep(-0.02, 0.02, depth - (1.0 - uOcean) * 0.9);

  float detail = fbm(p * 9.0 + warp * 0.3);
  float lat = abs(p.y);

  // ---- 陸の色
  vec3 rock = mix(vec3(0.34, 0.29, 0.24), vec3(0.22, 0.2, 0.19), smoothstep(-0.2, 0.3, detail));
  rock = mix(rock, vec3(0.16, 0.13, 0.12), uMagma * 0.6);
  float moisture = smoothstep(-0.25, 0.3, fbm(p * 2.6 + vec3(11.0) + warp * 0.2));
  float vegAmt = uVeg * smoothstep(0.92, 0.35, lat) * (1.0 - elev * 0.55) * (0.35 + 0.65 * moisture);
  vec3 desert = vec3(0.66, 0.55, 0.36);
  vec3 grass = vec3(0.16, 0.34, 0.12);
  vec3 forest = vec3(0.05, 0.19, 0.06);
  vec3 vegCol = mix(grass, forest, smoothstep(0.3, 0.9, moisture));
  vec3 land = mix(rock, desert, uVeg * 0.6 * (1.0 - moisture) * smoothstep(0.9, 0.3, lat));
  land = mix(land, vegCol, vegAmt);
  land *= 1.0 - elev * 0.35;
  vec3 scorchCol = mix(vec3(0.42, 0.30, 0.2), vec3(0.28, 0.2, 0.15), smoothstep(-0.2, 0.3, detail));
  land = mix(land, scorchCol, uScorch);

  // ---- 海と干上がった海底
  vec3 deepSea = vec3(0.015, 0.06, 0.17);
  vec3 shallow = vec3(0.04, 0.24, 0.36);
  vec3 sea = mix(shallow, deepSea, smoothstep(0.0, 0.25, depth));
  sea = mix(sea, vec3(0.16, 0.2, 0.12), uHaze * 0.55);
  vec3 basin = mix(vec3(0.6, 0.55, 0.45), vec3(0.45, 0.38, 0.3), smoothstep(-0.2, 0.3, detail));
  basin = mix(basin, scorchCol * 1.1, uScorch);

  vec3 surf = mix(mix(basin, sea, water), land, landMask);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 90.0) * water * 0.8;

  // ---- 氷（極冠と全球凍結）
  float iceLine = mix(1.06, 0.55, uIce);
  float iceMask = smoothstep(iceLine - 0.1, iceLine + 0.06, lat + 0.07 * detail + 0.05 * elev * landMask);
  iceMask = max(iceMask, uSnowball * smoothstep(0.0, 0.5, 0.6 + 0.5 * detail));
  iceMask *= (1.0 - uMagma) * (1.0 - uScorch);
  vec3 iceCol = mix(vec3(0.85, 0.9, 0.97), vec3(0.72, 0.8, 0.9), water);
  surf = mix(surf, iceCol, iceMask);
  spec *= 1.0 - iceMask;

  // ---- マグマ
  float heat = max(uMagma, uHeat);
  float ridged = 1.0 - abs(snoise(p * 7.0 + vec3(0.0, uTime * 0.015, 0.0)));
  float cracks = pow(ridged, 5.0) * (0.7 + 0.3 * snoise(p * 20.0 + uTime * 0.1));
  float crust = smoothstep(0.1, 0.6, fbm(p * 4.0 + vec3(2.0)));
  vec3 crustCol = vec3(0.07, 0.045, 0.035);
  vec3 magmaGlow = vec3(1.0, 0.32, 0.04) * (cracks * 2.5 + (1.0 - crust) * 0.8);
  float magmaCover = heat * smoothstep(0.15, 0.7, heat + 0.4 * snoise(p * 3.0 + vec3(9.0)));
  surf = mix(surf, crustCol, magmaCover);
  vec3 emissive = magmaGlow * magmaCover * (0.6 + 0.4 * heat);

  // ---- 雲と塵のベール
  vec3 cp = p * 2.6 + vec3(uTime * 0.008, 0.0, uTime * 0.004) + warp * 0.15;
  float cn = fbm(cp) * 0.5 + 0.5;
  float cloudMask = uClouds * smoothstep(0.58 - 0.18 * uClouds, 0.8, cn + 0.12 * fbm(p * 8.0 + uTime * 0.01));
  cloudMask *= 1.0 - magmaCover * 0.7;
  vec3 cloudCol = vec3(0.95, 0.95, 0.97);
  float dust = uDust;
  cloudMask = max(cloudMask, dust * (0.7 + 0.3 * cn));
  cloudCol = mix(cloudCol, vec3(0.42, 0.37, 0.32), dust);
  surf = mix(surf, cloudCol, cloudMask);
  emissive *= 1.0 - cloudMask * 0.8;
  spec *= 1.0 - cloudMask;

  // ---- 照明
  float ndl = dot(N, uSunDir);
  float diffuse = smoothstep(-0.08, 0.3, ndl);
  vec3 sun = uSunColor * uSunIntensity;
  vec3 color = surf * diffuse * sun + spec * sun;

  // 夜側の都市の光（低地・海岸に集まる）
  float night = 1.0 - smoothstep(-0.2, 0.1, ndl);
  float cityN = smoothstep(0.55, 0.95, fbm(p * 30.0 + warp) * 0.5 + 0.5);
  float coast = smoothstep(0.45, 0.02, elev);
  float city = uCity * landMask * (1.0 - iceMask) * cityN * coast * (1.0 - cloudMask * 0.6);
  color += vec3(1.0, 0.75, 0.45) * city * night * 1.6;

  color += emissive;
  color += surf * 0.012;

  // 大気のリム
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 atmo = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.5, 0.18), uHaze);
  atmo = mix(atmo, vec3(0.9, 0.7, 0.45), uScorch * 0.7);
  atmo = mix(atmo, vec3(0.6, 0.5, 0.4), dust * 0.6);
  color += atmo * rim * (0.15 + 0.85 * diffuse) * 0.7;
  color = mix(color, color * vec3(1.05, 0.9, 0.7), uHaze * 0.5);

  // 衝突：閃光と広がる環
  float ang = acos(clamp(dot(p, uImpactDir), -1.0, 1.0));
  float flash = uFlash * exp(-ang * ang * 60.0);
  float ring = smoothstep(0.06, 0.0, abs(ang - uRing)) * uRingA;
  color += vec3(1.0, 0.85, 0.6) * flash * 6.0 + vec3(1.0, 0.5, 0.2) * ring * 1.5;

  gl_FragColor = vec4(color, 1.0);
}
`;

export const ATMO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATMO_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float f = dot(N, V);
  float limb = smoothstep(0.0, -0.32, f);
  float lit = smoothstep(-0.35, 0.45, dot(N, uSunDir));
  float a = limb * (0.12 + 0.88 * lit) * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;
