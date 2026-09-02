// IAMSIAM_LISTS - unified transport over the current list's playable tracks.
import { adapterFor } from './adapters.js';
import { loadLogo, createMeter, envelopeSource, typeInto } from './iamsiam-vu.js';

const $ = id => document.getElementById(id);
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u ?? '')) ? String(u) : '';

const SUPPORTED = ['bandcamp', 'youtube', 'soundcloud', 'file'];
const AUDIO_TYPES = ['bandcamp', 'file']; // streams played in our own <audio> - the only ones the meter runs for
export const isPlayable = t => !!t?.stream?.url && SUPPORTED.includes(t.stream.type);

const P = {
  list: null, queue: [], i: -1, adapter: null, playing: false, listShown: false,
  seq: 0, timer: null, scrubbing: false, userPaused: false, loading: false, watch: null,
};

function els() {
  return { root: $('player'), media: $('player-media'), track: $('player-track'),
    details: $('player-details'), pp: $('pp'), pv: $('pv'), nx: $('nx'),
    el: $('t-el'), to: $('t-to'), scrub: $('scrub'), counter: $('counter') };
}

/* -------------------------------------------------------------- VU meter */
/* One meter, one place: the overlay canvas inside #player-media, same size and
   position for every track (Travis, 2026-09-02). It runs ONLY with a real baked
   envelope on an audio-element stream (bandcamp/file) - no simulated meters.
   Embed tracks (youtube/soundcloud) show no meter until they get self-hosted
   audio. If the logo fails to load the player runs meterless rather than not at all. */
let vu = null;          // { full } once bootstrapped
let vuReady = null;     // in-flight/settled bootstrap promise (one attempt)
let vuActive = null;    // the meter the transport drives
let overlay = null;     // the .vu-overlay canvas node

function ensureMeters() {
  if (vuReady) return vuReady;
  vuReady = (async () => {
    const logo = await loadLogo('assets/logo.png');
    overlay = document.createElement('canvas');
    overlay.className = 'vu-overlay';
    overlay.hidden = true;
    els().media.appendChild(overlay);
    vu = { full: await createMeter({ canvas: overlay, logo }) };
    return vu;
  })().catch(err => { console.error('VU meter unavailable', err); vu = null; return null; });
  return vuReady;
}

/** The media box owns the overlay canvas; every swap of its contents keeps it. */
function setMedia(...nodes) {
  const m = els().media;
  m.replaceChildren(...nodes);
  if (overlay) m.appendChild(overlay);   // move, never clone: one canvas, always
}

function setVuMode(mode) {
  els().root.classList.toggle('vu-full', mode === 'full');
  if (overlay) overlay.hidden = mode !== 'full';
}

function stopVu() { vuActive?.stop(); vuActive = null; }

/** Point the meter at this track's levels. Async and unawaited: a slow envelope
    fetch must never delay playback, so every step re-checks mySeq. Real envelope
    or no meter at all - a fake meter is worse than none (Travis, 2026-09-02). */
async function wireVu(t, mySeq) {
  if (!t.envelope || !AUDIO_TYPES.includes(t.stream?.type)) { setVuMode(null); return; }
  const v = await ensureMeters();
  if (!v || mySeq !== P.seq) return;
  let src, bands;
  try {
    const r = await fetch(t.envelope);
    if (!r.ok) throw new Error(`envelope ${r.status}`);
    const json = await r.json();
    src = envelopeSource(json);
    bands = Number(json.bands) || 24;
  } catch (err) {
    console.error(`envelope load failed: ${t.envelope}`, err);
    if (mySeq === P.seq) setVuMode(null);
    return;
  }
  if (mySeq !== P.seq) return;
  setVuMode('full');
  v.full.setBands(bands);
  v.full.setSource(src);
  vuActive = v.full;
  if (P.playing) vuActive.start(() => P.adapter?.time() ?? 0); else vuActive.stop();
}

/* ---------------------------------------------------------- typing layer */
let typer = null, typerD = null;

