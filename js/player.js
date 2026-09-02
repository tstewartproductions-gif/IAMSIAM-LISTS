// IAMSIAM_LISTS - unified transport over the current list's playable tracks.
import { adapterFor } from './adapters.js';

const $ = id => document.getElementById(id);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const P = {
  list: null, queue: [], i: -1, adapter: null, playing: false,
  seq: 0, timer: null, scrubbing: false,
};

function els() {
  return { root: $('player'), media: $('player-media'), track: $('player-track'),
    listEl: $('player-list'), pp: $('pp'), pv: $('pv'), nx: $('nx'),
    el: $('t-el'), to: $('t-to'), scrub: $('scrub'), counter: $('counter') };
}

function markRows() {
  const cur = P.queue[P.i];
  document.querySelectorAll('.track').forEach(row => {
    row.classList.toggle('active', !!cur && P.listShown && Number(row.dataset.rank) === cur.rank);
  });
}

function updateBar() {
  const e = els();
  if (!P.adapter) return;
  const t = P.adapter.time(), d = P.adapter.duration();
  e.el.textContent = fmt(t); e.to.textContent = fmt(d);
  if (!P.scrubbing && d > 0) e.scrub.value = Math.round((t / d) * 1000);
}

async function loadIndexTrack(idx) {
  const mySeq = ++P.seq;
  const e = els(); const t = P.queue[idx];
  if (!t) return;
  P.adapter?.destroy(); P.adapter = null; P.i = idx;
  e.root.hidden = false;
  e.track.textContent = `${t.artist} — ${t.title}`;
  e.listEl.textContent = `${P.list.curator} · ${P.list.listTitle}`;
  e.counter.textContent = `${idx + 1}/${P.queue.length}`;
  e.media.innerHTML = `<div class="player-note">LOADING…</div>`;
  markRows();
  const ad = adapterFor(t);
  ad.onended = () => next();
  ad.onerror = () => fail(t);
  try {
    await ad.mount(t, e.media);
  } catch (err) {
    console.error(err);
    if (mySeq === P.seq) fail(t);
    return;
  }
  if (mySeq !== P.seq) { ad.destroy(); return; }
  P.adapter = ad;
  play();
}

function fail(t) {
  const e = els();
  const link = t.stream?.url ?? t.buy?.[0]?.url;
  e.media.innerHTML = `<div class="player-note">COULDN'T PLAY THIS ONE HERE${link ?
    ` — <a href="${link.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">LISTEN AT THE SOURCE</a>` : ''}</div>`;
  setPlaying(false);
}

function setPlaying(on) {
  P.playing = on;
  els().pp.innerHTML = on ? '&#10073;&#10073;' : '&#9654;';
  clearInterval(P.timer);
  if (on) P.timer = setInterval(updateBar, 250);
}

function play() { P.adapter?.play(); setPlaying(true); updateBar(); }
function pause() { P.adapter?.pause(); setPlaying(false); }
function next() { if (P.i < P.queue.length - 1) loadIndexTrack(P.i + 1); else setPlaying(false); }
function prev() { if (P.adapter && P.adapter.time() > 3) { P.adapter.seek(0); return; } if (P.i > 0) loadIndexTrack(P.i - 1); }

export function playTrack(list, rank) {
  const queue = list.tracks.filter(t => t.stream?.url);
  const idx = queue.findIndex(t => t.rank === rank);
  if (idx === -1) return;
  P.list = list; P.queue = queue; P.listShown = true;
  loadIndexTrack(idx);
}

// Called by the router after every render so active-row marking survives navigation.
export function onRender(currentList) {
  P.listShown = !!(P.list && currentList &&
    P.list.curator === currentList.curator && P.list.date === currentList.date);
  markRows();
}

export function initPlayer() {
  const e = els();
  e.pp.addEventListener('click', () => (P.playing ? pause() : play()));
  e.nx.addEventListener('click', next);
  e.pv.addEventListener('click', prev);
  e.scrub.addEventListener('input', () => { P.scrubbing = true; });
  e.scrub.addEventListener('change', () => {
    P.scrubbing = false;
    const d = P.adapter?.duration() ?? 0;
    if (d > 0) P.adapter.seek((e.scrub.value / 1000) * d);
  });
  document.getElementById('app').addEventListener('click', ev => {
    if (ev.target.closest('.buy')) return;
    const row = ev.target.closest('.track');
    if (!row || !window.__currentList) return;
    playTrack(window.__currentList, Number(row.dataset.rank));
  });
}
