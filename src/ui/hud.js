import { formatYear, TIME_KEYS, tFromYear, NOW } from '../time/epochs.js';

const SCRUB_MAX = 10000;

const TICKS = [
  { year: -4.6e9, label: '誕生' },
  { year: -4.0e9, label: '海' },
  { year: -2.4e9, label: '酸素' },
  { year: -5.41e8, label: '生命' },
  { year: -6.6e7, label: '隕石' },
  { year: NOW, label: '現在' },
  { year: NOW + 1e9, label: '海の終わり' },
  { year: NOW + 5e9, label: '太陽の最期' },
];

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/**
 * HUD：入場画面・年代表示・キャプション・タイムライン・ラジオパネル。
 */
export function createHUD({ root, timeline, radio, onMeteor, onEnter }) {
  root.innerHTML = '';

  const enter = el(`
    <div id="enter" class="enter">
      <div class="enter-card">
        <p class="enter-kicker">Moon Villa</p>
        <h1 class="enter-title">月の別荘</h1>
        <p class="enter-sub">地球の46億年を、窓辺から。</p>
        <button id="enter-btn" class="btn btn-primary" type="button">入る</button>
        <p class="enter-hint">ドラッグで見回す ／ Space 再生・停止 ／ M 隕石 ／ R ラジオ</p>
      </div>
    </div>`);

  const hud = el(`
    <div id="hud" class="hud">
      <div class="year-block">
        <div id="year" class="year">46億年前</div>
        <div id="hold" class="hold">— 時が止まる —</div>
        <div id="caption" class="caption">
          <div class="caption-title"></div>
          <div class="caption-body"></div>
        </div>
      </div>
      <div class="bottom">
        <div class="tl">
          <input id="scrub" type="range" min="0" max="${SCRUB_MAX}" value="0" step="1" aria-label="時間" />
          <div class="ticks"></div>
        </div>
        <div class="controls">
          <button id="play" class="btn icon" type="button" title="再生 / 停止 (Space)" aria-label="再生 / 停止">▶</button>
          <div class="speed" role="group" aria-label="速度">
            <button class="btn" type="button" data-speed="0.5">½×</button>
            <button class="btn on" type="button" data-speed="1">1×</button>
            <button class="btn" type="button" data-speed="2">2×</button>
            <button class="btn" type="button" data-speed="4">4×</button>
          </div>
          <span class="spacer"></span>
          <button id="meteor" class="btn" type="button" title="隕石を落とす (M)">☄ 隕石</button>
          <button id="radio-btn" class="btn" type="button" title="ラジオ (R)">📻 ラジオ</button>
          <button id="fs" class="btn icon" type="button" title="全画面 (F)" aria-label="全画面">⛶</button>
        </div>
      </div>
      <aside id="radio-panel" class="radio-panel" hidden aria-label="ラジオ">
        <div class="rp-head">
          <span class="rp-brand">LUNA RADIO</span>
          <span class="rp-lamp" id="rp-lamp"></span>
          <button id="rp-close" class="btn icon" type="button" aria-label="閉じる">×</button>
        </div>
        <div class="rp-dial">
          <div class="rp-scale"></div>
          <div id="rp-needle" class="rp-needle"></div>
        </div>
        <div class="rp-now">
          <div id="rp-title" class="rp-title">静寂</div>
          <div id="rp-artist" class="rp-artist">月面放送</div>
        </div>
        <div class="rp-transport">
          <button id="rp-prev" class="btn icon" type="button" aria-label="前の曲">⏮</button>
          <button id="rp-play" class="btn icon big" type="button" aria-label="再生 / 停止">▶</button>
          <button id="rp-next" class="btn icon" type="button" aria-label="次の曲">⏭</button>
        </div>
        <div class="rp-row">
          <label class="rp-vol">音量 <input id="rp-vol" type="range" min="0" max="100" value="60" /></label>
          <label class="rp-am"><input id="rp-am" type="checkbox" checked /> AM風</label>
        </div>
        <ol id="rp-list" class="rp-list"></ol>
        <div class="rp-add">
          <button id="rp-add" class="btn" type="button">曲を追加</button>
          <input id="rp-files" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac" multiple hidden />
          <span class="rp-note">常設するには public/music に置いて playlist.json に追記</span>
        </div>
        <div id="rp-error" class="rp-error" hidden></div>
      </aside>
    </div>`);

  root.append(enter, hud);

  const $ = (sel) => hud.querySelector(sel);
  const yearEl = $('#year');
  const holdEl = $('#hold');
  const captionEl = $('#caption');
  const captionTitle = captionEl.querySelector('.caption-title');
  const captionBody = captionEl.querySelector('.caption-body');
  const scrub = $('#scrub');
  const playBtn = $('#play');
  const radioPanel = $('#radio-panel');
  const rpList = $('#rp-list');

  // 目盛り
  const ticks = $('.ticks');
  for (const tk of TICKS) {
    const t = tFromYear(tk.year);
    const span = el(`<span class="tick" style="left:${(t * 100).toFixed(2)}%"><i></i>${tk.label}</span>`);
    ticks.append(span);
  }
  void TIME_KEYS;

  // ---- 入場
  let entered = false;
  $('#enter-btn', enter);
  enter.querySelector('#enter-btn').addEventListener('click', () => {
    if (entered) return;
    entered = true;
    enter.classList.add('out');
    setTimeout(() => enter.remove(), 1400);
    onEnter?.();
    resetIdle();
  });

  // ---- 再生・速度
  playBtn.addEventListener('click', () => timeline.toggle());
  for (const b of hud.querySelectorAll('[data-speed]')) {
    b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
  }
  function setSpeed(s) {
    timeline.setSpeed(s);
    for (const b of hud.querySelectorAll('[data-speed]')) b.classList.toggle('on', parseFloat(b.dataset.speed) === s);
  }

  // ---- スクラブ
  let scrubbing = false;
  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  scrub.addEventListener('input', () => {
    timeline.seek(scrub.valueAsNumber / SCRUB_MAX);
    const ev = timeline.currentEvent();
    if (ev) caption(ev, { quiet: true });
  });
  const endScrub = () => { scrubbing = false; };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('change', endScrub);
  scrub.addEventListener('keydown', (e) => e.stopPropagation());

  $('#meteor').addEventListener('click', () => onMeteor?.());
  $('#fs').addEventListener('click', toggleFullscreen);
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ---- ラジオパネル
  $('#radio-btn').addEventListener('click', () => setRadioOpen(radioPanel.hidden));
  $('#rp-close').addEventListener('click', () => setRadioOpen(false));
  $('#rp-prev').addEventListener('click', () => radio.prev());
  $('#rp-next').addEventListener('click', () => radio.next());
  $('#rp-play').addEventListener('click', () => radio.toggle());
  $('#rp-vol').addEventListener('input', (e) => radio.setVolume(e.target.valueAsNumber / 100));
  $('#rp-am').addEventListener('change', (e) => radio.setAM(e.target.checked));
  $('#rp-add').addEventListener('click', () => $('#rp-files').click());
  $('#rp-files').addEventListener('change', (e) => {
    const first = radio.addFiles(e.target.files);
    if (first >= 0) radio.select(first, true);
    e.target.value = '';
  });

  function setRadioOpen(open) {
    radioPanel.hidden = !open;
    $('#radio-btn').classList.toggle('on', open);
    resetIdle();
  }

  function renderRadio(st) {
    rpList.replaceChildren();
    st.tracks.forEach((track, i) => {
      const li = el(`<li><button type="button" class="rp-item${i === st.index ? ' on' : ''}"><span class="rp-num">${String(i).padStart(2, '0')}</span><span class="rp-name"></span><span class="rp-art"></span></button></li>`);
      li.querySelector('.rp-name').textContent = track.title;
      li.querySelector('.rp-art').textContent = track.artist || '';
      li.querySelector('button').addEventListener('click', () => radio.select(i, true));
      rpList.append(li);
    });
    $('#rp-title').textContent = st.current?.title ?? '';
    $('#rp-artist').textContent = st.current?.artist ?? '';
    $('#rp-play').textContent = st.playing ? '❚❚' : '▶';
    $('#rp-lamp').classList.toggle('on', st.playing);
    const f = st.tracks.length > 1 ? st.index / (st.tracks.length - 1) : 0.08;
    $('#rp-needle').style.left = `${6 + f * 88}%`;
    $('#rp-vol').value = Math.round(st.volume * 100);
    $('#rp-am').checked = st.am;
    const err = $('#rp-error');
    err.hidden = !st.error;
    err.textContent = st.error || '';
    if (st.tracks.length <= 1) {
      const li = el('<li class="rp-empty">曲がまだありません。「曲を追加」か public/music/ へ。</li>');
      rpList.append(li);
    }
  }
  radio.onChange(renderRadio);
  renderRadio(radio.state);

  // ---- キャプション
  let captionTimer = 0;
  function caption(ev, { quiet = false } = {}) {
    captionTitle.textContent = ev.title;
    captionBody.textContent = ev.body;
    captionEl.classList.add('show');
    captionEl.classList.toggle('impact', ev.kind !== 'caption');
    clearTimeout(captionTimer);
    const stay = ev.kind !== 'caption' ? (ev.hold || 10) * 1000 + 4000 : quiet ? 5000 : 9000;
    captionTimer = setTimeout(() => captionEl.classList.remove('show'), stay);
  }

  // ---- キーボード
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName) && e.target.type !== 'range') {
      if (e.key !== 'Escape') return;
    }
    if (!entered) {
      if (e.key === 'Enter' || e.key === ' ') enter.querySelector('#enter-btn').click();
      return;
    }
    resetIdle();
    switch (e.key) {
      case ' ':
        e.preventDefault();
        timeline.toggle();
        break;
      case 'ArrowLeft':
        timeline.seek(timeline.state.t - 0.01);
        break;
      case 'ArrowRight':
        timeline.seek(timeline.state.t + 0.01);
        break;
      case '1': setSpeed(0.5); break;
      case '2': setSpeed(1); break;
      case '3': setSpeed(2); break;
      case '4': setSpeed(4); break;
      case 'm': case 'M': onMeteor?.(); break;
      case 'r': case 'R': setRadioOpen(radioPanel.hidden); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'Escape': setRadioOpen(false); break;
      default: break;
    }
  });

  // ---- アイドルで UI を薄くする
  let idleTimer = 0;
  function resetIdle() {
    hud.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (radioPanel.hidden) hud.classList.add('idle');
    }, 4500);
  }
  window.addEventListener('pointermove', resetIdle, { passive: true });
  window.addEventListener('pointerdown', resetIdle, { passive: true });
  resetIdle();

  // ---- 毎フレーム
  let lastYearText = '';
  let lastPlaying = null;
  let lastHolding = null;
  function update(state) {
    const text = formatYear(state.year) + (Math.abs(state.year - NOW) < 0.5 ? '（現在）' : '');
    if (text !== lastYearText) {
      yearEl.textContent = text;
      lastYearText = text;
    }
    if (!scrubbing) scrub.value = Math.round(state.t * SCRUB_MAX);
    if (state.playing !== lastPlaying) {
      playBtn.textContent = state.playing ? '❚❚' : '▶';
      playBtn.title = state.playing ? '停止 (Space)' : '再生 (Space)';
      lastPlaying = state.playing;
    }
    const holding = state.holding > 0;
    if (holding !== lastHolding) {
      holdEl.classList.toggle('show', holding);
      lastHolding = holding;
    }
  }

  return { update, caption, setRadioOpen, setSpeed, get entered() { return entered; } };
}