/** Types "ARTIST — TITLE", then the details line 350ms behind it. */
function typeMeta(t, mySeq) {
  const e = els();
  typer?.cancel(); typerD?.cancel(); typerD = null;
  e.details.textContent = '';
  typer = typeInto(e.track, `${t.artist} — ${t.title}`);
  typer.done.then(ok => {
    if (!ok || mySeq !== P.seq) return;
    setTimeout(() => {
      if (mySeq !== P.seq) return;
      typerD = typeInto(e.details, t.details ?? `${P.list.curator} · ${P.list.listTitle}`);
    }, 350);
  });
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

function resetBar() {
  const e = els();
  e.el.textContent = '0:00'; e.to.textContent = '0:00'; e.scrub.value = 0;
}

function note(html) {
  const d = document.createElement('div');
  d.className = 'player-note';
  d.innerHTML = html;
  return d;
}

function offscreen(el) {
  const r = el.getBoundingClientRect();
  return r.bottom < 0 || r.top > window.innerHeight;
}

async function loadIndexTrack(idx) {
  const mySeq = ++P.seq;
  const e = els(); const t = P.queue[idx];
  if (!t) return;
  P.loading = true;
  P.adapter?.destroy(); P.adapter = null;
  stopVu();            // the old track's meter must not run against the new one's clock
  P.i = idx; P.userPaused = false;
  const firstOpen = e.root.hidden;
  e.root.hidden = false;
  typeMeta(t, mySeq);  // types through the load, so the panel is never dead air
  e.counter.textContent = `${idx + 1}/${P.queue.length}`;
  resetBar();
  setPlaying(true); // track will auto-play; pause glyph lets a click during load register pause-intent
  setMedia(note('LOADING…'));
  markRows();
  if (firstOpen || offscreen(e.root)) e.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const ad = adapterFor(t);
  if (!ad) { fail(t); return; }
  ad.onended = () => { if (mySeq === P.seq) next(); };
  ad.onerror = () => { if (mySeq === P.seq) fail(t); };
  ad.onstate = on => { if (mySeq === P.seq) setPlaying(on); };
  const wrap = document.createElement('div');
  wrap.className = 'mount';
  e.media.appendChild(wrap);
  try {
    await ad.mount(t, wrap);
  } catch (err) {
    console.error(err);
    ad.destroy();
    if (mySeq === P.seq) fail(t);
    return;
  }
  if (mySeq !== P.seq) { ad.destroy(); return; }
  P.loading = false;
  P.adapter = ad;
  // Keep wrap attached in place: re-attaching would reload its iframe and orphan
  // the SC/YT widget's event stream. Remove the loading note and stale siblings instead.
  for (const c of [...els().media.children]) {
    if (c !== wrap && !c.classList?.contains('vu-overlay')) c.remove();
  }
  wrap.classList.add('live');
  wireVu(t, mySeq);   // unawaited: the meter catches up, playback never waits
  if (!P.userPaused) play(); else updateBar();
}

function fail(t) {
  P.loading = false;
  P.adapter?.destroy(); P.adapter = null;
  stopVu();
  setVuMode(null);   // no meter over the failure note
  const e = els();
  const link = safeUrl(t.stream?.url ?? t.buy?.[0]?.url);
  setMedia(note(`COULDN'T PLAY THIS ONE HERE${link ?
    ` — <a href="${esc(link)}" target="_blank" rel="noopener">LISTEN AT THE SOURCE</a>` : ''}`));
  setPlaying(false);
}

function setPlaying(on) {
  P.playing = on;
  els().pp.innerHTML = on ? '&#10073;&#10073;' : '&#9654;';
  clearInterval(P.timer);
  if (on) P.timer = setInterval(updateBar, 250);
  on ? vuActive?.start(() => P.adapter?.time() ?? 0) : vuActive?.stop();
}

function play() {
  if (!P.adapter) return;
  P.userPaused = false;
  P.adapter.play();
  setPlaying(true);
  updateBar();
  clearTimeout(P.watch);
  const at = P.adapter, t0 = at.time();
  P.watch = setTimeout(() => {
    // Embeds can silently refuse autoplay (iOS gesture rules): show an honest play button.
    if (P.playing && P.adapter === at && at.time() - t0 < 0.3) setPlaying(false);
  }, 2000);
}
function pause() { P.userPaused = true; if (P.adapter) P.adapter.pause(); setPlaying(false); }
function next() { if (P.i < P.queue.length - 1) loadIndexTrack(P.i + 1); else setPlaying(false); }
function prev() { if (P.adapter && P.adapter.time() > 3) { P.adapter.seek(0); return; } if (P.i > 0) loadIndexTrack(P.i - 1); }

export function playTrack(list, rank) {
  if (P.list === list && P.queue[P.i]?.rank === rank && (P.adapter || P.loading)) {
    P.playing ? pause() : play(); return; // same track: toggle. After a fail (no adapter, not loading), fall through to retry.
  }
  const queue = list.tracks.filter(isPlayable);
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
