// 地球の GLSL。時代パラメータ（uMagma … uScorch）で外観が連続的に変わる。
// 大陸はドメインワープした fbm の閾値。衝突は uImpactDir 周辺の閃光・環・塵。
//
// v2（円窓の黄昏）: 地平線から見上げる巨大な地球（視直径 23°）に耐えるよう
//  - 海岸線 8 オクターブ（fwidth でアンチエイリアス）、大陸棚の浅瀬・砂浜・尾根状の山脈と雪
//  - 画面微分（dFdx/dFdy）による安価な起伏の陰影（ハイライトは太陽側の斜面）
//  - 海のスペキュラ（Fresnel・きらめき）と空の映り込み
//  - 雲の影（太陽方向にずらした雲密度を地表に落とす。明暗境界ほど長い）
//  - 夜側は淡い青灰のフィル（uFill）、都市の光は点＋周囲への滲み（雲越しにも透ける）
//  - 明暗境界の暖色（低い太陽の赤み＋薄桃の散乱帯）
//  - 大気散乱風の縁：厚み（指数）と色を uHaze / uScorch / uDust で変え、太陽側はサーモン
// WebGL2（GLSL ES 3.00）前提。three が #version 300 es を付与し、dFdx / fwidth はコア機能。

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
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vSunLocal;
void main() {
  vObjPos = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // ワールドの太陽方向 → surface ローカル。modelMatrix は回転だけなので転置が逆行列（雲の影の向き）
  vSunLocal = normalize(uSunDir * mat3(modelMatrix));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const EARTH_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uFill;
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
varying vec3 vSunLocal;

${NOISE_GLSL}

// 海岸線用の 8 オクターブ fbm。coarse には 5 オクターブ分（起伏の陰影用に細部を弱めたもの）を返す
float fbmCoast(vec3 p, out float coarse) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  coarse = 0.0;
  for (int i = 0; i < 8; i++) {
    s += a * snoise(p);
    n += a;
    if (i == 4) coarse = s / n;
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    a *= 0.5;
  }
  return s / n;
}

// 雲の密度。本体と影で同じ関数を使う（東西に伸びる帯状の構造＋細かい縁）
float cloudDensity(vec3 p, vec3 warp, out float cn) {
  vec3 cp = vec3(p.x, p.y * 1.7, p.z) * 2.6 + vec3(uTime * 0.008, 0.0, uTime * 0.004) + warp * 0.15;
  cn = fbm(cp) * 0.5 + 0.5;
  float fine = fbm(p * 8.0 + vec3(uTime * 0.01));
  return uClouds * smoothstep(0.58 - 0.18 * uClouds, 0.8, cn + 0.12 * fine);
}

