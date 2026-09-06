// 年代 ⇄ 正規化時間の写像、時代ごとの外観パラメータ、イベント一覧。
// 純粋関数のみ。three.js にも DOM にも依存しない（node --test で検証する）。

export const NOW = 2026;
export const YEAR_MIN = -4.6e9;
export const YEAR_MAX = NOW + 5e9;

/**
 * 正規化時間 t∈[0,1] と年の折れ線対応。
 * 各時代が画面上でほぼ均等に流れるよう、近い過去ほど密に切ってある。
 */
export const TIME_KEYS = [
  { t: 0.0, year: YEAR_MIN },
  { t: 0.11, year: -4.0e9 },
  { t: 0.26, year: -2.5e9 },
  { t: 0.42, year: -5.41e8 },
  { t: 0.54, year: -6.6e7 },
  { t: 0.62, year: -2.6e6 },
  { t: 0.67, year: -1.0e4 },
  { t: 0.7, year: 0 },
  { t: 0.73, year: 1900 },
  { t: 0.77, year: NOW },
  { t: 0.81, year: 2200 },
  { t: 0.85, year: NOW + 1e4 },
  { t: 0.89, year: NOW + 1e6 },
  { t: 0.93, year: NOW + 2.5e8 },
  { t: 0.96, year: NOW + 1e9 },
  { t: 1.0, year: YEAR_MAX },
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function yearFromT(t) {
  const x = clamp01(t);
  for (let i = 1; i < TIME_KEYS.length; i++) {
    const a = TIME_KEYS[i - 1];
    const b = TIME_KEYS[i];
    if (x <= b.t) {
      const f = (x - a.t) / (b.t - a.t);
      return a.year + (b.year - a.year) * f;
    }
  }
  return YEAR_MAX;
}

export function tFromYear(year) {
  const y = Math.min(YEAR_MAX, Math.max(YEAR_MIN, year));
  for (let i = 1; i < TIME_KEYS.length; i++) {
    const a = TIME_KEYS[i - 1];
    const b = TIME_KEYS[i];
    if (y <= b.year) {
      const f = (y - a.year) / (b.year - a.year);
      return a.t + (b.t - a.t) * f;
    }
  }
  return 1;
}

/** 整数 n ≥ 0 を「5億4100万」のような日本語表記にする */
export function jpNumber(n) {
  const v = Math.round(Math.abs(n));
  const oku = Math.floor(v / 1e8);
  const man = Math.floor((v % 1e8) / 1e4);
  const rest = v % 1e4;
  let s = '';
  if (oku) s += `${oku}億`;
  if (man) s += `${man}万`;
  if (rest || !s) s += `${rest}`;
  return s;
}

const roundTo = (v, unit) => Math.round(v / unit) * unit;

/**
 * 年 → 表示文字列。
 *  -4.6e9 → "46億年前" / -5.41e8 → "5億4100万年前" / -6.6e7 → "6600万年前"
 *  -8000 → "紀元前 8000年" / 1969 → "西暦 1969年" / NOW+1e9 → "10億年後"
 */
export function formatYear(year) {
  if (year < 0) {
    const ago = -year;
    if (ago >= 1e8) return `${jpNumber(roundTo(ago, 1e6))}年前`;
    if (ago >= 1e4) return `${jpNumber(roundTo(ago, 1e4))}年前`;
    return `紀元前 ${roundTo(ago, 10)}年`;
  }
  if (year < 3000) return `西暦 ${Math.floor(year)}年`;
  const ahead = year - NOW;
  if (ahead >= 1e8) return `${jpNumber(roundTo(ahead, 1e6))}年後`;
  if (ahead >= 1e4) return `${jpNumber(roundTo(ahead, 1e4))}年後`;
  return `${roundTo(ahead, 100)}年後`;
}

// ---------------------------------------------------------------------------
// 外観パラメータ（年代キーフレーム → smoothstep 補間）

const F = (y) => NOW + y; // 未来の年（現在から y 年後）

const KEYS = {
  // 溶けた地表の割合
  magma: [
    [-4.6e9, 1],
    [-4.45e9, 0.85],
    [-4.2e9, 0.35],
    [-4.0e9, 0.08],
    [-3.8e9, 0],
  ],
  // 海の存在（未来は太陽の明るさで蒸発）
  ocean: [
    [-4.6e9, 0],
    [-4.45e9, 0.05],
    [-4.3e9, 0.5],
    [-4.0e9, 1],
    [F(8e8), 1],
    [F(1.1e9), 0.5],
    [F(1.5e9), 0.05],
    [F(2e9), 0],
  ],
  // 大陸の面積比
  land: [
    [-4.4e9, 0],
    [-4.0e9, 0.06],
    [-3.0e9, 0.14],
    [-2.5e9, 0.24],
    [-1.8e9, 0.28],
    [0, 0.29],
    [F(1.5e9), 0.29],
  ],
  // 超大陸への片寄り（コロンビア／ロディニア／パンゲア／未来の超大陸）
  supercontinent: [
    [-2.0e9, 0],
    [-1.8e9, 1],
    [-1.5e9, 0],
    [-1.2e9, 0],
    [-1.0e9, 1],
    [-7.5e8, 0.3],
    [-6.0e8, 0],
    [-4.0e8, 0.3],
    [-3.0e8, 1],
    [-1.8e8, 0.6],
    [-6.0e7, 0.1],
    [0, 0],
    [F(1.5e8), 0.4],
    [F(2.5e8), 1],
    [F(5e8), 0.5],
    [F(1e9), 0.3],
  ],
  // 陸の緑
  vegetation: [
    [-5.0e8, 0],
    [-4.7e8, 0.15],
    [-4.2e8, 0.5],
    [-3.6e8, 0.9],
    [-3.0e8, 1],
    [0, 1],
    [F(6e8), 0.9],
    [F(1e9), 0.3],
    [F(1.3e9), 0],
  ],
  // 初期大気のオレンジの靄（大酸化事変で青へ）
  haze: [
    [-4.6e9, 1],
    [-2.5e9, 1],
    [-2.3e9, 0.5],
    [-2.0e9, 0.15],
    [-6e8, 0],
  ],
  // 極冠の広さ
  ice: [
    [-2.5e9, 0],
    [-2.4e9, 0.3],
    [-2.2e9, 0.1],
    [-8e8, 0.15],
    [-4.6e8, 0.5],
    [-4.3e8, 0.15],
    [-3.2e8, 0.6],
    [-2.6e8, 0.1],
    [-6e7, 0.05],
    [-3.4e7, 0.3],
    [-2.6e6, 0.5],
    [-2.0e4, 1],
    [-1.0e4, 0.6],
    [1900, 0.5],
    [NOW, 0.42],
    [2200, 0.25],
    [F(5e6), 0.3],
    [F(5e8), 0.15],
    [F(8e8), 0],
  ],
  // 全球凍結（ヒューロニアン／スターティアン／マリノアン）
  snowball: [
    [-2.45e9, 0],
    [-2.4e9, 1],
    [-2.3e9, 1],
    [-2.2e9, 0],
    [-7.3e8, 0],
    [-7.15e8, 1],
    [-6.6e8, 1],
    [-6.5e8, 0.2],
    [-6.4e8, 1],
    [-6.3e8, 0],
  ],
  clouds: [
    [-4.6e9, 0.1],
    [-4.4e9, 0.5],
    [-4.0e9, 0.6],
    [-2.5e9, 0.55],
    [0, 0.55],
    [F(8e8), 0.7],
    [F(1.2e9), 0.3],
    [F(1.6e9), 0],
  ],
  // 夜側の都市の光
  city: [
    [1800, 0],
    [1900, 0.1],
    [1950, 0.35],
    [NOW, 1],
    [2200, 1],
    [F(1e4), 1],
    [F(1e6), 0.6],
    [F(1e8), 0],
  ],
  // 焦土化（海が消えたあと）
  scorch: [
    [F(5e8), 0],
    [F(1.0e9), 0.4],
    [F(1.5e9), 0.85],
    [F(2e9), 1],
  ],
  sunIntensity: [
    [-4.6e9, 0.75],
    [0, 1],
    [F(1e9), 1.1],
    [F(3.5e9), 1.4],
    [F(4.5e9), 2.2],
    [YEAR_MAX, 3.5],
  ],
  // 0=いまの太陽、1=赤色巨星
  sunRed: [
    [F(3.5e9), 0],
    [F(4.5e9), 0.5],
    [YEAR_MAX, 1],
  ],
};

function interp(keys, year) {
  if (year <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (year >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const [y1, v1] = keys[i];
    if (year <= y1) {
      const [y0, v0] = keys[i - 1];
      const f = (year - y0) / (y1 - y0);
      const s = f * f * (3 - 2 * f);
      return v0 + (v1 - v0) * s;
    }
  }
  return last[1];
}

/** 年 → 地球・照明の外観パラメータ */
export function epochParams(year) {
  const p = {};
  for (const k of Object.keys(KEYS)) p[k] = interp(KEYS[k], year);
  // 大陸移動の位相（単調増加。時代が速く流れる区間ほど速く動いて見える）
  p.drift = ((year - YEAR_MIN) / 1e9) * 0.9;
  const r = p.sunRed;
  p.sunColor = [1, 0.97 - 0.52 * r, 0.92 - 0.68 * r];
  return p;
}

// ---------------------------------------------------------------------------
// イベント（年で昇順）。impact 系は hold 秒だけ時間を止めて演出する。

export const EVENTS = [
  { year: YEAR_MIN, kind: 'caption', title: '地球の誕生', body: '灼熱のマグマの海。空はまだ黒い。' },
  { year: -4.5e9, kind: 'giantImpact', hold: 16, title: 'ジャイアント・インパクト', body: '火星ほどの天体テイアが衝突する。飛び散った破片から、この月が生まれた。' },
  { year: -4.3e9, kind: 'caption', title: '海の誕生', body: '冷えた地表に雨が降り続き、最初の海ができる。' },
  { year: -3.8e9, kind: 'caption', title: '最初の生命', body: '海の底で、ごく小さな生命が息をはじめる。' },
  { year: -2.4e9, kind: 'caption', title: '大酸化事変', body: '光合成が空気を変え、やがて空は青くなる。' },
  { year: -7.15e8, kind: 'caption', title: 'スノーボールアース', body: '赤道まで氷に覆われ、地球は白く沈黙する。' },
  { year: -5.41e8, kind: 'caption', title: 'カンブリア爆発', body: '海に、姿かたちの違う生き物があふれ出す。' },
  { year: -4.7e8, kind: 'caption', title: '植物が陸へ', body: '大地がはじめて緑に染まる。' },
  { year: -3.0e8, kind: 'caption', title: '超大陸パンゲア', body: 'すべての大陸がひとつに集まる。' },
  { year: -6.6e7, kind: 'impact', hold: 13, title: '隕石衝突', body: '直径10kmの小惑星がユカタン半島に落ちる。恐竜の時代が終わる。' },
  { year: -2.0e4, kind: 'caption', title: '最終氷期', body: '氷河が大陸を覆い、人は洞窟で火を焚く。' },
  { year: 1969, kind: 'caption', title: '人類、月に立つ', body: '静かの海に最初の足跡。ここから地球を見た、最初の人たち。' },
  { year: NOW, kind: 'caption', title: '現在', body: '夜側に都市の光が瞬く。いま、ここ。' },
  { year: 2200, kind: 'caption', title: '光の惑星', body: '都市の光が海岸線をなぞり、夜が少しだけ明るくなる。' },
  { year: F(2.5e8), kind: 'caption', title: '新しい超大陸', body: '大陸はふたたび集まり、見知らぬ形の世界になる。' },
  { year: F(1e9), kind: 'caption', title: '海が消える', body: '明るくなった太陽が海を蒸発させる。青い惑星は乾いていく。' },
  { year: YEAR_MAX, kind: 'caption', title: '太陽の最期', body: '赤色巨星となった太陽が空を満たす。それでも月は、地球のそばにいる。' },
];
