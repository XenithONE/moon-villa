// タイムライン。毎フレーム state を更新し、跨いだイベントを返す。
// state はこのモジュールが唯一の出典。他モジュールは year を自前計算しない。

import { EVENTS, YEAR_MIN, epochParams, yearFromT, tFromYear } from './epochs.js';

/**
 * @param {{speed?: number, cycleSeconds?: number, endHoldSeconds?: number}} opts
 */
export function createTimeline({ speed = 1, cycleSeconds = 360, endHoldSeconds = 8 } = {}) {
  const state = {
    t: 0,
    year: YEAR_MIN,
    params: epochParams(YEAR_MIN),
    playing: false,
    speed,
    holding: 0, // 演出のため時間を止めている残り秒
    endHold: 0, // 末尾で止まっている残り秒
    ended: false,
  };

  // 最後に「通過済み」とみなしたイベントの index（-1 = まだ何も）
  let cursor = -1;

  const indexAtOrBefore = (year) => {
    let idx = -1;
    for (let i = 0; i < EVENTS.length; i++) {
      if (EVENTS[i].year <= year) idx = i;
      else break;
    }
    return idx;
  };

  const apply = (t) => {
    state.t = t;
    state.year = yearFromT(t);
    state.params = epochParams(state.year);
  };

  const api = {
    state,
    play() {
      state.playing = true;
      if (state.ended) api.seek(0);
    },
    pause() {
      state.playing = false;
    },
    toggle() {
      if (state.playing) api.pause();
      else api.play();
    },
    setSpeed(s) {
      state.speed = s;
    },
    /** 手動で位置を変える。イベントは発火しない（キャプションは currentEvent() で引く） */
    seek(t) {
      const x = Math.min(1, Math.max(0, t));
      apply(x);
      cursor = indexAtOrBefore(state.year);
      state.holding = 0;
      state.endHold = 0;
      state.ended = x >= 1;
    },
    seekYear(year) {
      api.seek(tFromYear(year));
    },
    /** 演出のため sec 秒だけ時間を止める */
    hold(sec) {
      state.holding = Math.max(state.holding, sec);
    },
    /** 現在の年以前で最後のイベント */
    currentEvent() {
      const i = indexAtOrBefore(state.year);
      return i >= 0 ? EVENTS[i] : null;
    },
    /**
     * @param {number} dt 実時間の経過秒
     * @returns {Array} このフレームで跨いだイベント
     */
    update(dt) {
      const fired = [];
      if (!state.playing) return fired;

      if (state.holding > 0) {
        state.holding = Math.max(0, state.holding - dt);
        return fired;
      }
      if (state.ended) {
        state.endHold -= dt;
        if (state.endHold <= 0) api.seek(0);
        return fired;
      }

      const prevYear = state.year;
      let t = state.t + (dt * state.speed) / cycleSeconds;
      if (t >= 1) {
        t = 1;
        state.ended = true;
        state.endHold = endHoldSeconds;
      }
      apply(t);

      // prevYear < ev.year <= year のイベントを順に発火（cursor から先だけ見る）
      for (let i = cursor + 1; i < EVENTS.length; i++) {
        const ev = EVENTS[i];
        if (ev.year > state.year) break;
        if (ev.year > prevYear || (i === 0 && cursor < 0)) {
          fired.push(ev);
          if (ev.hold) state.holding = Math.max(state.holding, ev.hold);
        }
        cursor = i;
      }
      return fired;
    },
  };

  return api;
}
