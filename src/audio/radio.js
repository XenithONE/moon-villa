// ラジオ。プレイリスト再生（<audio> → WebAudio）、AM 風フィルタ、局間ノイズ、
// 内蔵局「静寂」（合成ドローン）、衝突音。AudioContext はユーザー操作後に ensureContext() で作る。

const BUILT_IN = { title: '静寂', artist: '月面放送 — Moon Static', builtin: true };

export function createRadio() {
  const tracks = [BUILT_IN];
  let index = 0;
  let playing = false;
  let volume = 0.6;
  let am = true;
  let error = null;
  const listeners = new Set();

  let ctx = null;
  let master = null;
  let dryGain = null;
  let wetGain = null;
  let noiseGain = null;
  let droneGain = null;
  let droneNoiseGain = null;
  let mediaConnected = false;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', () => api.next());
  audio.addEventListener('error', () => {
    error = `再生できません: ${tracks[index]?.title ?? ''}`;
    notify();
  });

  function notify() {
    const st = api.state;
    for (const cb of listeners) cb(st);
  }

  function makeNoiseSource() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // 音楽：dry と AM 風 wet を並列に
    const musicIn = ctx.createGain();
    dryGain = ctx.createGain();
    dryGain.gain.value = am ? 0 : 1;
    wetGain = ctx.createGain();
    wetGain.gain.value = am ? 1 : 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 260;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.8;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    const wetTrim = ctx.createGain();
    wetTrim.gain.value = 0.9;
    musicIn.connect(dryGain).connect(master);
    musicIn.connect(hp).connect(lp).connect(shaper).connect(wetTrim).connect(wetGain).connect(master);
    if (!mediaConnected) {
      const src = ctx.createMediaElementSource(audio);
      src.connect(musicIn);
      mediaConnected = true;
    }

    // 局間ノイズ
    const noise = makeNoiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.6;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(bp).connect(noiseGain).connect(master);

    // 内蔵局「静寂」：低いドローン＋かすかなノイズ
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 520;
    droneLp.connect(droneGain).connect(master);
    const voices = [
      [110, 0, 0.5],
      [164.81, 4, 0.28],
      [220, -6, 0.2],
      [329.63, 3, 0.08],
    ];
    for (const [freq, detune, amp] of voices) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = amp * 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.06;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = amp * 0.35;
      lfo.connect(lfoGain).connect(g.gain);
      osc.connect(g).connect(droneLp);
      osc.start();
      lfo.start();
    }
    droneNoiseGain = ctx.createGain();
    droneNoiseGain.gain.value = 0;
    const droneNoiseLp = ctx.createBiquadFilter();
    droneNoiseLp.type = 'lowpass';
    droneNoiseLp.frequency.value = 900;
    noise.connect(droneNoiseLp).connect(droneNoiseGain).connect(master);
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    buildGraph();
    return ctx;
  }

  function staticBurst(level = 0.28) {
    if (!ctx || !noiseGain) return;
    const t = ctx.currentTime;
    noiseGain.gain.cancelScheduledValues(t);
    noiseGain.gain.setValueAtTime(noiseGain.gain.value, t);
    noiseGain.gain.linearRampToValueAtTime(level, t + 0.05);
    noiseGain.gain.linearRampToValueAtTime(0, t + 0.75);
  }

  function setDrone(on) {
    if (!ctx || !droneGain) return;
    const t = ctx.currentTime;
    droneGain.gain.cancelScheduledValues(t);
    droneGain.gain.setValueAtTime(droneGain.gain.value, t);
    droneGain.gain.linearRampToValueAtTime(on ? 0.5 : 0, t + (on ? 2.5 : 0.6));
    droneNoiseGain.gain.cancelScheduledValues(t);
    droneNoiseGain.gain.setValueAtTime(droneNoiseGain.gain.value, t);
    droneNoiseGain.gain.linearRampToValueAtTime(on ? 0.02 : 0, t + 1.5);
  }

  function resolveSrc(src, base) {
    if (/^(https?:|blob:|data:|\/)/.test(src)) return src;
    return base + src;
  }

  const api = {
    get state() {
      return { tracks, index, playing, volume, am, error, current: tracks[index] };
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ensureContext,
    /** playlist.json を読む。base は import.meta.env.BASE_URL */
    async load(url, base = '/') {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json?.tracks) ? json.tracks : [];
        for (const t of list) {
          if (!t || typeof t.src !== 'string') continue;
          tracks.push({ title: t.title || t.src.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), artist: t.artist || '', src: resolveSrc(t.src, base) });
        }
        error = null;
      } catch (e) {
        error = null; // プレイリストが無いのは正常（曲は後で入る）
      }
      notify();
    },
    select(i, autoplay = playing) {
      if (!tracks.length) return;
      index = ((i % tracks.length) + tracks.length) % tracks.length;
      error = null;
      const track = tracks[index];
      ensureContext();
      staticBurst();
      if (track.builtin) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        playing = autoplay;
        setDrone(playing);
      } else {
        setDrone(false);
        audio.src = track.src;
        audio.load();
        playing = autoplay;
        if (playing) audio.play().catch(() => {});
      }
      notify();
    },
    play() {
      ensureContext();
      playing = true;
      const track = tracks[index];
      if (track.builtin) setDrone(true);
      else {
        if (!audio.src) {
          audio.src = track.src;
          audio.load();
        }
        audio.play().catch(() => {});
      }
      notify();
    },
    pause() {
      playing = false;
      setDrone(false);
      audio.pause();
      notify();
    },
    toggle() {
      if (playing) api.pause();
      else api.play();
    },
    next() {
      api.select(index + 1, playing);
    },
    prev() {
      api.select(index - 1, playing);
    },
    /** ローカルファイルを追加。最初に追加した曲の index を返す */
    addFiles(files) {
      let first = -1;
      for (const file of files) {
        if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i.test(file.name)) continue;
        tracks.push({ title: file.name.replace(/\.[^.]+$/, '').replaceAll('_', ' '), artist: 'ローカル', src: URL.createObjectURL(file), local: true });
        if (first < 0) first = tracks.length - 1;
      }
      notify();
      return first;
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
      notify();
    },
    setAM(on) {
      am = !!on;
      if (ctx) {
        const t = ctx.currentTime;
        dryGain.gain.setTargetAtTime(am ? 0 : 1, t, 0.08);
        wetGain.gain.setTargetAtTime(am ? 1 : 0, t, 0.08);
      }
      notify();
    },
    /** 衝突音：低い轟音と下降するうなり */
    impactSound(giant = false) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const dur = giant ? 4.5 : 2.6;
      const src = makeNoiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(giant ? 140 : 110, t);
      lp.frequency.exponentialRampToValueAtTime(40, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(giant ? 1.1 : 0.7, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(lp).connect(g).connect(master);
      src.stop(t + dur + 0.1);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(giant ? 62 : 55, t);
      osc.frequency.exponentialRampToValueAtTime(24, t + dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(giant ? 0.5 : 0.3, t + 0.2);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(og).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    },
  };

  return api;
}