void main() {
  vec3 p = normalize(vObjPos);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 sL = normalize(vSunLocal);
  float d = uDrift;
  float ndv = max(dot(N, V), 0.0);
  float ndl = dot(N, uSunDir);
  float dust = uDust;
  float atmoAmt = 1.0 - uScorch * 0.8; // 大気の残り具合（焦土期は薄い）

  // ---- 大陸（ドメインワープ + 超大陸への片寄り）
  vec3 q = p * 1.3;
  vec3 warp = vec3(
    snoise(q + vec3(d * 0.31, 0.0, 0.0)),
    snoise(q + vec3(0.0, d * 0.23, 5.0)),
    snoise(q + vec3(3.0, 0.0, d * 0.17)));
  vec3 pw = p + 0.45 * warp;
  float hCoarse;
  float h = fbmCoast(pw * 1.7 + vec3(d * 0.05, 0.0, -d * 0.03), hCoarse);
  vec3 sdir = normalize(vec3(cos(d * 0.4), 0.2, sin(d * 0.4)));
  float sup = uSuper * 0.28 * dot(p, sdir);
  h += sup;
  hCoarse += sup;
  float thr = 0.62 - uLand * 1.9;
  float aa = max(0.02, fwidth(h) * 0.7); // 海岸線のアンチエイリアス幅
  float landMask = smoothstep(thr - aa, thr + aa, h);
  float elev = clamp((h - thr) / 0.45, 0.0, 1.0);
  float depth = thr - h;
  float water = (1.0 - landMask) * smoothstep(-0.02, 0.02, depth - (1.0 - uOcean) * 0.9);

  // 山脈（尾根状ノイズ）と、画面微分による起伏の陰影
  float ridgeN = 1.0 - abs(snoise(pw * 6.0 + vec3(3.1, 0.0, 7.7)));
  float mtn = ridgeN * ridgeN * smoothstep(0.2, 0.75, elev);
  float elev2 = clamp(elev + 0.3 * mtn, 0.0, 1.0);
  float hr = hCoarse + 0.5 * (h - hCoarse) + 0.10 * mtn * landMask;
  vec2 gh = vec2(dFdx(hr), dFdy(hr));
  float pxs = max(length(fwidth(p)), 1e-6); // 1 ピクセルのオブジェクト空間での大きさ（解像度に依存しない勾配へ）
  vec3 sv = mat3(viewMatrix) * uSunDir;    // 太陽の画面上の向き
  // 起伏の陰影は昼側だけ（夜側のフィルは拡散光なので平坦のまま）
  float relief = clamp(-dot(gh, sv.xy) / pxs * 0.05, -0.4, 0.4) * smoothstep(-0.1, 0.15, ndl);

  float detail = fbm(p * 9.0 + warp * 0.3);
  float lat = abs(p.y);

  // ---- 陸の色
  vec3 rock = mix(vec3(0.34, 0.29, 0.24), vec3(0.22, 0.2, 0.19), smoothstep(-0.2, 0.3, detail));
  rock = mix(rock, vec3(0.16, 0.13, 0.12), uMagma * 0.6);
  float moisture = smoothstep(-0.25, 0.3, fbm(p * 2.6 + vec3(11.0) + warp * 0.2));
  float vegAmt = uVeg * smoothstep(0.92, 0.35, lat) * (1.0 - elev2 * 0.55) * (0.35 + 0.65 * moisture);
  vec3 desert = vec3(0.66, 0.55, 0.36);
  vec3 grass = vec3(0.16, 0.34, 0.12);
  vec3 forest = vec3(0.05, 0.19, 0.06);
  vec3 vegCol = mix(grass, forest, smoothstep(0.3, 0.9, moisture));
  vec3 land = mix(rock, desert, uVeg * 0.6 * (1.0 - moisture) * smoothstep(0.9, 0.3, lat));
  land = mix(land, vegCol, vegAmt);
  land *= 1.0 - elev2 * 0.35;
  // 高山の雪
  float snow = smoothstep(0.72, 0.95, elev2 + 0.2 * lat + 0.05 * detail) * (1.0 - uMagma) * (1.0 - uScorch);
  land = mix(land, vec3(0.9, 0.92, 0.95), snow * 0.85);
  // 海岸の砂（海がある時代だけ）
  vec3 sand = vec3(0.70, 0.62, 0.46);
  land = mix(land, sand, (1.0 - smoothstep(0.0, 0.08, elev)) * uOcean * (1.0 - uMagma) * 0.7);
  vec3 scorchCol = mix(vec3(0.42, 0.30, 0.2), vec3(0.28, 0.2, 0.15), smoothstep(-0.2, 0.3, detail));
  land = mix(land, scorchCol, uScorch);
  land *= 1.0 + relief;

  // ---- 海（大陸棚の浅瀬・空の映り込み）と干上がった海底
  vec3 deepSea = vec3(0.015, 0.06, 0.17);
  vec3 shallow = vec3(0.04, 0.24, 0.36);
  vec3 shelfCol = vec3(0.08, 0.40, 0.46);
  vec3 sea = mix(shallow, deepSea, smoothstep(0.0, 0.25, depth));
  sea = mix(sea, shelfCol, (1.0 - smoothstep(0.0, 0.10, depth)) * 0.85);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  sea += vec3(0.30, 0.42, 0.58) * fres * 0.35;
  sea = mix(sea, vec3(0.16, 0.2, 0.12), uHaze * 0.55);
  vec3 basin = mix(vec3(0.6, 0.55, 0.45), vec3(0.45, 0.38, 0.3), smoothstep(-0.2, 0.3, detail));
  basin = mix(basin, scorchCol * 1.1, uScorch);
  basin *= 1.0 + relief * 0.6;

  vec3 surf = mix(mix(basin, sea, water), land, landMask);

  // ---- 海のスペキュラ（細い鋭い芯＋広い裾、縁ほど強い Fresnel、波のきらめき）
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float sparkle = 0.8 + 0.2 * snoise(p * 80.0 + vec3(uTime * 0.2));
  float spec = (pow(ndh, 220.0) * 1.1 + pow(ndh, 36.0) * 0.10) * water * (0.35 + 0.65 * fres)
    * smoothstep(-0.02, 0.15, ndl) * sparkle * 1.4;

  // ---- 氷（極冠と全球凍結）
  float iceLine = mix(1.06, 0.55, uIce);
  float iceMask = smoothstep(iceLine - 0.1, iceLine + 0.06, lat + 0.07 * detail + 0.05 * elev2 * landMask);
  iceMask = max(iceMask, uSnowball * smoothstep(0.0, 0.5, 0.6 + 0.5 * detail));
  iceMask *= (1.0 - uMagma) * (1.0 - uScorch);
  vec3 iceCol = mix(vec3(0.85, 0.9, 0.97), vec3(0.72, 0.8, 0.9), water);
  iceCol *= 1.0 + relief * 0.5;
  surf = mix(surf, iceCol, iceMask);
  spec *= 1.0 - iceMask;

  // ---- マグマ（uniform 分岐：溶けていない時代はノイズを評価しない）
  float heat = max(uMagma, uHeat);
  float magmaCover = 0.0;
  vec3 emissive = vec3(0.0);
  if (heat > 0.001) {
    float ridged = max(0.0, 1.0 - abs(snoise(p * 7.0 + vec3(0.0, uTime * 0.015, 0.0)))); // snoise は ±1 をわずかに超えるので pow の底を負にしない
    float cracks = pow(ridged, 5.0) * (0.7 + 0.3 * snoise(p * 20.0 + uTime * 0.1));
    float crust = smoothstep(0.1, 0.6, fbm(p * 4.0 + vec3(2.0)));
    vec3 crustCol = vec3(0.07, 0.045, 0.035);
    vec3 magmaGlow = vec3(1.0, 0.32, 0.04) * (cracks * 2.5 + (1.0 - crust) * 0.8);
    magmaCover = heat * smoothstep(0.15, 0.7, heat + 0.4 * snoise(p * 3.0 + vec3(9.0)));
    surf = mix(surf, crustCol, magmaCover);
    emissive = magmaGlow * magmaCover * (0.6 + 0.4 * heat);
  }

  // ---- 雲・雲の影・塵のベール
  float cloudMask = 0.0;
  float cn = 0.5;
  if (uClouds > 0.001 || dust > 0.001) {
    cloudMask = cloudDensity(p, warp, cn) * (1.0 - magmaCover * 0.7);
    // 影：太陽方向に少しずらした位置の雲を地表に落とす。太陽が低い（明暗境界）ほど長く伸びる
    float shOff = 0.022 / clamp(ndl, 0.25, 1.0);
    float cnS;
    float cloudShadow = cloudDensity(normalize(p + sL * shOff), warp, cnS) * (1.0 - magmaCover * 0.7);
    cloudShadow = smoothstep(0.05, 0.6, cloudShadow) * smoothstep(-0.05, 0.2, ndl);
    surf *= 1.0 - 0.5 * cloudShadow;
  }
  vec3 cloudCol = vec3(0.95, 0.95, 0.97);
  cloudMask = max(cloudMask, dust * (0.7 + 0.3 * cn));
  cloudCol = mix(cloudCol, vec3(0.42, 0.37, 0.32), dust);
  surf = mix(surf, cloudCol, cloudMask);
  emissive *= 1.0 - cloudMask * 0.8;
  spec *= 1.0 - cloudMask;

  // ---- 照明（細い三日月＋明暗境界の暖色）
  float diffuse = smoothstep(-0.05, 0.35, ndl);
  vec3 sun = uSunColor * uSunIntensity;
  // 低い太陽の光は大気を長く通って赤くなる（大気が無ければ白いまま）
  vec3 sunTint = mix(vec3(1.0, 0.58, 0.38), vec3(1.0), smoothstep(-0.02, 0.45, ndl));
  sunTint = mix(vec3(1.0), sunTint, atmoAmt);
  vec3 specTint = mix(vec3(1.0, 0.7, 0.5), vec3(1.0), smoothstep(0.0, 0.3, ndl));
  vec3 color = surf * diffuse * sun * sunTint + spec * sun * specTint;
  // 境界に沿う薄桃の散乱帯
  float tx = (ndl - 0.02) / 0.12;
  float term = exp(-tx * tx);
  vec3 termCol = mix(vec3(1.0, 0.45, 0.25), vec3(1.0, 0.6, 0.3), uHaze);
  color += (0.4 * surf + 0.06) * termCol * term * 0.35 * uSunIntensity * atmoAmt;

  // 夜側：淡い青灰のフィル（陸 ≈(.24,.28,.33)・海 ≈(.11,.17,.28)・雲は淡い筋）。塵で沈む
  vec3 fill = uFill * mix(1.0, 0.55, dust);
  color += mix(fill * 0.6, surf * fill * 2.2, 0.5) * (1.0 - diffuse);

  // 夜側の都市の光：点（低地・海岸に集まる）＋周囲への滲み。雲越しにも淡く透ける
  float night = 1.0 - smoothstep(-0.2, 0.1, ndl);
  if (uCity > 0.001) {
    float cityBase = fbm(p * 30.0 + warp) * 0.5 + 0.5;
    float cityN = smoothstep(0.55, 0.95, cityBase);
    float cityGlow = smoothstep(0.40, 0.85, cityBase);
    float coast = smoothstep(0.45, 0.02, elev);
    float cityAmt = uCity * landMask * (1.0 - iceMask) * coast;
    float cityLight = cityAmt * ((cityN * 1.5 + cityGlow * 0.3) * (1.0 - cloudMask * 0.6) + cityGlow * 0.25 * cloudMask);
    color += vec3(1.0, 0.74, 0.45) * cityLight * night;
  }

  color += emissive;
  color += surf * 0.012;

  // ---- 大気散乱風の縁：厚み（指数）と色を時代で変える。太陽側の縁はサーモン
  float rimPow = mix(3.0, 2.2, uHaze);
  rimPow = mix(rimPow, 4.5, uScorch * 0.8);
  float rim = pow(1.0 - ndv, rimPow);
  vec3 atmo = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.5, 0.18), uHaze);
  atmo = mix(atmo, vec3(0.9, 0.7, 0.45), uScorch * 0.7);
  atmo = mix(atmo, vec3(0.6, 0.5, 0.4), dust * 0.6);
  atmo = mix(atmo, vec3(1.0, 0.62, 0.55), 0.6 * pow(max(ndl, 0.0), 2.0));
  float rimStr = 0.8 * mix(1.0, 0.45, uScorch) * mix(1.0, 1.2, uHaze);
  color += atmo * rim * (0.25 + 0.75 * diffuse) * rimStr;
  // 太陽側の縁に沿う細い輝線（前方散乱）
  color += vec3(1.0, 0.72, 0.58) * pow(1.0 - ndv, 8.0) * smoothstep(0.0, 0.4, ndl) * 0.5 * atmoAmt;
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
uniform float uThick;
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float f = dot(N, V);
  // 殻（半径 1.06R）の裏面：外周 f=0 から、地球に隠れる内縁 f≈-0.33 へ。
  // uThick>1 で外へ広く滲み、<1 で地球に張り付く細い縁になる
  float limb = pow(smoothstep(0.0, -0.33, f), 1.0 / max(uThick, 0.25));
  float lit = smoothstep(-0.35, 0.45, dot(N, uSunDir));
  float a = limb * (0.12 + 0.88 * lit) * uStrength;
  vec3 col = mix(uColor, vec3(1.0, 0.62, 0.5), 0.6 * lit * lit);
  gl_FragColor = vec4(col * a, 1.0);
}
`;
