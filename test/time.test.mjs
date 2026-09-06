import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_KEYS,
  EVENTS,
  NOW,
  YEAR_MIN,
  YEAR_MAX,
  yearFromT,
  tFromYear,
  formatYear,
  epochParams,
} from '../src/time/epochs.js';
import { createTimeline } from '../src/time/timeline.js';

test('TIME_KEYS は t・year ともに単調増加で [0,1] を覆う', () => {
  assert.equal(TIME_KEYS[0].t, 0);
  assert.equal(TIME_KEYS[TIME_KEYS.length - 1].t, 1);
  assert.equal(TIME_KEYS[0].year, YEAR_MIN);
  assert.equal(TIME_KEYS[TIME_KEYS.length - 1].year, YEAR_MAX);
  for (let i = 1; i < TIME_KEYS.length; i++) {
    assert.ok(TIME_KEYS[i].t > TIME_KEYS[i - 1].t, `t[${i}]`);
    assert.ok(TIME_KEYS[i].year > TIME_KEYS[i - 1].year, `year[${i}]`);
  }
});

test('yearFromT と tFromYear は互いに逆関数', () => {
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const back = tFromYear(yearFromT(t));
    assert.ok(Math.abs(back - t) < 1e-9, `t=${t} → ${back}`);
  }
  let prev = -Infinity;
  for (let i = 0; i <= 1000; i++) {
    const y = yearFromT(i / 1000);
    assert.ok(y >= prev, 'yearFromT は単調');
    prev = y;
  }
});

test('formatYear の表記', () => {
  assert.equal(formatYear(-4.6e9), '46億年前');
  assert.equal(formatYear(-5.41e8), '5億4100万年前');
  assert.equal(formatYear(-6.6e7), '6600万年前');
  assert.equal(formatYear(-2.6e6), '260万年前');
  assert.equal(formatYear(-8000), '紀元前 8000年');
  assert.equal(formatYear(1969), '西暦 1969年');
  assert.equal(formatYear(NOW), '西暦 2026年');
  assert.equal(formatYear(NOW + 1e9), '10億年後');
  assert.equal(formatYear(NOW + 2.5e8), '2億5000万年後');
  assert.equal(formatYear(YEAR_MAX), '50億年後');
});

test('epochParams の要所', () => {
  const p0 = epochParams(-4.6e9);
  assert.equal(p0.magma, 1);
  assert.equal(p0.ocean, 0);
  assert.ok(epochParams(NOW).city >= 0.95, '現在は都市の光');
  assert.ok(epochParams(-7.0e8).snowball >= 0.9, '7億年前は全球凍結');
  assert.ok(epochParams(NOW + 2e9).ocean <= 0.05, '20億年後は海が無い');
  assert.ok(epochParams(-3.0e8).supercontinent >= 0.9, '3億年前はパンゲア');
  assert.ok(epochParams(-4.7e8).vegetation < 0.3 && epochParams(-3.0e8).vegetation > 0.9, '緑は古生代に広がる');
  assert.ok(epochParams(-3.0e9).haze > 0.9 && epochParams(0).haze < 0.05, '靄は大酸化事変で晴れる');
});

test('epochParams は全時代で有限かつ範囲内', () => {
  const unit = ['magma', 'ocean', 'land', 'supercontinent', 'vegetation', 'haze', 'ice', 'snowball', 'clouds', 'city', 'scorch', 'sunRed'];
  for (let i = 0; i <= 500; i++) {
    const y = yearFromT(i / 500);
    const p = epochParams(y);
    for (const k of unit) {
      assert.ok(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1, `${k}@${y} = ${p[k]}`);
    }
    assert.ok(Number.isFinite(p.drift), 'drift');
    assert.ok(p.sunIntensity > 0 && p.sunIntensity < 10, 'sunIntensity');
    assert.equal(p.sunColor.length, 3);
    for (const c of p.sunColor) assert.ok(c >= 0 && c <= 1, 'sunColor');
  }
  let d = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = epochParams(yearFromT(i / 100));
    assert.ok(p.drift >= d, 'drift は単調');
    d = p.drift;
  }
});

test('EVENTS は年で昇順・必須項目あり', () => {
  for (let i = 0; i < EVENTS.length; i++) {
    const ev = EVENTS[i];
    assert.ok(typeof ev.title === 'string' && ev.title.length > 0);
    assert.ok(typeof ev.body === 'string' && ev.body.length > 0);
    assert.ok(['caption', 'impact', 'giantImpact'].includes(ev.kind));
    if (ev.kind !== 'caption') assert.ok(ev.hold > 0, 'impact は hold を持つ');
    if (i > 0) assert.ok(ev.year > EVENTS[i - 1].year, `EVENTS[${i}] の順序`);
  }
  assert.ok(EVENTS.some((e) => e.kind === 'impact'));
  assert.ok(EVENTS.some((e) => e.kind === 'giantImpact'));
});

test('timeline: 再生中にイベントを一度だけ発火し、hold 中は年が進まない', () => {
  const tl = createTimeline({ speed: 1, cycleSeconds: 100 });
  tl.play();
  const seen = new Map();
  let holdSeen = false;
  const step = 1 / 60;
  for (let i = 0; i < 200 * 60; i++) {
    const before = tl.state.year;
    const fired = tl.update(step);
    for (const ev of fired) seen.set(ev.title, (seen.get(ev.title) || 0) + 1);
    if (tl.state.holding > 0) {
      holdSeen = true;
      // hold 中の次フレームで年が動かないこと
      const y0 = tl.state.year;
      tl.update(step);
      assert.equal(tl.state.year, y0, 'hold 中は静止');
    }
    if (tl.state.ended) break;
    assert.ok(tl.state.year >= before, '年は逆行しない');
  }
  assert.ok(holdSeen, 'impact で hold した');
  for (const ev of EVENTS) {
    assert.equal(seen.get(ev.title), 1, `${ev.title} は 1 回`);
  }
  assert.ok(tl.state.ended);
});

test('timeline: seek はイベントを発火せず currentEvent が最新を返す', () => {
  const tl = createTimeline({ cycleSeconds: 100 });
  tl.play();
  tl.seekYear(-1.0e8);
  assert.equal(tl.currentEvent().title, '超大陸パンゲア');
  const fired = tl.update(1 / 60);
  assert.equal(fired.length, 0);
  tl.seekYear(2000);
  assert.equal(tl.currentEvent().title, '人類、月に立つ');
});

test('timeline: 末尾で止まり、endHold の後に冒頭へ戻る', () => {
  const tl = createTimeline({ cycleSeconds: 1, endHoldSeconds: 2 });
  tl.play();
  tl.seek(0.995);
  const fired = tl.update(0.01);
  assert.equal(fired[0].title, '太陽の最期');
  assert.ok(tl.state.ended);
  assert.equal(tl.state.t, 1);
  tl.update(1);
  assert.ok(tl.state.ended);
  tl.update(1.5);
  assert.ok(!tl.state.ended);
  assert.equal(tl.state.t, 0);
});
